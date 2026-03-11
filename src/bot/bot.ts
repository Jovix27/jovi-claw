import { Bot, InputFile } from "grammy";
import fs from "node:fs";
import { config } from "../config/env.js";
import { authGuard } from "./middleware.js";
import { runAgentLoop } from "../agent/loop.js";
import type { AgentResult } from "../agent/loop.js";
import { transcribeVoice } from "../voice/transcribe.js";
import { logger } from "../utils/logger.js";
import { handleSetupStart, handleSetupAnswer } from "../utils/onboarding.js";
import { checkRateLimit, retryAfterSeconds } from "../security/rate-limiter.js";
import { validateUserInput } from "../security/input-validator.js";
import { audit } from "../security/audit-logger.js";

/**
 * Creates and configures the grammY Telegram bot.
 * Uses long-polling only — no web server, no exposed ports.
 */
export function createBot(): Bot {
    const bot = new Bot(config.telegram.botToken);

    // ─── Security: auth guard first ────────────────────────
    bot.use(authGuard);

    // ─── Setup Command ─────────────────────────────────────
    bot.command(["start", "setup"], async (ctx) => {
        logger.info("User requested setup/start.", { userId: ctx.from?.id });
        await handleSetupStart(ctx);
    });

    // ─── Handle text messages ──────────────────────────────
    bot.on("message:text", async (ctx) => {
        const userId = ctx.from.id;

        // Rate limiting
        if (!checkRateLimit(userId)) {
            const wait = retryAfterSeconds(userId);
            audit.rateLimited(userId, wait);
            await ctx.reply(`⏳ Too many messages. Please wait ${wait}s before sending again.`);
            return;
        }

        const rawMessage = ctx.message.text;

        // Input validation + prompt-injection check
        const validation = validateUserInput(rawMessage);
        if (!validation.ok) {
            audit.inputRejected(userId, validation.reason ?? "unknown");
            if (validation.reason?.includes("injection")) {
                audit.injectionAttempt(userId);
            }
            await ctx.reply("⚠️ Your message could not be processed. Please rephrase and try again.");
            return;
        }

        const userMessage = validation.sanitised!;

        // Try intercepting for onboarding first
        const isSetupHandled = await handleSetupAnswer(ctx, userMessage);
        if (isSetupHandled) return;

        logger.info("Received message.", { userId, length: userMessage.length });

        await ctx.replyWithChatAction("typing");

        try {
            const result = await runAgentLoop(userMessage, userId);
            await sendAgentResult(ctx, result);
        } catch (error) {
            logger.error("Agent loop failed.", {
                error: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply("⚠️ Something went wrong.");
        }
    });

    // ─── Handle voice messages ─────────────────────────────
    bot.on("message:voice", async (ctx) => {
        const userId = ctx.from.id;

        // Rate limiting applies to voice too
        if (!checkRateLimit(userId)) {
            const wait = retryAfterSeconds(userId);
            audit.rateLimited(userId, wait);
            await ctx.reply(`⏳ Too many messages. Please wait ${wait}s.`);
            return;
        }

        logger.info("Received voice message.", { userId, duration: ctx.message.voice.duration });

        await ctx.replyWithChatAction("typing");

        try {
            // 1. Get file from Telegram — token never appears in logs; grammY
            //    handles auth internally via ctx.getFile()
            const file = await ctx.getFile();
            // Construct URL without logging it; token is masked by secret-masker
            // if it ever reaches a log line.
            const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

            // 2. Transcribe with Whisper
            const transcription = await transcribeVoice(fileUrl);

            if (!transcription || transcription.trim().length === 0) {
                await ctx.reply("🤔 I couldn't make out what you said. Could you try again?");
                return;
            }

            // 3. Echo back what was heard
            await ctx.reply(`🎤 *You said:*\n_"${transcription}"_`, { parse_mode: "Markdown" });

            // 4. Show typing while AI thinks
            await ctx.replyWithChatAction("typing");

            // 5. Validate transcribed text before passing to agent
            const validation = validateUserInput(transcription);
            if (!validation.ok) {
                audit.inputRejected(userId, validation.reason ?? "voice-validation");
                await ctx.reply("⚠️ Voice content could not be processed. Please try again.");
                return;
            }

            // 6. Run agent loop with validated transcription
            const result = await runAgentLoop(validation.sanitised!, userId);
            await sendAgentResult(ctx, result);
        } catch (error) {
            logger.error("Voice processing failed.", {
                error: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply("⚠️ Failed to process voice message.");
        }
    });

    // ─── Handle photo messages (Vision) ────────────────────
    bot.on("message:photo", async (ctx) => {
        const userId = ctx.from.id;

        if (!checkRateLimit(userId)) {
            const wait = retryAfterSeconds(userId);
            await ctx.reply(`⏳ Too many messages. Please wait ${wait}s.`);
            return;
        }

        logger.info("Received photo message.", { userId });
        await ctx.replyWithChatAction("typing");

        try {
            // Get the largest photo version
            const photos = ctx.message.photo;
            const largestPhoto = photos[photos.length - 1];
            const file = await ctx.api.getFile(largestPhoto.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

            // Get caption if any (user's question about the image)
            const caption = ctx.message.caption || "";

            // Import and use vision tool
            const { analyzeImageFromTelegram } = await import("../tools/analyze-image.js");

            const userQuestion = caption || "Describe this image in detail. What do you see?";
            await ctx.reply(`🔍 Analyzing image${caption ? ` with your question: "${caption}"` : ""}...`);

            const analysis = await analyzeImageFromTelegram(fileUrl, userQuestion);

            // Run through agent loop for natural response
            const prompt = caption
                ? `The user sent an image and asked: "${caption}"\n\nImage analysis result: ${analysis}\n\nProvide a helpful response based on this.`
                : `The user sent an image. Here's what I see: ${analysis}\n\nDescribe this to the user in a helpful way.`;

            const result = await runAgentLoop(prompt, userId);
            await sendAgentResult(ctx, result);
        } catch (error) {
            logger.error("Photo processing failed.", {
                error: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply("⚠️ Failed to analyze the image. Please try again.");
        }
    });

    // ─── Handle document uploads ─────────────────────────────
    bot.on("message:document", async (ctx) => {
        const userId = ctx.from.id;

        if (!checkRateLimit(userId)) {
            const wait = retryAfterSeconds(userId);
            await ctx.reply(`⏳ Too many messages. Please wait ${wait}s.`);
            return;
        }

        const doc = ctx.message.document;
        logger.info("Received document.", { userId, fileName: doc.file_name, mimeType: doc.mime_type });

        await ctx.replyWithChatAction("typing");

        try {
            const file = await ctx.api.getFile(doc.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

            const caption = ctx.message.caption || "";
            const fileName = doc.file_name || "document";

            // Check file type
            const ext = fileName.split(".").pop()?.toLowerCase() || "";
            const supportedTextFormats = ["txt", "md", "json", "csv", "log", "xml", "html", "js", "ts", "py", "yaml", "yml"];

            if (supportedTextFormats.includes(ext)) {
                // Use document analysis tool
                const { executeAnalyzeDocument } = await import("../tools/analyze-document.js");

                await ctx.reply(`📄 Reading ${fileName}...`);

                const task = caption.toLowerCase().includes("summar") ? "summarize" : "extract_text";
                const result = await executeAnalyzeDocument({
                    file_source: fileUrl,
                    task,
                    question: caption || undefined,
                });

                const parsed = JSON.parse(result);

                if (parsed.success) {
                    const prompt = caption
                        ? `User uploaded "${fileName}" and asked: "${caption}"\n\nDocument content:\n${parsed.result}\n\nAnswer their question based on this.`
                        : `User uploaded "${fileName}". Here's the content:\n${parsed.result}\n\nSummarize this for the user.`;

                    const agentResult = await runAgentLoop(prompt, userId);
                    await sendAgentResult(ctx, agentResult);
                } else {
                    await ctx.reply(`⚠️ Failed to read document: ${parsed.error}`);
                }
            } else if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
                // Treat as image
                const { analyzeImageFromTelegram } = await import("../tools/analyze-image.js");
                const analysis = await analyzeImageFromTelegram(fileUrl, caption || undefined);
                const result = await runAgentLoop(`Image analysis: ${analysis}`, userId);
                await sendAgentResult(ctx, result);
            } else {
                await ctx.reply(`📎 Received ${fileName}. I can read text files (.txt, .md, .json, .csv, .py, .js, etc.) and images. For PDFs, I'll need OCR support which is being added soon!`);
            }
        } catch (error) {
            logger.error("Document processing failed.", {
                error: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply("⚠️ Failed to process the document.");
        }
    });

    // ─── Handle errors globally ────────────────────────────
    bot.catch((err) => {
        logger.error("Bot error.", {
            error: err.message,
        });
    });

    return bot;
}

/**
 * Send agent result — text response + any voice/image files.
 */
async function sendAgentResult(
    ctx: { reply: (text: string, opts?: object) => Promise<unknown>; replyWithVoice: (voice: InputFile, opts?: object) => Promise<unknown>; replyWithPhoto: (photo: InputFile, opts?: object) => Promise<unknown> },
    result: AgentResult
): Promise<void> {
    // Send text response
    await sendTextResponse(ctx, result.text);

    // Send any image files
    for (const imagePath of result.imageFiles) {
        try {
            if (fs.existsSync(imagePath)) {
                await ctx.replyWithPhoto(new InputFile(imagePath));
                fs.unlinkSync(imagePath);
                logger.debug("Sent and cleaned up image file.", { path: imagePath });
            }
        } catch (error) {
            logger.error("Failed to send image file.", {
                path: imagePath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // Send any voice files
    for (const voicePath of result.voiceFiles) {
        try {
            if (fs.existsSync(voicePath)) {
                await ctx.replyWithVoice(new InputFile(voicePath));
                // Clean up temp file after sending
                fs.unlinkSync(voicePath);
                logger.debug("Sent and cleaned up voice file.", { path: voicePath });
            }
        } catch (error) {
            logger.error("Failed to send voice file.", {
                path: voicePath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

/**
 * Send text, auto-splitting if it exceeds Telegram's 4096-char limit.
 * Tries Markdown first; falls back to plain text if parse fails.
 */
async function sendTextResponse(
    ctx: { reply: (text: string, opts?: object) => Promise<unknown> },
    text: string
): Promise<void> {
    const chunks: string[] = [];

    if (text.length <= 4096) {
        chunks.push(text);
    } else {
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= 4096) {
                chunks.push(remaining);
                break;
            }
            let splitIndex = remaining.lastIndexOf("\n", 4096);
            if (splitIndex === -1 || splitIndex < 2000) splitIndex = remaining.lastIndexOf(" ", 4096);
            if (splitIndex === -1 || splitIndex < 2000) splitIndex = 4096;
            chunks.push(remaining.slice(0, splitIndex));
            remaining = remaining.slice(splitIndex).trimStart();
        }
    }

    for (const chunk of chunks) {
        try {
            await ctx.reply(chunk, { parse_mode: "Markdown" });
        } catch {
            // Telegram rejected Markdown (broken entity). 
            // Escape literal underscores and asterisks to ensure it sends as plain text without parsing errors.
            const safeText = chunk.replaceAll("_", "\\_").replaceAll("*", "\\*");
            try {
                await ctx.reply(safeText);
            } catch (fallbackErr) {
                logger.error("Total failure sending message chunk.", {
                    error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
                });
            }
        }
    }
}


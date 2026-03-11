/**
 * Image Analysis Tool — Vision capabilities like ChatGPT/Claude
 *
 * Uses OpenAI's GPT-4 Vision or OpenRouter vision models to analyze images.
 * Can describe images, extract text (OCR), identify objects, and answer questions about images.
 */

import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import fs from "node:fs";
import path from "node:path";

// ─── Vision Client ──────────────────────────────────────
const visionClient = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
    defaultHeaders: {
        "HTTP-Referer": "https://jovi-ai.local",
        "X-Title": "Jovi AI Vision",
    },
});

// Vision-capable models on OpenRouter
const VISION_MODEL = "anthropic/claude-3.5-sonnet"; // or "openai/gpt-4o"

// ─── Tool Definition ────────────────────────────────────
export const analyzeImageDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "analyze_image",
        description:
            "Analyzes an image using AI vision capabilities. Can describe what's in the image, " +
            "extract text (OCR), identify objects, read documents, analyze charts/diagrams, " +
            "and answer specific questions about the image content. Use this whenever Boss " +
            "sends an image and asks about it, or when you need to understand visual content.",
        parameters: {
            type: "object",
            properties: {
                image_source: {
                    type: "string",
                    description:
                        "Either a URL to the image, a base64-encoded image string, " +
                        "or a local file path to the image.",
                },
                question: {
                    type: "string",
                    description:
                        "The question to answer about the image. Examples: " +
                        "'What is in this image?', 'Extract all text from this document', " +
                        "'What data does this chart show?', 'Identify the brand/product'.",
                },
                detail_level: {
                    type: "string",
                    enum: ["low", "high", "auto"],
                    description:
                        "Level of detail for analysis. 'high' for detailed analysis " +
                        "(documents, fine text), 'low' for quick overview, 'auto' to let the model decide.",
                },
            },
            required: ["image_source", "question"],
        },
    },
};

// ─── Helper Functions ───────────────────────────────────

function isUrl(str: string): boolean {
    return str.startsWith("http://") || str.startsWith("https://");
}

function isBase64(str: string): boolean {
    return str.startsWith("data:image/") || /^[A-Za-z0-9+/=]{100,}$/.test(str);
}

async function readImageAsBase64(filePath: string): Promise<string> {
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Image file not found: ${absolutePath}`);
    }

    const buffer = fs.readFileSync(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType =
        ext === ".png" ? "image/png" :
            ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
                ext === ".gif" ? "image/gif" :
                    ext === ".webp" ? "image/webp" :
                        "image/png";

    return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

// ─── Tool Execution ─────────────────────────────────────
export async function executeAnalyzeImage({
    image_source,
    question,
    detail_level = "auto",
}: {
    image_source: string;
    question: string;
    detail_level?: "low" | "high" | "auto";
}): Promise<string> {
    logger.info("Analyzing image", { question: question.slice(0, 100), detail_level });

    try {
        // Determine image content format
        let imageContent: { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

        if (isUrl(image_source)) {
            imageContent = {
                type: "image_url",
                image_url: {
                    url: image_source,
                    detail: detail_level,
                },
            };
        } else if (isBase64(image_source)) {
            imageContent = {
                type: "image_url",
                image_url: {
                    url: image_source.startsWith("data:") ? image_source : `data:image/png;base64,${image_source}`,
                    detail: detail_level,
                },
            };
        } else {
            // Assume it's a file path
            const base64 = await readImageAsBase64(image_source);
            imageContent = {
                type: "image_url",
                image_url: {
                    url: base64,
                    detail: detail_level,
                },
            };
        }

        const response = await visionClient.chat.completions.create({
            model: VISION_MODEL,
            max_tokens: 4096,
            messages: [
                {
                    role: "user",
                    content: [
                        imageContent,
                        {
                            type: "text",
                            text: question,
                        },
                    ],
                },
            ],
        });

        const analysis = response.choices[0]?.message?.content;

        if (!analysis) {
            return JSON.stringify({
                success: false,
                error: "No analysis returned from vision model",
            });
        }

        logger.info("Image analysis complete", { length: analysis.length });

        return JSON.stringify({
            success: true,
            analysis,
            model: VISION_MODEL,
            detail_level,
        });
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Image analysis failed", { error: errorMsg });

        return JSON.stringify({
            success: false,
            error: errorMsg,
        });
    }
}

/**
 * Analyze an image directly from a Telegram file (used by bot.ts)
 */
export async function analyzeImageFromTelegram(
    imageUrl: string,
    userQuestion?: string
): Promise<string> {
    const question = userQuestion || "Describe this image in detail. If there's text, extract it. If there are objects, identify them.";

    const result = await executeAnalyzeImage({
        image_source: imageUrl,
        question,
        detail_level: "high",
    });

    try {
        const parsed = JSON.parse(result);
        return parsed.analysis || parsed.error || "Unable to analyze image";
    } catch {
        return result;
    }
}

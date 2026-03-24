import fs from "node:fs";
import { chat } from "../llm/claude.js";
import type { ChatMessage } from "../llm/claude.js";
import { getToolDefinitions, executeTool } from "../tools/index.js";
import { logger } from "../utils/logger.js";
import { addMessageToBuffer, getRecentBuffer } from "../utils/memory.js";
import { extractFactsInBackground } from "../utils/extract-facts.js";
import { storeSemanticMemory } from "../utils/semantic.js";
import { audit } from "../security/audit-logger.js";

import { config } from "../config/env.js";

// ─── Vision-in-loop helper ───────────────────────────────
/**
 * Build a synthetic user message containing the screenshot as an inline image.
 * Injected immediately after the tool result message so the LLM can "see" the screen.
 * Works with all providers (Mistral, Gemini, OpenRouter) — universal user-role image support.
 */
function buildVisionInjection(result: string): object | null {
    let imagePath: string | null = null;
    try {
        const parsed = JSON.parse(result);
        imagePath = parsed.imagePath ?? parsed.imageFile ?? null;
    } catch { return null; }

    if (!imagePath || !fs.existsSync(imagePath)) return null;

    try {
        const ext = imagePath.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png";
        const base64 = fs.readFileSync(imagePath).toString("base64");
        return {
            role: "user",
            content: [
                { type: "text", text: "📸 Screenshot captured. Analyze it to decide the next action." },
                { type: "image_url", image_url: { url: `data:${ext};base64,${base64}`, detail: "high" } },
            ],
        };
    } catch (err) {
        logger.warn("Vision injection: could not read image file.", { imagePath, err });
        return null;
    }
}

// ─── Safety limits ──────────────────────────────────────
const MAX_ITERATIONS = config.security.godMode ? 100 : 10;
const MAX_OUTPUT_BYTES = config.security.godMode ? 10_000_000 : 16_000; // cap LLM response stored / forwarded

/**
 * Result from the agent loop, including any side effects.
 */
export interface AgentResult {
    text: string;
    voiceFiles: string[];  // temp paths to audio files to send
    imageFiles: string[];  // temp paths to generated images
}

/**
 * Agentic tool loop (OpenAI function-calling format):
 *   1. Send user message + tools → LLM
 *   2. If LLM wants to call a function → execute it, feed result back
 *   3. Collect voice files from respond_with_voice tool calls
 *   4. Repeat until LLM returns a text response (finish_reason: "stop")
 *   5. Safety: bail after MAX_ITERATIONS
 */
export async function runAgentLoop(
    userMessage: string,
    _userId: number,
    iterations: number = 0,
    onProgress?: (event: { type: string; [key: string]: any }) => void,
    threadId: string = "default",
    files?: any[]
): Promise<AgentResult> {
    const tools = await getToolDefinitions(_userId);
    const voiceFiles: string[] = [];
    const imageFiles: string[] = [];

    if (iterations === 0) {
        audit.agentLoopStarted(_userId);
        // Only add user message to SQLite buffer if it's the first turn
        if (userMessage) {
            await addMessageToBuffer(_userId, "user", userMessage, threadId);
        }
    }

    // Build the message history for this turn from recent DB buffer
    const recentHistory = await getRecentBuffer(_userId, 20, threadId);
    const messages: ChatMessage[] = recentHistory
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .map((m: any) => ({
            role: m.role as any,
            content: m.content
        }));

    // If there are files attached in the current turn, inject them into the last user message
    if (iterations === 0 && files && files.length > 0) {
        const lastUserIdx = messages.findLastIndex(m => m.role === "user");
        if (lastUserIdx !== -1) {
            const originalText = messages[lastUserIdx].content as string;
            const contentArray: any[] = [{ type: "text", text: originalText }];
            
            for (const f of files) {
                if (f.type.startsWith("image/")) {
                    contentArray.push({
                        type: "image_url",
                        image_url: { url: f.data }
                    });
                } else {
                    contentArray.push({
                        type: "text",
                        text: `\n[Attached File: ${f.name} (type: ${f.type})]\nNote: Native document parsing for this format is routed here. If supported by the LLM, the data is passed as base64.`
                    });
                }
            }
            messages[lastUserIdx].content = contentArray as any;
        }
    }

    for (let currentIter = 0; currentIter < MAX_ITERATIONS; currentIter++) {
        logger.debug(`Agent loop iteration ${currentIter + 1}/${MAX_ITERATIONS}`);

        const response = await chat(messages, tools, _userId);
        const choice = response.choices[0];

        if (!choice) {
            logger.error("LLM returned no choices.");
            return { text: "⚠️ No response from the AI. Please try again.", voiceFiles, imageFiles };
        }

        const assistantMessage = choice.message;

        // ─── Case 1: LLM wants to call tool(s) ───────────────
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            logger.info(`LLM requested ${assistantMessage.tool_calls.length} tool call(s).`);

            const assistantReply: any = {
                role: "assistant" as const,
                tool_calls: assistantMessage.tool_calls.map((tc: any) => ({
                    id: tc.id,
                    type: "function",
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }
                }))
            };

            // Mistral throws 400 if you pass content: "" along with tool_calls. Only add if it exists.
            if (assistantMessage.content) {
                assistantReply.content = assistantMessage.content;
            }

            messages.push(assistantReply);

            for (const toolCall of assistantMessage.tool_calls) {
                // Mistral API via OpenAI SDK sometimes omits type="function", so check for .function instead
                const isFunction = toolCall.type === "function" || !!(toolCall as any).function;
                if (!isFunction) {
                    continue;
                }
                const fnName = (toolCall as any).function.name;
                let fnArgs = {};
                try {
                    fnArgs = JSON.parse((toolCall as any).function.arguments);
                } catch {
                    logger.warn(`Failed to parse args for ${fnName}`);
                }

                logger.info(`Tool call: ${fnName}`);
                const result = await executeTool(fnName, fnArgs, _userId);
                await addMessageToBuffer(_userId, "tool", result, threadId);

                // Report tool result to progress callback
                if (onProgress) {
                    onProgress({ 
                        type: "tool_result", 
                        tool: fnName, 
                        result,
                        id: toolCall.id 
                    });
                }

                try {
                    const parsed = JSON.parse(result);
                    if (parsed.voiceFile) voiceFiles.push(parsed.voiceFile);
                    if (parsed.imageFile) imageFiles.push(parsed.imageFile);
                } catch { }

                messages.push({
                    role: "tool" as const,
                    tool_call_id: toolCall.id,
                    name: fnName,  // <--- Some LLMs require the tool name here
                    content: result,
                } as any);

                // Vision-in-loop: if tool returned a screenshot, inject it so the LLM can see it
                const visionMsg = buildVisionInjection(result);
                if (visionMsg) messages.push(visionMsg as any);
            }
            continue;
        }

        // ─── Case 2: Text Response ──────────
        const text = assistantMessage.content;
        if (!text) {
            logger.warn("LLM returned no text content.");
            return { text: "🤔 No response text.", voiceFiles, imageFiles };
        }

        // ─── Fallback Tool Parser: Catch Hallucinated JSON Blocks ───
        const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonBlockMatch) {
            try {
                const parsed = JSON.parse(jsonBlockMatch[1]);

                // LLM wrapped plain reply in {"text": "..."} — unwrap it
                if (parsed.text && typeof parsed.text === "string" && Object.keys(parsed).length === 1) {
                    const unwrapped = parsed.text;
                    await addMessageToBuffer(_userId, "assistant", unwrapped, threadId);
                    audit.agentLoopCompleted(_userId, iterations + 1);
                    extractFactsInBackground(_userId, userMessage, unwrapped);
                    return { text: unwrapped, voiceFiles, imageFiles };
                }

                if (parsed.command && parsed.shell) {
                    logger.warn("Caught hallucinated JSON block tool call. Blocking direct execution.", { parsed });

                    const warningMsg = JSON.stringify({
                        error: "⚠️ This JSON block format is NOT allowed for direct command execution. To run commands on the PC securely, you MUST execute the `remote_pc_execute` tool."
                    });

                    // Add the assistant's intermediate thought to history
                    await addMessageToBuffer(_userId, "assistant", text, threadId);

                    // Add the warning message as a system/tool error
                    await addMessageToBuffer(_userId, "tool", warningMsg, threadId);

                    // Recurse to let LLM correct its formatting and use the right tool
                    return runAgentLoop("", _userId, iterations + 1, onProgress, threadId);
                }
            } catch {
                // Ignore parsing errors
            }
        }

        // ─── Also strip bare JSON (no code fences) if LLM returns {"text": "..."} ───
        if (text.trim().startsWith("{")) {
            try {
                const parsed = JSON.parse(text.trim());
                if (parsed.text && typeof parsed.text === "string") {
                    const unwrapped = parsed.text;
                    await addMessageToBuffer(_userId, "assistant", unwrapped, threadId);
                    audit.agentLoopCompleted(_userId, iterations + 1);
                    extractFactsInBackground(_userId, userMessage, unwrapped);
                    return { text: unwrapped, voiceFiles, imageFiles };
                }
            } catch {
                // Not JSON, continue normally
            }
        }

        const safeText = Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES
            ? text.slice(0, MAX_OUTPUT_BYTES) + "\n\n[Response truncated for safety]"
            : text;

        await addMessageToBuffer(_userId, "assistant", safeText, threadId);
        audit.agentLoopCompleted(_userId, iterations + 1);
        extractFactsInBackground(_userId, userMessage, safeText);

        // Store important exchanges in semantic memory (Tier 3) for long-term retrieval
        // Only store if the exchange is substantial (not trivial greetings)
        if (userMessage && userMessage.length > 20 && safeText.length > 50) {
            const exchange = `User: ${userMessage.slice(0, 500)}\nAssistant: ${safeText.slice(0, 500)}`;
            storeSemanticMemory(_userId, exchange).catch(e => {
                logger.debug("Failed to store semantic memory", { error: e });
            });
        }

        return { text: safeText, voiceFiles, imageFiles };

    }

    logger.error("Agent loop hit max iterations.");
    return {
        text: "⚠️ Conversation too long. Please simplify your request.",
        voiceFiles,
        imageFiles,
    };
}

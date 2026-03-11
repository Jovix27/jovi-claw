import type OpenAI from "openai";
import { textToSpeech } from "../voice/tts.js";
import { logger } from "../utils/logger.js";

/**
 * respond_with_voice — LLM decides when to send a voice reply.
 *
 * The tool generates an audio file and returns its temp path.
 * The agent loop intercepts this result and queues the file
 * for the bot handler to send via Telegram.
 */
export const respondWithVoiceTool = {
    name: "respond_with_voice" as const,

    definition: {
        type: "function" as const,
        function: {
            name: "respond_with_voice",
            description:
                "Send a voice message reply to the user. Use this when the user explicitly asks for a voice reply, says something like 'say that out loud', 'tell me in voice', 'voice reply', or when a spoken response would feel more personal and natural (like greetings, encouragement, or short emotional responses). Do NOT use this for long technical explanations or code.",
            parameters: {
                type: "object" as const,
                properties: {
                    text: {
                        type: "string" as const,
                        description:
                            "The text to speak aloud. Keep it concise and conversational — this will be spoken, not read. Avoid markdown, code blocks, or bullet lists.",
                    },
                },
                required: ["text"],
            },
        },
    } satisfies OpenAI.ChatCompletionTool,

    async execute(input: { text?: string }): Promise<string> {
        if (!input.text || input.text.trim().length === 0) {
            return JSON.stringify({ error: "No text provided to speak." });
        }

        try {
            const audioPath = await textToSpeech(input.text.trim());
            // Return path with a special prefix so the agent loop can detect it
            return JSON.stringify({
                success: true,
                voiceFile: audioPath,
                spoken: input.text.trim(),
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error("Voice generation failed.", { error: msg });
            return JSON.stringify({ error: `Voice generation failed: ${msg}` });
        }
    },
};

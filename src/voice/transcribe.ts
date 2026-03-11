import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

// ─── Groq client for Whisper transcription ──────────────
const groqClient = new OpenAI({
    apiKey: config.groq.apiKey,
    baseURL: config.groq.baseUrl,
});

/**
 * Download a file from a URL into a temp file.
 * Returns the absolute path to the temp file.
 */
async function downloadToTemp(url: string, extension: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempPath = path.join(os.tmpdir(), `jovi-voice-${Date.now()}${extension}`);
    fs.writeFileSync(tempPath, buffer);
    logger.debug("Downloaded voice file.", { path: tempPath, bytes: buffer.length });

    return tempPath;
}

/**
 * Transcribe a voice file using Groq's Whisper API.
 * @param fileUrl - URL to download the audio file from (Telegram file URL)
 * @returns The transcribed text
 */
export async function transcribeVoice(fileUrl: string): Promise<string> {
    let tempPath: string | null = null;

    try {
        // Download the voice file from Telegram
        tempPath = await downloadToTemp(fileUrl, ".ogg");

        // Send to Groq's Whisper API
        const transcription = await groqClient.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: config.groq.whisperModel,
            response_format: "text",
        });

        const text = typeof transcription === "string"
            ? transcription.trim()
            : (transcription as unknown as { text: string }).text?.trim() ?? "";

        logger.info("Transcription complete.", { length: text.length });
        return text;
    } finally {
        // Clean up temp file
        if (tempPath && fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
            logger.debug("Cleaned up temp voice file.");
        }
    }
}

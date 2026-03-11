import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

/**
 * Convert text to speech using ElevenLabs API.
 * Returns the absolute path to a temp OGG audio file.
 */
export async function textToSpeech(text: string): Promise<string> {
    const voiceId = config.elevenlabs.voiceId;

    logger.info("Generating speech via ElevenLabs.", {
        voiceId,
        textLength: text.length,
    });

    const response = await fetch(
        `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`,
        {
            method: "POST",
            headers: {
                "xi-api-key": config.elevenlabs.apiKey,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
            },
            body: JSON.stringify({
                text,
                model_id: config.elevenlabs.model,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: true,
                },
            }),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempPath = path.join(os.tmpdir(), `jovi-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tempPath, buffer);

    logger.info("Speech generated.", { path: tempPath, bytes: buffer.length });
    return tempPath;
}

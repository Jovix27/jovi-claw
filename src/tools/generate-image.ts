import type OpenAI from "openai";
import { logger } from "../utils/logger.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Client } from "@gradio/client";

export const generateImageDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "generate_image",
        description: "Generate a beautiful image based on a prompt and send it to the user. Use this when the user asks for a picture, rendering, or visual generation.",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "A highly descriptive prompt of the image you want to generate.",
                }
            },
            required: ["prompt"],
        },
    },
};

export async function executeGenerateImage({ prompt }: { prompt: string }): Promise<string> {
    logger.info(`Generating image for prompt: ${prompt}`);
    try {
        const options = process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : {};
        const client = await Client.connect("black-forest-labs/FLUX.1-dev", options);

        const result = await client.predict("/infer", {
            prompt,
            seed: 0,
            randomize_seed: true,
            width: 1024,
            height: 1024,
            guidance_scale: 3.5,
            num_inference_steps: 28,
        }) as any;

        if (!result || !result.data || !result.data[0] || !result.data[0].url) {
            throw new Error(`Invalid response from FLUX.1-dev: ${JSON.stringify(result)}`);
        }

        const url = result.data[0].url;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch image from Gradio space: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const tempDir = os.tmpdir();
        const filePath = path.join(tempDir, `jovi-image-${Date.now()}.webp`);

        fs.writeFileSync(filePath, buffer);

        logger.info(`Image saved to ${filePath}`);

        // We return the file path inside the special "imageFile" key
        // We will modify loop.ts to catch "imageFile" and send Photo.
        return JSON.stringify({
            success: true,
            message: "I have successfully generated the image and it has been sent to the chat.",
            imageFile: filePath
        });

    } catch (error) {
        console.error("DEBUG ERR:", error);
        logger.error(`Error generating image`, { error });
        let errorMessage = "Unknown error";
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === "object") {
            errorMessage = JSON.stringify(error, null, 2);
        } else {
            errorMessage = String(error);
        }
        return JSON.stringify({ error: errorMessage });
    }
}

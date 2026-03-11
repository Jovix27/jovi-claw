import type OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DIR = path.resolve(__dirname, "../../.agent/skills");

export const readSkillDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "read_skill",
        description: "Read the full instructions and guidelines of a specific skill available in the project.",
        parameters: {
            type: "object",
            properties: {
                skillName: {
                    type: "string",
                    description: "The exact name of the skill to read (e.g., 'brainstorming-ideas')."
                }
            },
            required: ["skillName"]
        }
    }
};

export async function executeReadSkill(args: { skillName?: string }): Promise<string> {
    const { skillName } = args;
    if (!skillName) {
        return JSON.stringify({ error: "Missing skillName argument." });
    }

    // Prevent directory traversal attacks
    const safeName = path.basename(skillName);
    const skillPath = path.join(SKILLS_DIR, safeName, "SKILL.md");

    try {
        const content = await fs.readFile(skillPath, "utf-8");
        logger.debug(`Successfully read skill: ${safeName}`);
        return content;
    } catch (e: any) {
        logger.error(`Failed to read skill ${safeName}:`, { error: e.message });
        return JSON.stringify({ error: `Could not read skill '${safeName}'. Are you sure it exists?` });
    }
}

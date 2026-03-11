import { setCoreMemory } from "../utils/memory.js";

export const rememberFactDef = {
    type: "function" as const,
    function: {
        name: "remember_fact",
        description: "Save an important fact about the user to Core Memory. Use this when the user tells you something you should permanently remember (e.g. name, preferences, relationships).",
        parameters: {
            type: "object",
            properties: {
                key: {
                    type: "string",
                    description: "A short, snake_case key representing the fact (e.g., 'favorite_color', 'wife_name')."
                },
                value: {
                    type: "string",
                    description: "The value of the fact."
                }
            },
            required: ["key", "value"]
        }
    }
};

export async function executeRememberFact(args: { key: string, value: string }, userId?: number): Promise<string> {
    if (!userId) {
        return "Error: user_id is missing. Cannot save fact.";
    }

    try {
        await setCoreMemory(userId, args.key, args.value);
        return `Fact saved successfully: ${args.key} = ${args.value}`;
    } catch (e) {
        return `Failed to save fact: ${e}`;
    }
}

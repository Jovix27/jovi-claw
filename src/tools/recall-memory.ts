import { searchSemanticMemory } from "../utils/semantic.js";

export const recallMemoryDef = {
    type: "function" as const,
    function: {
        name: "recall_memory",
        description: "Search the user's past conversations for specific themes, obscure topics, or historical context. Use this if the user refers to past events not found in recent history or asks 'do you remember when...?'",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The search query to search for in past conversations. Formulate this as a summary sentence or specific keywords."
                }
            },
            required: ["query"]
        }
    }
};

export async function executeRecallMemory(args: { query: string }, userId?: number): Promise<string> {
    if (!userId) {
        return "Error: user_id is missing. Cannot search memory.";
    }

    try {
        const results = await searchSemanticMemory(userId, args.query, 5);
        if (results.length === 0) {
            return `No past memories found matching: "${args.query}"`;
        }

        return `Found ${results.length} relevant past exchanges:\n` + results.map((r, i) => `${i + 1}. ${r}`).join('\n\n');
    } catch (e) {
        return `Failed to search memory: ${e}`;
    }
}

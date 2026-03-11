import { chat } from "../llm/claude.js";
import { setCoreMemory, getRecentBuffer } from "./memory.js";
import { storeSemanticMemory } from "./semantic.js";
import { logger } from "./logger.js";

/**
 * Background process to extract facts and summarize recent buffers.
 * Runs asynchronously after the main agent loop.
 */
export async function extractFactsInBackground(userId: number, userMessage: string, assistantResponse: string) {
    // 1. Store the exact exchange in semantic memory for long-term recall
    const exchange = `User: ${userMessage}\nJovi: ${assistantResponse}`;
    storeSemanticMemory(userId, exchange).catch(e => logger.error("Background semantic store failed", { error: e }));

    // 2. Scan the recent buffer to see if we should update Core Memory
    // This is optional if we prefer the agent to explicitly call `remember_fact` tool.
    // Let's implement silent extraction for implicit facts.

    try {
        const recent = await getRecentBuffer(userId, 2); // get the latest exchange
        if (recent.length === 0) return;

        const systemPrompt = `You are a background memory extractor. 
Your job is to read the latest exchange between the User and Jovi, and extract any NEW, IMPORTANT, PERMANENT facts about the user.
Examples: name, age, city, medical conditions, strong preferences.
DO NOT extract fleeting feelings or temporary actions (e.g., "I am tired", "I just woke up").
If a fact is found, output a JSON array of objects with 'key' and 'value'.
Example: [{"key": "favorite_food", "value": "sushi"}, {"key": "dog_name", "value": "Rex"}]
If no permanent facts are found, output an empty array: []
ONLY OUTPUT VALID JSON. DO NOT WRAP IN MARKDOWN BLOCKS LIKE \`\`\`json.`;

        const messages = [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: exchange }
        ];

        const response = await chat(messages);
        const text = response.choices[0]?.message?.content?.trim();

        if (text && text !== "[]") {
            try {
                // Ensure text is clean JSON
                const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
                const facts = JSON.parse(cleanText) as { key: string, value: string }[];

                for (const fact of facts) {
                    await setCoreMemory(userId, fact.key, fact.value);
                    logger.info("Background fact extracted: " + fact.key + " = " + fact.value);
                }
            } catch (pErr) {
                logger.debug("No JSON facts extracted (or parse error)", { raw: text });
            }
        }
    } catch (e) {
        logger.error("Background fact extraction failed", { error: e });
    }
}

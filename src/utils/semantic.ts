import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import { config } from "../config/env.js";
import { logger } from "./logger.js";

let qclient: QdrantClient | null = null;
let openaiClient: OpenAI | null = null;

export async function initSemanticMemory() {
    if (!config.memory.qdrantUrl) {
        logger.warn("No QDRANT_URL found, skipping Tier 3 (Semantic Memory).");
        return;
    }
    if (!config.openai.apiKey && !config.openrouter.apiKey) {
        logger.warn("No OPENAI_API_KEY found, skipping embeddings.");
        return;
    }

    try {
        qclient = new QdrantClient({
            url: config.memory.qdrantUrl,
            apiKey: config.memory.qdrantApiKey
        });

        // Use true OpenAI for embeddings if provided, fallback to OpenRouter (if they support it)
        openaiClient = new OpenAI({
            apiKey: config.openai.apiKey || config.openrouter.apiKey,
            baseURL: config.openai.apiKey ? undefined : config.openrouter.baseUrl,
            defaultHeaders: config.openai.apiKey ? undefined : {
                "HTTP-Referer": "https://jovi-ai.local",
                "X-Title": "Jovi AI",
            }
        });

        // Ensure collection exists
        const collectionName = config.memory.qdrantCollection;

        try {
            await qclient.getCollection(collectionName);
        } catch (e: any) {
            logger.info(`Creating Qdrant collection: ${collectionName} (dimension 1536)`);
            await qclient.createCollection(collectionName, {
                vectors: {
                    size: 1536, // default for text-embedding-3-small
                    distance: 'Cosine'
                }
            });
        }

        logger.info("Semantic memory (Qdrant) initialized successfully.");
    } catch (e) {
        logger.error("Failed to initialize Qdrant", { error: e });
        qclient = null;
    }
}

async function getEmbedding(text: string): Promise<number[] | null> {
    if (!openaiClient) return null;
    try {
        // Assume text-embedding-3-small is available. 
        // If falling back to OpenRouter, they map some text-embedding to free models.
        const resp = await openaiClient.embeddings.create({
            input: text,
            model: "text-embedding-3-small",
        });
        return resp.data[0].embedding;
    } catch (e) {
        logger.error("Failed to get embedding", { error: e });
        return null;
    }
}

export async function storeSemanticMemory(userId: number, text: string) {
    if (!qclient) return;

    const embedding = await getEmbedding(text);
    if (!embedding) return;

    // Use Web Crypto randomUUID API available in Node >= 19
    const id = crypto.randomUUID();

    try {
        await qclient.upsert(config.memory.qdrantCollection, {
            wait: true,
            points: [{
                id: id,
                vector: embedding,
                payload: {
                    userId: userId,
                    text: text,
                    timestamp: Date.now()
                }
            }]
        });

        logger.debug("Stored semantic memory", { userId, id });
    } catch (e) {
        logger.error("Failed to store semantic memory in Qdrant", { error: e });
    }
}

export async function searchSemanticMemory(userId: number, query: string, topK: number = 5): Promise<string[]> {
    if (!qclient) return [];

    const embedding = await getEmbedding(query);
    if (!embedding) return [];

    try {
        const results = await qclient.search(config.memory.qdrantCollection, {
            vector: embedding,
            limit: topK,
            filter: {
                must: [{
                    key: "userId",
                    match: { value: userId }
                }]
            },
            with_payload: true
        });

        return results
            .filter((m: any) => m.payload && m.payload.text)
            .map((m: any) => m.payload!.text as string);
    } catch (e) {
        logger.error("Failed to search semantic memory in Qdrant", { error: e });
        return [];
    }
}

export async function storeLessonLearned(userId: number, taskDescription: string, lesson: string) {
    if (!qclient) return;

    const text = `[LESSON LEARNED from task: ${taskDescription}]\n${lesson}`;
    const embedding = await getEmbedding(text);
    if (!embedding) return;

    const id = crypto.randomUUID();

    try {
        await qclient.upsert(config.memory.qdrantCollection, {
            wait: true,
            points: [{
                id: id,
                vector: embedding,
                payload: {
                    userId: userId,
                    text: text,
                    type: "lesson",
                    timestamp: Date.now()
                }
            }]
        });

        logger.debug("Stored engineering lesson", { userId, id });
    } catch (e) {
        logger.error("Failed to store engineering lesson in Qdrant", { error: e });
    }
}

export async function searchLessons(userId: number, query: string, topK: number = 3): Promise<string[]> {
    if (!qclient) return [];

    const embedding = await getEmbedding(query);
    if (!embedding) return [];

    try {
        const results = await qclient.search(config.memory.qdrantCollection, {
            vector: embedding,
            limit: topK,
            filter: {
                must: [
                    { key: "userId", match: { value: userId } },
                    { key: "type", match: { value: "lesson" } }
                ]
            },
            with_payload: true
        });

        return results
            .filter((m: any) => m.payload && m.payload.text)
            .map((m: any) => m.payload!.text as string);
    } catch (e) {
        logger.error("Failed to search lessons in Qdrant", { error: e });
        return [];
    }
}

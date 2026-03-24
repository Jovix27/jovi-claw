import { createClient, Client } from "@libsql/client";
import { config } from "../config/env.js";
import { logger } from "./logger.js";

interface CoreFact {
    fact_key: string;
    fact_value: string;
}

interface BufferMessage {
    id: number;
    user_id: number;
    thread_id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp: number;
}

export interface ChatThread {
    thread_id: string;
    title: string;
    updated_at: number;
}

let db: Client | null = null;

export async function initMemoryDB() {
    if (db) return;

    logger.info("Initializing SQLite memory database", { path: config.memory.dbPath });
    db = createClient({
        url: `file:${config.memory.dbPath}`,
    });

    // Create tables
    await db.execute(`
        CREATE TABLE IF NOT EXISTS core_memory (
            user_id INTEGER NOT NULL,
            fact_key TEXT NOT NULL,
            fact_value TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, fact_key)
        );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS conversation_buffer (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            thread_id TEXT NOT NULL DEFAULT 'default',
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );
    `);

    try {
        await db.execute("ALTER TABLE conversation_buffer ADD COLUMN thread_id TEXT NOT NULL DEFAULT 'default';");
        logger.info("Migrated conversation_buffer to include thread_id");
    } catch {} // Ignore error if column already exists

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_buffer_user ON conversation_buffer(user_id);
    `);
}

export function closeMemoryDB() {
    if (db) {
        db.close();
        db = null;
        logger.info("Closed SQLite memory database");
    }
}

// ─── Core Memory ─────────────────────────────────────────────────────────────

export async function getCoreMemory(userId: number): Promise<CoreFact[]> {
    if (!db) await initMemoryDB();
    const result = await db!.execute({
        sql: "SELECT fact_key, fact_value FROM core_memory WHERE user_id = ?",
        args: [userId]
    });
    return result.rows as unknown as CoreFact[];
}

export async function setCoreMemory(userId: number, key: string, value: string) {
    if (!db) await initMemoryDB();
    await db!.execute({
        sql: `
            INSERT INTO core_memory (user_id, fact_key, fact_value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, fact_key) DO UPDATE SET fact_value = excluded.fact_value, updated_at = excluded.updated_at
        `,
        args: [userId, key, value, Date.now()]
    });
    logger.debug("Core memory updated", { userId, key });
}

export async function deleteCoreMemory(userId: number, key: string) {
    if (!db) await initMemoryDB();
    await db!.execute({
        sql: "DELETE FROM core_memory WHERE user_id = ? AND fact_key = ?",
        args: [userId, key]
    });
}

// ─── Conversation Buffer ─────────────────────────────────────────────────────

export async function addMessageToBuffer(userId: number, role: "user" | "assistant" | "system" | "tool", content: string, threadId: string = "default") {
    if (!db) await initMemoryDB();
    await db!.execute({
        sql: "INSERT INTO conversation_buffer (user_id, thread_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
        args: [userId, threadId, role, content, Date.now()]
    });
}

export async function getRecentBuffer(userId: number, limit: number = 20, threadId: string = "default"): Promise<BufferMessage[]> {
    if (!db) await initMemoryDB();
    const result = await db!.execute({
        sql: `
            SELECT id, user_id, thread_id, role, content, timestamp 
            FROM conversation_buffer 
            WHERE user_id = ? AND thread_id = ?
            ORDER BY timestamp DESC 
            LIMIT ?
        `,
        args: [userId, threadId, limit]
    });

    const msgs = result.rows as unknown as BufferMessage[];
    return msgs.reverse();
}

export async function compactBufferFallback(userId: number, keepCount: number = 20, threadId: string = "default") {
    if (!db) await initMemoryDB();
    await db!.execute({
        sql: `
            DELETE FROM conversation_buffer 
            WHERE id IN (
                SELECT id FROM conversation_buffer 
                WHERE user_id = ? AND thread_id = ?
                ORDER BY timestamp DESC 
                LIMIT -1 OFFSET ?
            )
        `,
        args: [userId, threadId, keepCount]
    });
}

export async function getHistoryThreads(userId: number): Promise<ChatThread[]> {
    if (!db) await initMemoryDB();
    const result = await db!.execute({
        sql: `
            SELECT 
                thread_id,
                MAX(timestamp) as updated_at,
                (SELECT content FROM conversation_buffer b2 WHERE b2.user_id = b1.user_id AND b2.thread_id = b1.thread_id AND b2.role = 'user' ORDER BY id ASC LIMIT 1) as title
            FROM conversation_buffer b1
            WHERE user_id = ?
            GROUP BY thread_id
            ORDER BY updated_at DESC
        `,
        args: [userId]
    });

    return result.rows.map(row => ({
        thread_id: String(row.thread_id),
        title: String(row.title || "New Conversation"),
        updated_at: Number(row.updated_at)
    }));
}

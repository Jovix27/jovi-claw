import { createClient, Client } from "@libsql/client";
import { config } from "../config/env.js";
import { logger } from "./logger.js";

let db: Client | null = null;

/**
 * Initialize the heartbeat state table in SQLite.
 * Called during startup before scheduler init.
 */
export async function initHeartbeatState(): Promise<void> {
    if (db) return;

    logger.debug("Initializing heartbeat state table.");
    db = createClient({
        url: `file:${config.memory.dbPath}`,
    });

    await db.execute(`
        CREATE TABLE IF NOT EXISTS heartbeat_state (
            user_id INTEGER PRIMARY KEY,
            last_sent INTEGER,
            preferences TEXT,
            catch_up_enabled INTEGER DEFAULT 1
        );
    `);
}

/**
 * Get the timestamp of the last heartbeat sent to a user.
 */
export async function getLastHeartbeat(userId: number): Promise<number | null> {
    if (!db) await initHeartbeatState();
    const result = await db!.execute({
        sql: "SELECT last_sent FROM heartbeat_state WHERE user_id = ?",
        args: [userId],
    });
    return (result.rows[0]?.last_sent as number) ?? null;
}

/**
 * Record that a heartbeat was sent to a user.
 */
export async function setLastHeartbeat(userId: number, timestamp: number): Promise<void> {
    if (!db) await initHeartbeatState();
    await db!.execute({
        sql: `
            INSERT INTO heartbeat_state (user_id, last_sent)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET last_sent = excluded.last_sent
        `,
        args: [userId, timestamp],
    });
}

/**
 * Get user preferences for heartbeat customization.
 */
export async function getHeartbeatPreferences(userId: number): Promise<Record<string, string> | undefined> {
    if (!db) await initHeartbeatState();
    const result = await db!.execute({
        sql: "SELECT preferences FROM heartbeat_state WHERE user_id = ?",
        args: [userId],
    });
    const raw = result.rows[0]?.preferences as string | undefined;
    return raw ? JSON.parse(raw) : undefined;
}

/**
 * Save user preferences for heartbeat customization.
 */
export async function setHeartbeatPreferences(
    userId: number,
    preferences: Record<string, string>
): Promise<void> {
    if (!db) await initHeartbeatState();
    await db!.execute({
        sql: `
            INSERT INTO heartbeat_state (user_id, preferences)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences
        `,
        args: [userId, JSON.stringify(preferences)],
    });
}

/**
 * Determine if a catch-up heartbeat should be sent.
 * Returns true if:
 *   - No heartbeat was ever sent, OR
 *   - Last heartbeat was not today
 */
export async function shouldCatchUp(userId: number): Promise<boolean> {
    if (!db) await initHeartbeatState();

    const result = await db!.execute({
        sql: "SELECT last_sent, catch_up_enabled FROM heartbeat_state WHERE user_id = ?",
        args: [userId],
    });

    const row = result.rows[0];

    // If no record exists, we should catch up
    if (!row) return true;

    // If catch-up is disabled for this user, skip
    if (!row.catch_up_enabled) return false;

    const lastSent = row.last_sent as number | null;

    // Never sent before → catch up
    if (!lastSent) return true;

    // Check if heartbeat was already sent today
    const today = new Date();
    const lastDate = new Date(lastSent);

    const isSameDay =
        lastDate.getFullYear() === today.getFullYear() &&
        lastDate.getMonth() === today.getMonth() &&
        lastDate.getDate() === today.getDate();

    return !isSameDay;
}

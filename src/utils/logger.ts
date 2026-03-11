import { config } from "../config/env.js";
import { maskSecrets } from "../security/secret-masker.js";

// ─── Log levels with numeric priority ───────────────────
const LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
} as const;

type LogLevel = keyof typeof LEVELS;

const currentLevel: number = LEVELS[config.logLevel] ?? LEVELS.info;

// ─── Timestamp ──────────────────────────────────────────
function timestamp(): string {
    return new Date().toISOString();
}

// ─── Logger ─────────────────────────────────────────────
function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (LEVELS[level] < currentLevel) return;

    const prefix = `${timestamp()} [${level.toUpperCase().padEnd(5)}]`;
    // Mask secrets before writing to any output
    const safeMessage = maskSecrets(message);
    const safeData = data ? maskSecrets(JSON.stringify(data)) : undefined;
    const line = safeData
        ? `${prefix} ${safeMessage} ${safeData}`
        : `${prefix} ${safeMessage}`;

    switch (level) {
        case "error":
            console.error(line);
            break;
        case "warn":
            console.warn(line);
            break;
        default:
            console.log(line);
    }
}

export const logger = {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};

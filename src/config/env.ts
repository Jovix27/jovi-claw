import "dotenv/config";

// ─── Required env vars ──────────────────────────────────
function required(key: string): string {
    const value = process.env[key];
    if (!value) {
        console.error(`❌ Missing required environment variable: ${key}`);
        console.error(`   Copy .env.example → .env and fill in your values.`);
        process.exit(1);
    }
    return value;
}

function optional(key: string, fallback: string): string {
    return process.env[key] || fallback;
}

// ─── Parse allowed user IDs ─────────────────────────────
function parseUserIds(raw: string): number[] {
    return raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
        .map((id) => {
            const num = Number(id);
            if (Number.isNaN(num)) {
                console.error(`❌ Invalid user ID in ALLOWED_USER_IDS: "${id}"`);
                process.exit(1);
            }
            return num;
        });
}

// ─── Exported config ────────────────────────────────────
export const config = {
    telegram: {
        botToken: required("TELEGRAM_BOT_TOKEN"),
    },

    openrouter: {
        apiKey: optional("OPENROUTER_API_KEY", ""),
        model: optional("OPENROUTER_MODEL", "google/gemini-2.0-flash-001"),
        baseUrl: "https://openrouter.ai/api/v1",
    },

    mistral: {
        apiKey: optional("MISTRAL_API_KEY", ""),
        model: optional("MISTRAL_MODEL", "mistral-small-latest"),
        baseUrl: "https://api.mistral.ai/v1",
    },

    gemini: {
        apiKey: optional("GEMINI_API_KEY", ""),
        model: optional("GEMINI_MODEL", "gemini-2.0-flash"),
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    },

    openai: {
        apiKey: optional("OPENAI_API_KEY", ""),
    },

    groq: {
        apiKey: required("GROQ_API_KEY"),
        baseUrl: "https://api.groq.com/openai/v1",
        whisperModel: "whisper-large-v3",
    },

    elevenlabs: {
        apiKey: required("ELEVENLABS_API_KEY"),
        voiceId: optional("ELEVENLABS_VOICE_ID", "onwK4e9ZLuTAKqWW03F9"),
        model: optional("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
    },

    security: {
        allowedUserIds: parseUserIds(required("ALLOWED_USER_IDS")),
        godMode: optional("GOD_MODE", "false") === "true",
    },

    memory: {
        dbPath: optional("DB_PATH", "jovi_memory.db"),
        qdrantUrl: optional("QDRANT_URL", ""),
        qdrantApiKey: optional("QDRANT_API_KEY", ""),
        qdrantCollection: optional("QDRANT_COLLECTION", "gravity-claw"),
    },

    logLevel: optional("LOG_LEVEL", "info") as
        | "debug"
        | "info"
        | "warn"
        | "error",

    heartbeat: {
        enabled: optional("HEARTBEAT_ENABLED", "true") === "true",
        hour: parseInt(optional("HEARTBEAT_HOUR", "8"), 10),
        minute: parseInt(optional("HEARTBEAT_MINUTE", "0"), 10),
        timezone: optional("HEARTBEAT_TIMEZONE", ""),
        catchUpOnMissed: optional("HEARTBEAT_CATCH_UP", "true") === "true",
    },

    remoteControl: {
        secret: optional("REMOTE_CONTROL_SECRET", ""),
        port: parseInt(optional("REMOTE_CONTROL_PORT", process.env.PORT || "3001"), 10),
    },
} as const;

export type Config = typeof config;

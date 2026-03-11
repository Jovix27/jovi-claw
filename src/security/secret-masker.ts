/**
 * Secret masker — replaces known secret patterns in log strings
 * before they can be written to stdout/stderr.
 *
 * Patterns cover:
 *   - API keys for common providers
 *   - GitHub PATs (classic and fine-grained)
 *   - JWT tokens
 *   - Telegram bot tokens
 *   - Generic "Bearer <token>" headers
 *
 * Also dynamically registers any value loaded from process.env that
 * looks like a secret (≥20 chars, non-trivial).
 */

interface MaskRule {
    pattern: RegExp;
    replacement: string;
}

const STATIC_RULES: MaskRule[] = [
    // OpenAI / OpenRouter keys
    { pattern: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: "[MASKED:sk-key]" },
    // Groq keys
    { pattern: /gsk_[a-zA-Z0-9_]{20,}/g, replacement: "[MASKED:groq-key]" },
    // Pinecone keys
    { pattern: /pcsk_[a-zA-Z0-9_]{20,}/g, replacement: "[MASKED:pinecone-key]" },
    // GitHub classic PAT
    { pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: "[MASKED:github-pat]" },
    // GitHub fine-grained PAT
    { pattern: /github_pat_[a-zA-Z0-9_]{80,}/g, replacement: "[MASKED:github-pat]" },
    // Supabase service/access tokens
    { pattern: /sbp_[a-zA-Z0-9]{40,}/g, replacement: "[MASKED:supabase-token]" },
    // ElevenLabs keys (typically 32 hex chars)
    { pattern: /\b[a-f0-9]{32}\b/g, replacement: "[MASKED:hex-key]" },
    // JWT tokens (3-part base64url)
    { pattern: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: "[MASKED:jwt]" },
    // Telegram bot token format: digits:alphanum
    { pattern: /\d{8,}:[a-zA-Z0-9_-]{35,}/g, replacement: "[MASKED:telegram-token]" },
    // Generic Bearer tokens
    { pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/gi, replacement: "Bearer [MASKED]" },
];

// ─── Dynamic rules from environment ─────────────────────
const dynamicPatterns: RegExp[] = [];

const SECRET_ENV_KEYS = [
    "TELEGRAM_BOT_TOKEN",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "ELEVENLABS_API_KEY",
    "PINECONE_API_KEY",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "SUPABASE_ACCESS_TOKEN",
];

for (const key of SECRET_ENV_KEYS) {
    const val = process.env[key];
    if (val && val.length >= 20) {
        // Escape any regex special chars in the literal value
        const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        dynamicPatterns.push(new RegExp(escaped, "g"));
    }
}

/**
 * Masks all known secret patterns in a string.
 * Safe to call on any log message.
 */
export function maskSecrets(input: string): string {
    let output = input;

    for (const rule of STATIC_RULES) {
        output = output.replace(rule.pattern, rule.replacement);
    }

    for (const pattern of dynamicPatterns) {
        // Reset lastIndex for global regexes used in a loop
        pattern.lastIndex = 0;
        output = output.replace(pattern, "[MASKED:env-secret]");
    }

    return output;
}

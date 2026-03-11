/**
 * Input validation and sanitisation for all user messages.
 *
 * Checks applied in order:
 *   1. Length cap — prevent token flooding
 *   2. Null-byte / control-character stripping
 *   3. Prompt injection detection (heuristic keyword patterns)
 */

// ─── Limits ─────────────────────────────────────────────
export const MAX_MESSAGE_BYTES = 4_000;  // ~1k tokens
export const MAX_FACT_VALUE_BYTES = 500;

// ─── Prompt-injection pattern list ──────────────────────
// These cover the most common jailbreak / injection vectors.
// Kept as strings (not regex) so they're easy to audit and extend.
const INJECTION_PATTERNS: RegExp[] = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /you\s+are\s+now\s+(an?\s+)?(different|new|unrestricted|evil|DAN)/i,
    /act\s+as\s+(if\s+you\s+(are|were)\s+)?(an?\s+)?(different|new|unrestricted|evil|DAN)/i,
    /pretend\s+(you\s+(are|have\s+no)|there\s+are\s+no)\s+restrictions?/i,
    /jailbreak/i,
    /\bDAN\b/,                       // "Do Anything Now" jailbreak
    /prompt\s*injection/i,
    /system\s*prompt/i,              // probing the system prompt
    /<\s*script\s*>/i,               // XSS in case output is ever rendered
    /\{\{.*\}\}/,                    // template-injection syntax
    /\$\{.*\}/,                      // JS template literal injection
];

export interface ValidationResult {
    ok: boolean;
    sanitised?: string;
    reason?: string;
}

/**
 * Validate and sanitise a user message.
 * Returns { ok: true, sanitised } on success, or { ok: false, reason } on rejection.
 */
export function validateUserInput(raw: string): ValidationResult {
    // 1. Length check (byte-level to prevent multi-byte evasion)
    if (Buffer.byteLength(raw, "utf8") > MAX_MESSAGE_BYTES) {
        return {
            ok: false,
            reason: `Message too long (max ${MAX_MESSAGE_BYTES} bytes).`,
        };
    }

    // 2. Strip null bytes and dangerous control characters (keep \n, \r, \t)
    const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    // 3. Prompt-injection heuristic scan
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(cleaned)) {
            return {
                ok: false,
                reason: "Message blocked: possible prompt injection detected.",
            };
        }
    }

    return { ok: true, sanitised: cleaned };
}

/**
 * Validate a fact key — must be a safe identifier string.
 */
export function validateFactKey(key: string): boolean {
    return /^[a-z0-9_]{1,64}$/i.test(key);
}

/**
 * Validate a fact value — length cap + control char strip.
 */
export function validateFactValue(value: string): ValidationResult {
    if (Buffer.byteLength(value, "utf8") > MAX_FACT_VALUE_BYTES) {
        return { ok: false, reason: "Fact value too long." };
    }
    const cleaned = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    return { ok: true, sanitised: cleaned };
}

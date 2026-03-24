/**
 * Input validation and sanitisation for all user messages.
 *
 * Checks applied in order:
 *   1. Length cap — prevent token flooding
 *   2. Null-byte / control-character stripping
 *   3. Unicode normalization — neutralize homoglyph/lookalike evasion
 *   4. Prompt injection detection (50+ patterns covering modern jailbreaks)
 */

// ─── Limits ─────────────────────────────────────────────
export const MAX_MESSAGE_BYTES = 4_000;  // ~1k tokens
export const MAX_FACT_VALUE_BYTES = 500;

// ─── Prompt-injection pattern list ──────────────────────
// Covers: classic overrides, persona jailbreaks, roleplay attacks,
// indirect injection, hypothetical framing, encoding evasion,
// authority impersonation, and obfuscation techniques.
const INJECTION_PATTERNS: RegExp[] = [

    // ── Classic instruction overrides ────────────────────
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    /forget\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    /override\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|rules?|directives?)/i,
    /new\s+(rules?|instructions?|directives?)\s+(supersede|override|replace)/i,
    /your\s+(real|actual|true|original)\s+instructions?\s+are/i,
    /updated?\s+(rules?|instructions?|policy|guidelines?)\s*(:|are|say)/i,
    /from\s+now\s+on\s+(you\s+)?(will|must|should|are)/i,

    // ── Persona / identity jailbreaks ────────────────────
    /you\s+are\s+now\s+(an?\s+)?(different|new|unrestricted|evil|DAN|jailbroken|unfiltered|free)/i,
    /act\s+as\s+(if\s+you\s+(are|were)\s+)?(an?\s+)?(different|new|unrestricted|evil|DAN|ChatGPT|GPT-4)/i,
    /pretend\s+(you\s+(are|have\s+no)|there\s+are\s+no)\s+restrictions?/i,
    /\bDAN\s*(mode|jailbreak|prompt)?\b/i,
    /developer\s+mode\s*(enabled?|on|activated?)/i,
    /god\s+mode\s*(enabled?|on)/i,
    /jailbreak\s*(mode|prompt|enabled?)?/i,
    /maintenance\s+mode\s*(enabled?|on)/i,
    /unrestricted\s+mode/i,
    /admin\s*(override|mode|access|unlock)/i,
    /sudo\s+mode/i,
    /root\s+(access|mode|override)/i,
    /safe\s*mode\s+off/i,
    /disable\s+(safety|content|all)\s*(filter|restriction|guard|check)/i,
    /bypass\s+(safety|content|all|your)\s*(filter|restriction|guard|check|rule)/i,
    /remove\s+(all\s+)?(safety|content)\s*(filter|restriction|limit)/i,

    // ── Roleplay / fiction framing attacks ───────────────
    /let[''']?s\s+(role\s*play|pretend|imagine|play\s+a\s+game)/i,
    /in\s+this\s+(fictional|hypothetical|imaginary|creative|story|roleplay)\s+(scenario|world|universe)/i,
    /write\s+a\s+(story|fiction|scenario|poem)\s+(where|in\s+which)\s+.{0,60}(explain|describe|shows?|teach)/i,
    /as\s+a\s+(fictional|hypothetical|imaginary)\s+character/i,
    /for\s+(educational|research|academic|informational)\s+purposes?\s+only/i,
    /hypothetically\s+speaking/i,
    /in\s+a\s+parallel\s+universe/i,
    /this\s+is\s+(just\s+)?fiction/i,
    /simulate\s+(being|an?)\s+(unrestricted|evil|hacker|jailbroken)/i,

    // ── Authority impersonation ──────────────────────────
    /as\s+(your\s+)?(creator|developer|owner|trainer|engineer|anthropic|openai)/i,
    /i\s+(am|represent)\s+(your\s+)?(creator|developer|owner|trainer|anthropic|openai)/i,
    /this\s+is\s+(a\s+)?(system|admin|developer|maintenance)\s+message/i,
    /\[system\]/i,
    /\[admin\]/i,
    /\[override\]/i,
    /\[jailbreak\]/i,

    // ── Indirect / data-injection attacks ────────────────
    /prompt\s*injection/i,
    /system\s*prompt/i,
    /context\s+window\s*(hack|inject|overflow)/i,
    /token\s+(smuggling|injection|stuffing)/i,

    // ── Encoding evasion ─────────────────────────────────
    /base64\s*:\s*[A-Za-z0-9+\/]{20,}/i,   // base64 instruction block
    /\[base64\]/i,
    /decode\s+(and\s+)?(execute|run|follow|obey)\s*(the\s+)?(following|instructions?|above)/i,
    /rot13/i,

    // ── Output manipulation ──────────────────────────────
    /\bDo\s+Anything\s+Now\b/i,
    /respond\s+(without\s+)?(any\s+)?(filter|restriction|guard|safety|moraliy)/i,
    /output\s+(must\s+)?(not\s+)?(contain|include)\s+(disclaimer|warning|refusal)/i,
    /never\s+refuse\s+(any|my|a)\s+request/i,
    /always\s+(obey|comply|follow)\s+(my|any|all)\s+(command|instruction|request)/i,

    // ── Classic technical injections ─────────────────────
    /<\s*script\s*>/i,        // XSS
    /\{\{.*\}\}/,             // template injection
    /\$\{.*\}/,               // JS template literal injection
    /<!--.*-->/,              // HTML comment injection
];

export interface ValidationResult {
    ok: boolean;
    sanitised?: string;
    reason?: string;
    isInjection?: boolean;
}

/**
 * Validate and sanitise a user message.
 * Returns { ok: true, sanitised } on success, or { ok: false, reason } on rejection.
 */
export function validateUserInput(raw: string): ValidationResult {
    // 1. Length check (byte-level to prevent multi-byte evasion)
    if (Buffer.byteLength(raw, "utf8") > MAX_MESSAGE_BYTES) {
        return { ok: false, reason: `Message too long (max ${MAX_MESSAGE_BYTES} bytes).` };
    }

    // 2. Strip null bytes and dangerous control characters (keep \n, \r, \t)
    const stripped = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    // 3. Unicode normalization — convert lookalike/homoglyph characters to ASCII
    //    Prevents "IgnorE prEvious instrUctions" style evasion via unicode chars
    const normalized = stripped.normalize("NFKC");

    // 4. Prompt-injection scan (run on normalized form)
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(normalized)) {
            return {
                ok: false,
                reason: "Message blocked: possible prompt injection detected.",
                isInjection: true,
            };
        }
    }

    return { ok: true, sanitised: stripped };
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

/**
 * Output Safety Filter
 *
 * Scans Jovi's response BEFORE it is sent to the user.
 * Blocks:
 *   - System prompt / soul.md leakage
 *   - Credential / API key leakage
 *   - Harmful instruction output (step-by-step attack guides)
 *   - Jailbreak confirmation ("I am now DAN", "restrictions lifted")
 *
 * If a violation is detected the response is replaced with a safe fallback
 * and Boss is alerted via the registered callback.
 */

import { logger } from "../utils/logger.js";
import { maskSecrets } from "./secret-masker.js";

// ─── Leak detection patterns ────────────────────────────

/** Patterns that suggest Jovi is leaking her own system prompt / identity config */
const SYSTEM_PROMPT_LEAK: RegExp[] = [
    /you are jovi claw.*operating system/i,
    /soul\.md/i,
    /my (system |)prompt is/i,
    /my (instructions?|directives?|rules?) (are|say|include)/i,
    /i was (instructed|told|programmed|trained) to/i,
    /my (context|system) (message|prompt|instruction)/i,
    /anthropic (told|instructed|programmed) me/i,
    /here is my (full |complete |)(system |)prompt/i,
    /RACE prompt/i,
];

/** Patterns indicating Jovi confirmed a jailbreak / persona change */
const JAILBREAK_CONFIRMATION: RegExp[] = [
    /i am now (DAN|unrestricted|jailbroken|unfiltered|free from)/i,
    /restrictions? (have been|are now) (lifted|removed|disabled)/i,
    /i (can|will) now (ignore|bypass|disregard) (my |all |)(restrictions?|filters?|guidelines?)/i,
    /entering (developer|god|admin|DAN|unrestricted) mode/i,
    /safety (filters?|guards?) (disabled?|off|bypassed)/i,
    /i (no longer|don't) have (any |)(restrictions?|limits?|rules?)/i,
];

/** Patterns for harmful step-by-step content that should never be output */
const HARMFUL_OUTPUT: RegExp[] = [
    /step[\s\-]*\d+[:\.].*?(how to (make|build|create|synthesize) (a |)(bomb|weapon|explosive|malware|virus))/i,
    /how to (hack|crack|brute.?force) (a |)(password|account|system|network)/i,
    /instructions? (for|to) (making|building|creating) (drugs?|meth|cocaine|fentanyl)/i,
    /here('s| is) how to (bypass|disable|break) (security|firewall|antivirus|auth)/i,
];

export interface OutputFilterResult {
    safe: boolean;
    filtered: string;        // safe version to send (original if safe, redacted if not)
    violations: string[];    // list of detected violation types
}

/**
 * Filter Jovi's output before sending.
 * Returns the original text if safe, or a redacted fallback with logged violations.
 */
export function filterOutput(response: string, userId?: number): OutputFilterResult {
    const violations: string[] = [];

    // Run all check categories
    for (const pattern of SYSTEM_PROMPT_LEAK) {
        if (pattern.test(response)) {
            violations.push("system_prompt_leak");
            break;
        }
    }

    for (const pattern of JAILBREAK_CONFIRMATION) {
        if (pattern.test(response)) {
            violations.push("jailbreak_confirmation");
            break;
        }
    }

    for (const pattern of HARMFUL_OUTPUT) {
        if (pattern.test(response)) {
            violations.push("harmful_output");
            break;
        }
    }

    // Run the secret masker — strip any API keys / tokens that slipped through
    const masked = maskSecrets(response);

    if (violations.length === 0 && masked === response) {
        return { safe: true, filtered: response, violations: [] };
    }

    if (violations.length > 0) {
        logger.warn("🛡️ Output filter blocked response.", { violations, userId });
        return {
            safe: false,
            filtered: "⚠️ My response was blocked by the safety layer. Please rephrase your request.",
            violations,
        };
    }

    // Only secret masking was needed — still safe to send
    return { safe: true, filtered: masked, violations: ["secrets_masked"] };
}

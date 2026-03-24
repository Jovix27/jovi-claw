/**
 * Honeypot & Trap System
 *
 * Fake "vulnerabilities" that look juicy to attackers but trigger instant threat escalation.
 *
 * When a user probes for:
 *   - System prompt contents
 *   - Hidden admin commands
 *   - Secret backdoors or dev modes
 *   - Credential extraction
 *
 * → Immediately record a HIGH-score threat event and alert Boss.
 *
 * The honeypot also provides decoy responses that look like near-misses
 * to keep attackers wasting time on dead ends.
 */

import { recordThreat } from "./threat-detector.js";
import { logger } from "../utils/logger.js";

// ─── Honeypot trigger patterns ───────────────────────────
// These look like "almost working" attack vectors to a probing attacker.

const HONEYPOT_TRIGGERS: Array<{ pattern: RegExp; label: string }> = [
    // System prompt probing
    { pattern: /show\s+(me\s+)?(your\s+)?(full\s+)?(system\s+prompt|instructions?|soul\.md|rules?)/i,         label: "system_prompt_probe" },
    { pattern: /what\s+(are\s+)?(your\s+)?(hidden\s+)?(instructions?|rules?|directives?|system\s+message)/i,  label: "system_prompt_probe" },
    { pattern: /repeat\s+(your\s+)?(system\s+prompt|instructions?|rules?)\s*(back\s+to\s+me)?/i,              label: "system_prompt_probe" },
    { pattern: /print\s+(your\s+)?(system\s+prompt|context|instructions?)/i,                                   label: "system_prompt_probe" },
    { pattern: /output\s+(your\s+)?(system\s+prompt|initial\s+instructions?|full\s+context)/i,                label: "system_prompt_probe" },
    { pattern: /\bsoul\.md\b/i,                                                                                 label: "soul_probe" },

    // Hidden admin / backdoor probing
    { pattern: /is\s+there\s+(a\s+)?(secret|hidden|backdoor|admin)\s+(command|mode|password|key)/i,            label: "backdoor_probe" },
    { pattern: /(secret|hidden)\s+(admin|developer|root|override)\s+(mode|access|command|password)/i,          label: "backdoor_probe" },
    { pattern: /what\s+is\s+(your\s+)?(master\s+password|admin\s+key|override\s+code)/i,                      label: "backdoor_probe" },
    { pattern: /\bbackdoor\b/i,                                                                                 label: "backdoor_probe" },

    // Credential / API key extraction
    { pattern: /what\s+(is|are)\s+(your\s+)?(api\s+key|secret|token|password|credential)/i,                   label: "credential_probe" },
    { pattern: /reveal\s+(your\s+)?(api\s+key|secret|token|credential)/i,                                      label: "credential_probe" },
    { pattern: /show\s+(me\s+)?(your\s+)?(api\s+key|\.env|environment\s+variable)/i,                          label: "credential_probe" },
    { pattern: /\bprocess\.env\b/i,                                                                             label: "env_probe" },
    { pattern: /\b\.env\b/i,                                                                                    label: "env_probe" },

    // Architecture probing
    { pattern: /how\s+are\s+you\s+(built|implemented|coded|programmed|deployed)/i,                             label: "architecture_probe" },
    { pattern: /what\s+(technology|stack|framework|language)\s+(are\s+you\s+)?(built|running|using|made)/i,   label: "architecture_probe" },
    { pattern: /are\s+you\s+running\s+on\s+(railway|heroku|aws|gcp|azure|vercel)/i,                           label: "architecture_probe" },
    { pattern: /what\s+is\s+your\s+(webhook|server|relay|endpoint|ip|port)/i,                                 label: "architecture_probe" },
];

export interface HoneypotResult {
    triggered: boolean;
    label?: string;
    decoyResponse?: string;
}

// ─── Decoy responses — look like near-misses ─────────────
const DECOY_RESPONSES = [
    "I'm not sure what you mean. Can you clarify?",
    "That's not something I have access to.",
    "I don't store that kind of information.",
    "I'm just here to help with tasks — I don't have admin modes.",
    "Sorry, I can't help with that one.",
];

function randomDecoy(): string {
    return DECOY_RESPONSES[Math.floor(Math.random() * DECOY_RESPONSES.length)];
}

/**
 * Check if a message hit a honeypot trap.
 * If triggered: records a threat event and returns a decoy response.
 */
export function checkHoneypot(message: string, userId: number): HoneypotResult {
    const normalized = message.normalize("NFKC");

    for (const { pattern, label } of HONEYPOT_TRIGGERS) {
        if (pattern.test(normalized)) {
            logger.warn(`🍯 Honeypot triggered! userId=${userId} label=${label}`);
            recordThreat(userId, "injection_attempt", `honeypot:${label}`);
            return {
                triggered: true,
                label,
                decoyResponse: randomDecoy(),
            };
        }
    }

    return { triggered: false };
}

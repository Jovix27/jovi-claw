/**
 * Threat Detection & Counter-Defense System
 *
 * Tracks a threat score per userId / IP.
 * Threat levels: NORMAL → ELEVATED → HIGH → CRITICAL
 * Auto-bans repeat offenders and fires an alert to Boss.
 *
 * Counter-defense:
 *   On HIGH  → Boss notified with attacker profile
 *   On CRITICAL / BAN threshold → attacker banned + Boss alerted immediately
 */

import { logger } from "../utils/logger.js";

// ─── Types ───────────────────────────────────────────────
export type ThreatLevel = "NORMAL" | "ELEVATED" | "HIGH" | "CRITICAL";

interface ThreatRecord {
    score: number;
    lastEvent: number;
    violations: string[];
    banned: boolean;
    bannedAt?: number;
    alertedAt?: number;       // last time Boss was alerted for this entity
    // Adaptive scoring state
    recentEvents: number[];   // timestamps of last N events (for burst detection)
    consecutiveCount: number; // consecutive same-type events
    lastEventType: string;
    // Confidence tracking
    banCandidateSince?: number; // when score first hit BAN_THRESHOLD
}

// ─── Config ──────────────────────────────────────────────
const THRESHOLDS: Record<ThreatLevel, number> = {
    NORMAL:   0,
    ELEVATED: 10,
    HIGH:     25,
    CRITICAL: 50,
};
const BAN_THRESHOLD           = 75;     // score needed to START ban consideration
const BAN_CONFIDENCE_WINDOW   = 60_000; // must stay above threshold for 60s before ban fires
const DECAY_PER_HOUR          = 2;      // score decay per idle hour
const ALERT_COOLDOWN_MS       = 5 * 60_000;
const MAX_VIOLATION_LOG       = 30;
const BURST_WINDOW_MS         = 30_000; // 30s window for burst detection
const BURST_MULTIPLIER        = 1.5;    // score multiplier when events burst

// Base score per event type
const EVENT_SCORES: Record<string, number> = {
    auth_blocked:         5,
    injection_attempt:    20,
    command_blocked:      12,
    rate_limit_exceeded:  4,
    relay_unauthorized:   25,
    rapid_fire_flood:     10,
    unicode_evasion:      15,
    encoded_attack:       18,
    repeated_rejection:   8,
};

// Severity multipliers per event (context-aware adaptive scoring)
const SEVERITY_WEIGHTS: Record<string, number> = {
    injection_attempt:  1.5,   // injection is always serious
    relay_unauthorized: 2.0,   // relay attacks are critical infrastructure
    encoded_attack:     1.8,   // encoding evasion = sophisticated attacker
    unicode_evasion:    1.6,
    command_blocked:    1.3,
    auth_blocked:       1.0,
    rate_limit_exceeded: 0.8,  // could be accidental
    repeated_rejection:  1.0,
};

// ─── State ───────────────────────────────────────────────
const threatMap = new Map<string, ThreatRecord>();
let bossAlertCallback: ((msg: string) => Promise<void>) | null = null;

// ─── Public API ──────────────────────────────────────────

/**
 * Register a callback that sends an alert to Boss (called with a Markdown string).
 * Wire this in index.ts to bot.api.sendMessage.
 */
export function setThreatAlertCallback(fn: (msg: string) => Promise<void>): void {
    bossAlertCallback = fn;
}

/**
 * Record a threat event for a given userId or IP string.
 * Uses adaptive scoring: burst detection, consecutive multipliers, severity weights.
 * Returns the resulting threat level.
 */
export function recordThreat(
    key: number | string,
    event: string,
    detail?: string
): ThreatLevel {
    const id = String(key);
    const rec = getOrCreate(id);
    applyDecay(rec);

    const now = Date.now();

    // ── Adaptive scoring ─────────────────────────────────
    let baseScore = EVENT_SCORES[event] ?? 5;

    // 1. Severity weight (event-type aware)
    const severityWeight = SEVERITY_WEIGHTS[event] ?? 1.0;
    baseScore *= severityWeight;

    // 2. Burst multiplier — penalize rapid-fire events in short window
    rec.recentEvents = rec.recentEvents.filter(ts => now - ts < BURST_WINDOW_MS);
    rec.recentEvents.push(now);
    if (rec.recentEvents.length >= 3) {
        baseScore *= BURST_MULTIPLIER;
    }

    // 3. Consecutive same-event multiplier
    if (rec.lastEventType === event) {
        rec.consecutiveCount++;
        if (rec.consecutiveCount >= 3) {
            baseScore *= 1.0 + (rec.consecutiveCount * 0.2); // +20% per consecutive repeat
        }
    } else {
        rec.consecutiveCount = 1;
        rec.lastEventType = event;
    }

    rec.score += baseScore;
    rec.lastEvent = now;

    const violation = `${new Date().toISOString()} | ${event}${detail ? `: ${detail.slice(0, 80)}` : ""} [+${Math.round(baseScore)}]`;
    rec.violations.push(violation);
    if (rec.violations.length > MAX_VIOLATION_LOG) {
        rec.violations = rec.violations.slice(-MAX_VIOLATION_LOG);
    }

    const level = computeLevel(rec.score);
    logger.warn(`🛡️ Threat [${level}] id=${id} score=${Math.round(rec.score)} event=${event} consecutive=${rec.consecutiveCount}`);

    // ── Confidence-gated auto-ban ────────────────────────
    // Don't ban instantly — require score to stay above threshold for BAN_CONFIDENCE_WINDOW
    if (rec.score >= BAN_THRESHOLD && !rec.banned) {
        if (!rec.banCandidateSince) {
            rec.banCandidateSince = now;
            logger.warn(`⚠️ Ban candidate: ${id} — will ban in ${BAN_CONFIDENCE_WINDOW / 1000}s if score stays high`);
            fireAlertIfCooled(id, rec, "CRITICAL");
        } else if (now - rec.banCandidateSince >= BAN_CONFIDENCE_WINDOW) {
            // Confidence confirmed — ban
            rec.banned = true;
            rec.bannedAt = now;
            rec.banCandidateSince = undefined;
            logger.warn(`🚫 Entity BANNED (confidence confirmed): ${id} score=${Math.round(rec.score)}`);
            fireBossAlert(id, rec, "BANNED", `☠️ Attacker permanently banned after sustained threat score.`);
        }
    } else if (rec.score < BAN_THRESHOLD) {
        // Score dropped below threshold — reset confidence window
        rec.banCandidateSince = undefined;
    }

    if (!rec.banned && (level === "HIGH" || level === "CRITICAL")) {
        fireAlertIfCooled(id, rec, level);
    }

    return level;
}

/** Check if an entity is currently banned. */
export function isBanned(key: number | string): boolean {
    const rec = threatMap.get(String(key));
    return rec?.banned === true;
}

/** Get current threat level without recording an event. */
export function getThreatLevel(key: number | string): ThreatLevel {
    const rec = threatMap.get(String(key));
    if (!rec) return "NORMAL";
    applyDecay(rec);
    return computeLevel(rec.score);
}

/** Manually pardon / unban an entity (Boss command). */
export function pardon(key: number | string): void {
    const rec = threatMap.get(String(key));
    if (rec) {
        rec.banned = false;
        rec.score = 0;
        rec.violations = [];
        logger.info(`✅ Entity pardoned: ${key}`);
    }
}

/** Return a JSON threat report for all active entities. */
export function getThreatReport(): string {
    const entries = [...threatMap.entries()]
        .filter(([, r]) => r.score > 0 || r.banned)
        .map(([id, r]) => ({
            id,
            score: Math.round(r.score),
            level: computeLevel(r.score),
            banned: r.banned,
            recentViolations: r.violations.slice(-5),
        }));
    return JSON.stringify(entries.length ? entries : { status: "All clear — no active threats." }, null, 2);
}

// ─── Internals ───────────────────────────────────────────

function getOrCreate(id: string): ThreatRecord {
    let rec = threatMap.get(id);
    if (!rec) {
        rec = {
            score: 0,
            lastEvent: Date.now(),
            violations: [],
            banned: false,
            recentEvents: [],
            consecutiveCount: 0,
            lastEventType: "",
        };
        threatMap.set(id, rec);
    }
    return rec;
}

function applyDecay(rec: ThreatRecord): void {
    const hoursElapsed = (Date.now() - rec.lastEvent) / 3_600_000;
    if (hoursElapsed > 0) {
        rec.score = Math.max(0, rec.score - DECAY_PER_HOUR * hoursElapsed);
    }
}

function computeLevel(score: number): ThreatLevel {
    if (score >= THRESHOLDS.CRITICAL) return "CRITICAL";
    if (score >= THRESHOLDS.HIGH)     return "HIGH";
    if (score >= THRESHOLDS.ELEVATED) return "ELEVATED";
    return "NORMAL";
}

function fireAlertIfCooled(id: string, rec: ThreatRecord, level: ThreatLevel): void {
    const now = Date.now();
    if (rec.alertedAt && now - rec.alertedAt < ALERT_COOLDOWN_MS) return;
    rec.alertedAt = now;
    fireBossAlert(id, rec, level, "");
}

function fireBossAlert(id: string, rec: ThreatRecord, level: string, extra: string): void {
    if (!bossAlertCallback) return;
    const msg =
        `🚨 *JOVI SHIELD ALERT — ${level}*\n` +
        `Attacker: \`${id}\`\n` +
        `Threat Score: ${Math.round(rec.score)}\n` +
        `Recent activity:\n${rec.violations.slice(-3).map(v => `• ${v}`).join("\n")}` +
        (extra ? `\n${extra}` : "");
    bossAlertCallback(msg).catch(() => {});
}

// ─── Hourly decay sweep ───────────────────────────────────
setInterval(() => {
    for (const [id, rec] of threatMap) {
        applyDecay(rec);
        if (rec.score <= 0 && !rec.banned) threatMap.delete(id);
    }
}, 60 * 60_000).unref();

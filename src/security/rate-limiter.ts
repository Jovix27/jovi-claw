/**
 * Per-user in-memory rate limiter (sliding window) with progressive penalties and ban escalation.
 *
 * Default: 20 messages / 60 seconds per user.
 * After repeated rate-limit violations the penalty window grows (exponential backoff).
 * After MAX_STRIKES violations the user is soft-banned from messaging.
 */

interface Window {
    timestamps: number[];
    strikes: number;          // how many times this user has been rate-limited
    penaltyUntil?: number;    // epoch ms until which user is penalized
}

const windows = new Map<number, Window>();
const softBans = new Set<number>(); // users temporarily banned due to repeated violations

// ─── Configuration ──────────────────────────────────────
const WINDOW_MS      = 60_000;   // 1-minute sliding window
const MAX_REQUESTS   = 20;       // messages allowed per window
const MAX_STRIKES    = 5;        // strikes before soft-ban
const BASE_PENALTY_S = 30;       // seconds for first penalty (doubles each strike)
const SOFT_BAN_DURATION_MS = 30 * 60_000; // 30-minute soft ban

// ─── Soft ban tracking ──────────────────────────────────
const softBanExpiry = new Map<number, number>();

/**
 * Returns true if the user is within their rate limit.
 * Records the attempt regardless.
 */
export function checkRateLimit(userId: number): boolean {
    const now = Date.now();

    // Check active soft ban
    const banExpiry = softBanExpiry.get(userId);
    if (banExpiry) {
        if (now < banExpiry) return false;
        // Ban expired — clear it
        softBanExpiry.delete(userId);
        softBans.delete(userId);
    }

    const win = windows.get(userId) ?? { timestamps: [], strikes: 0 };

    // Check active penalty window
    if (win.penaltyUntil && now < win.penaltyUntil) {
        return false;
    }

    // Drop timestamps outside sliding window
    win.timestamps = win.timestamps.filter(ts => now - ts < WINDOW_MS);

    if (win.timestamps.length >= MAX_REQUESTS) {
        win.strikes++;

        if (win.strikes >= MAX_STRIKES) {
            // Escalate to soft ban
            softBans.add(userId);
            softBanExpiry.set(userId, now + SOFT_BAN_DURATION_MS);
            win.strikes = 0; // reset so if they get pardoned they start fresh
        } else {
            // Exponential backoff penalty
            const penaltyMs = BASE_PENALTY_S * Math.pow(2, win.strikes - 1) * 1000;
            win.penaltyUntil = now + penaltyMs;
        }

        windows.set(userId, win);
        return false;
    }

    win.timestamps.push(now);
    windows.set(userId, win);
    return true;
}

/**
 * Returns seconds until the user may send again.
 * Accounts for both sliding window and penalty periods.
 */
export function retryAfterSeconds(userId: number): number {
    const now = Date.now();

    const banExpiry = softBanExpiry.get(userId);
    if (banExpiry && now < banExpiry) {
        return Math.ceil((banExpiry - now) / 1000);
    }

    const win = windows.get(userId);
    if (!win) return 0;

    if (win.penaltyUntil && now < win.penaltyUntil) {
        return Math.ceil((win.penaltyUntil - now) / 1000);
    }

    if (win.timestamps.length === 0) return 0;
    const oldest = win.timestamps[0];
    const remaining = WINDOW_MS - (now - oldest);
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * Check if a user is currently soft-banned.
 */
export function isSoftBanned(userId: number): boolean {
    const expiry = softBanExpiry.get(userId);
    if (!expiry) return false;
    if (Date.now() >= expiry) {
        softBanExpiry.delete(userId);
        softBans.delete(userId);
        return false;
    }
    return true;
}

/**
 * Clear all rate-limit state for a user (e.g. Boss manually pardoning).
 */
export function clearRateLimit(userId: number): void {
    windows.delete(userId);
    softBans.delete(userId);
    softBanExpiry.delete(userId);
}

// ─── Cleanup stale entries every 5 minutes ──────────────
setInterval(() => {
    const now = Date.now();
    for (const [userId, win] of windows) {
        const active = win.timestamps.filter(ts => now - ts < WINDOW_MS);
        if (active.length === 0 && !win.penaltyUntil) {
            windows.delete(userId);
        } else {
            win.timestamps = active;
        }
    }
    // Clean expired soft bans
    for (const [userId, expiry] of softBanExpiry) {
        if (now >= expiry) {
            softBanExpiry.delete(userId);
            softBans.delete(userId);
        }
    }
}, 5 * 60_000).unref();

/**
 * Per-user in-memory rate limiter (sliding window).
 *
 * Defaults: 20 messages / 60 seconds per user.
 * A single user bursting 20 messages trips the limit and must wait
 * until the oldest message falls outside the window.
 */

interface Window {
    timestamps: number[];
}

const windows = new Map<number, Window>();

// ─── Configuration ──────────────────────────────────────
const WINDOW_MS = 60_000;   // 1-minute sliding window
const MAX_REQUESTS = 20;    // messages allowed per window

/**
 * Returns true if the user is within their rate limit.
 * Records the attempt regardless.
 */
export function checkRateLimit(userId: number): boolean {
    const now = Date.now();
    const win = windows.get(userId) ?? { timestamps: [] };

    // Drop timestamps outside the window
    win.timestamps = win.timestamps.filter(ts => now - ts < WINDOW_MS);

    if (win.timestamps.length >= MAX_REQUESTS) {
        windows.set(userId, win);
        return false; // rate-limited
    }

    win.timestamps.push(now);
    windows.set(userId, win);
    return true;
}

/**
 * Returns seconds until the user's oldest request falls out of the window.
 * Returns 0 if they are not rate-limited.
 */
export function retryAfterSeconds(userId: number): number {
    const win = windows.get(userId);
    if (!win || win.timestamps.length === 0) return 0;

    const oldest = win.timestamps[0];
    const remaining = WINDOW_MS - (Date.now() - oldest);
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// ─── Cleanup stale entries every 5 minutes ──────────────
setInterval(() => {
    const now = Date.now();
    for (const [userId, win] of windows) {
        const active = win.timestamps.filter(ts => now - ts < WINDOW_MS);
        if (active.length === 0) {
            windows.delete(userId);
        } else {
            win.timestamps = active;
        }
    }
}, 5 * 60_000).unref();

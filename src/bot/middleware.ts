import type { Context, NextFunction } from "grammy";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Auth guard middleware for grammY.
 * Checks ctx.from.id against the ALLOWED_USER_IDS whitelist.
 * Non-matching users are silently dropped (no response, just a warn log).
 */
export async function authGuard(ctx: Context, next: NextFunction): Promise<void> {
    const userId = ctx.from?.id;

    if (!userId) {
        logger.warn("Received message with no user ID — dropping.");
        return;
    }

    if (!config.security.allowedUserIds.includes(userId)) {
        logger.warn("Blocked unauthorized user.", { userId });
        return; // silent drop — attacker gets no signal
    }

    await next();
}

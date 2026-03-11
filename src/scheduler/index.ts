import schedule from "node-schedule";
import type { Bot } from "grammy";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { runHeartbeat } from "./heartbeat.js";

let heartbeatJob: schedule.Job | null = null;
export let botInstance: Bot | null = null;

/**
 * Initialize the scheduler with the heartbeat job.
 * Called during startup after bot.start().
 */
export function initScheduler(bot: Bot): void {
    botInstance = bot;

    if (!config.heartbeat.enabled) {
        logger.info("Heartbeat disabled via config.");
        return;
    }

    const { hour, minute, timezone } = config.heartbeat;

    // Build the recurrence rule for daily execution
    const rule = new schedule.RecurrenceRule();
    rule.hour = hour;
    rule.minute = minute;
    rule.second = 0;

    if (timezone) {
        rule.tz = timezone;
    }

    heartbeatJob = schedule.scheduleJob(rule, async () => {
        logger.info("Heartbeat job triggered by scheduler.");
        try {
            await runHeartbeat(bot);
        } catch (error) {
            logger.error("Heartbeat job failed.", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const tzStr = timezone ? ` (${timezone})` : " (local time)";
    logger.info(`Heartbeat scheduled daily at ${timeStr}${tzStr}`);

    initDailyTrackingJobs();
}

/**
 * Stop the heartbeat scheduler.
 * Called during graceful shutdown.
 */
export function stopScheduler(): void {
    if (heartbeatJob) {
        heartbeatJob.cancel();
        heartbeatJob = null;
        logger.info("Heartbeat scheduler stopped.");
    }
    // Cancel the daily tracking jobs too
    dailyTrackingJobs.forEach(job => job.cancel());
    dailyTrackingJobs.length = 0;
}

const dailyTrackingJobs: schedule.Job[] = [];

function initDailyTrackingJobs(): void {
    const bossId = config.security.allowedUserIds[0];
    if (!bossId) return;

    const IST_TIMEZONE = "Asia/Kolkata";

    // We use dynamic import for the runAgentLoop to avoid circular dependencies
    const executeScheduledAgentPrompt = async (prompt: string) => {
        try {
            const { runAgentLoop } = await import("../agent/loop.js");
            const result = await runAgentLoop(prompt, bossId);

            if (botInstance) {
                await botInstance.api.sendMessage(bossId, result.text);
            }
        } catch (error) {
            logger.error("Error executing scheduled agent prompt", { error });
        }
    };

    // Helper to create a timezone-aware recurrence rule
    const createISTRule = (hour: number, minute: number) => {
        const rule = new schedule.RecurrenceRule();
        rule.hour = hour;
        rule.minute = minute;
        rule.second = 0;
        rule.tz = IST_TIMEZONE;
        return rule;
    };

    // ─── 8 AM IST: Good Morning & To-Do List ───────────────────
    const job8am = schedule.scheduleJob(createISTRule(8, 0), () => {
        logger.info("Triggering 8 AM IST Morning Check-in");
        executeScheduledAgentPrompt("[SYSTEM AUTO-TRIGGER: Time is 8:00 AM IST. Send me a good morning message, and fetch/create the To-Do list for today. Make sure to track tasks in Google Sheets if possible via Zapier tools.]");
    });
    dailyTrackingJobs.push(job8am);

    // ─── Progress Checks (11am, 1pm, 3pm, 5pm IST) ─────────────
    const times = [11, 13, 15, 17];
    for (const hour of times) {
        const job = schedule.scheduleJob(createISTRule(hour, 0), () => {
            const displayTime = hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
            logger.info(`Triggering ${displayTime} IST Progress Check`);
            executeScheduledAgentPrompt(`[SYSTEM AUTO-TRIGGER: Time is ${displayTime} IST. Ask me for a progress update on my tasks (completed, pending, or ongoing). Note that you should manage this in Google Sheets if I reply back with statuses.]`);
        });
        dailyTrackingJobs.push(job);
    }
}

/**
 * Get the next scheduled heartbeat time (for debugging/status).
 */
export function getNextHeartbeat(): Date | null {
    return heartbeatJob?.nextInvocation() ?? null;
}

/**
 * Register the /heartbeat command on the bot.
 * Allows manual triggering of the heartbeat for testing.
 */
export function registerHeartbeatCommand(bot: Bot): void {
    bot.command("heartbeat", async (ctx) => {
        const userId = ctx.from?.id;
        logger.info("Manual heartbeat triggered via /heartbeat command.", { userId });

        await ctx.reply("🫀 Triggering heartbeat...");

        try {
            await runHeartbeat(bot);
            await ctx.reply("✅ Heartbeat sent successfully!");
        } catch (error) {
            logger.error("Manual heartbeat failed.", {
                error: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply("❌ Heartbeat failed. Check logs for details.");
        }
    });

    logger.debug("Registered /heartbeat command.");
}

/**
 * Manually trigger a heartbeat (used for catch-up on startup).
 */
export async function triggerHeartbeat(): Promise<void> {
    if (!botInstance) {
        logger.error("Cannot trigger heartbeat: bot not initialized.");
        return;
    }
    await runHeartbeat(botInstance);
}

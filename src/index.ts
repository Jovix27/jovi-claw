import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { createBot } from "./bot/bot.js";

// Force tool registry to initialize (side-effect import)
import "./tools/index.js";

import { initMemoryDB, closeMemoryDB } from "./utils/memory.js";
import { initSemanticMemory } from "./utils/semantic.js";
import { initMcpClients, closeMcpClients } from "./utils/mcp-client.js";
import { initHeartbeatState, shouldCatchUp } from "./utils/heartbeat-state.js";
import { initScheduler, stopScheduler, registerHeartbeatCommand, triggerHeartbeat } from "./scheduler/index.js";
import { startRelayServer, stopRelayServer, setAgentConnectedCallback } from "./utils/remote-relay.js";
import { setAgentMode } from "./tools/index.js";
import { setThreatAlertCallback } from "./security/threat-detector.js";
import { setCreditAlertCallback } from "./llm/claude.js";
import { startOrchestratorCron } from "./agent/orchestrator-cron.js";

// ─── Banner ─────────────────────────────────────────────
function printBanner(): void {
    console.log(`
    ╦╔═╗╦  ╦╦  ╔═╗╦
    ║║ ║╚╗╔╝║  ╠═╣║
  ╚╝╚═╝ ╚╝ ╩  ╩ ╩╩
  ─────────────────────
  Personal AI Agent
  Level 1 — Foundation
  `);
}

// ─── Main ───────────────────────────────────────────────
async function main(): Promise<void> {
    printBanner();

    // ─── Cloud-Only Lock ────────────────────────────────────
    // Prevents local instances from stealing messages from the Railway bot
    if (process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_BOT !== "true") {
        logger.warn("🛑 Bot execution is locked to cloud (production) only to prevent duplicate polling conflicts.");
        logger.warn("If you need to test locally, set ALLOW_LOCAL_BOT=true in your environment.");
        process.exit(0);
    }

    const activeModel = config.gemini.apiKey
        ? `${config.gemini.model} (Gemini)`
        : config.mistral.apiKey
            ? `${config.mistral.model} (Mistral)`
            : `${config.openrouter.model} (OpenRouter)`;

    logger.info("Starting Jovi AI...", {
        model: activeModel,
        allowedUsers: config.security.allowedUserIds.length,
        logLevel: config.logLevel,
    });

    const bot = createBot();

    // ─── Wire Credit Alert → Telegram ────────────────────
    const bossId = config.security.allowedUserIds[0];

    // ─── Wire Threat Alerts → Telegram ───────────────────
    if (bossId) {
        setThreatAlertCallback(async (msg: string) => {
            await bot.api.sendMessage(bossId, msg, { parse_mode: "Markdown" }).catch(() => {});
        });
    }

    if (bossId) {
        setCreditAlertCallback(async (message: string) => {
            try {
                await bot.api.sendMessage(bossId, message, { parse_mode: "Markdown" });
                logger.info("Credit alert sent to Boss via Telegram.");
            } catch (e) {
                logger.error("Failed to send credit alert via Telegram.", {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        });
    }

    // ─── Init Memory ──────────────────────────────────────
    await initMemoryDB();
    await initSemanticMemory();

    // ─── Init MCP Servers ─────────────────────────────────
    await initMcpClients();

    // ─── Start Orchestrator Cron ──────────────────────────
    if (bossId) {
        startOrchestratorCron(bossId);
    }

    // ─── Init Heartbeat State ────────────────────────────
    await initHeartbeatState();

    // ─── Register Heartbeat Command ──────────────────────
    registerHeartbeatCommand(bot);

    // ─── Start Remote Control Relay ──────────────────────
    if (config.remoteControl.secret) {
        // Auto-enable agent mode and notify Boss the moment the PC connects
        setAgentConnectedCallback(async () => {
            if (bossId) {
                await setAgentMode(bossId, true);
                await bot.api.sendMessage(
                    bossId,
                    "🟢 *Agent Mode Auto-Activated!*\nYour PC just connected, Boss. I now have full remote control — ready for commands.",
                    { parse_mode: "Markdown" }
                ).catch(() => {}); // non-fatal
            }
        });
        startRelayServer(config.remoteControl.secret, config.remoteControl.port);
        logger.info("Remote control relay server started.", { port: config.remoteControl.port });
    } else {
        logger.info("Remote control disabled (no REMOTE_CONTROL_SECRET set).");
    }

    // ─── Graceful shutdown ────────────────────────────────
    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal} — shutting down gracefully...`);
        stopScheduler();
        await bot.stop();
        await stopRelayServer();
        await closeMcpClients();
        closeMemoryDB();
        logger.info("Bot stopped. Goodbye! 👋");
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // ─── Start with long-polling (NO web server) ──────────
    logger.info("🚀 Bot is live! Listening via long-polling (no open ports).");
    logger.info(`   Whitelisted users: ${config.security.allowedUserIds.join(", ")}`);

    try {
        await bot.start({
            onStart: async () => {
                logger.info("grammY polling started successfully.");

                // ─── Init Heartbeat Scheduler ────────────────────
                initScheduler(bot);

                // ─── Check for missed heartbeat (catch-up) ──────
                if (config.heartbeat.enabled && config.heartbeat.catchUpOnMissed) {
                    const bossId = config.security.allowedUserIds[0];
                    if (bossId) {
                        const needsCatchUp = await shouldCatchUp(bossId);
                        if (needsCatchUp) {
                            const now = new Date();
                            const heartbeatHour = config.heartbeat.hour;
                            const heartbeatMinute = config.heartbeat.minute;

                            // Only catch up if current time is after scheduled time
                            const isPastScheduledTime =
                                now.getHours() > heartbeatHour ||
                                (now.getHours() === heartbeatHour && now.getMinutes() >= heartbeatMinute);

                            if (isPastScheduledTime) {
                                logger.info("Missed heartbeat detected, sending catch-up...");
                                await triggerHeartbeat();
                            }
                        }
                    }
                }
            },
        });
    } catch (e: any) {
        logger.error("⚠️ Telegram polling failed! Another instance (Railway) is likely running.", { 
            message: e.message 
        });
        logger.info("Local Express server remains online for Dashboard testing.");
    }
}

main().catch((error) => {
    logger.error("Fatal error during startup.", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
});

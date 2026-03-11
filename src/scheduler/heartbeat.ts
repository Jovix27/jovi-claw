import type { Bot } from "grammy";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getCoreMemory, getRecentBuffer } from "../utils/memory.js";
import { searchSemanticMemory } from "../utils/semantic.js";
import { executeWebSearch } from "../tools/web-search.js";
import { chat } from "../llm/claude.js";
import { audit } from "../security/audit-logger.js";
import { setLastHeartbeat, getHeartbeatPreferences } from "../utils/heartbeat-state.js";

/**
 * Execute the daily heartbeat: gather context, compose message, send to Boss.
 */
export async function runHeartbeat(bot: Bot): Promise<void> {
    const bossUserId = config.security.allowedUserIds[0];

    if (!bossUserId) {
        logger.warn("No Boss user configured for heartbeat (ALLOWED_USER_IDS is empty).");
        return;
    }

    try {
        audit.heartbeatStarted(bossUserId);
        logger.info("Running heartbeat for Boss.", { userId: bossUserId });

        // ─── 1. Gather context from memory ───────────────────────
        const coreFacts = await getCoreMemory(bossUserId);
        const recentMessages = await getRecentBuffer(bossUserId, 10);
        const semanticContext = await searchSemanticMemory(
            bossUserId,
            "recent goals priorities projects tasks progress",
            5
        );
        const preferences = await getHeartbeatPreferences(bossUserId);

        // ─── 2. Run trend research ───────────────────────────────
        const trendQuery = buildTrendQuery(coreFacts);
        let trendResults: string;
        try {
            trendResults = await executeWebSearch({ query: trendQuery });
        } catch (e) {
            logger.error("Trend research failed, continuing without trends.", { error: e });
            trendResults = JSON.stringify({ success: false, message: "Trend research unavailable." });
        }

        // ─── 3. Build LLM prompt ─────────────────────────────────
        const heartbeatPrompt = buildHeartbeatPrompt({
            coreFacts,
            recentMessages,
            semanticContext,
            trendResults,
            preferences,
        });

        // ─── 4. Generate message via LLM ─────────────────────────
        const response = await chat(
            [{ role: "user", content: heartbeatPrompt }],
            undefined,
            bossUserId
        );

        const messageText = response.choices[0]?.message?.content;
        if (!messageText) {
            logger.error("Heartbeat LLM returned empty response.");
            audit.heartbeatFailed(bossUserId, "LLM returned empty response");
            return;
        }

        // ─── 5. Send to Boss via Telegram ────────────────────────
        await bot.api.sendMessage(bossUserId, messageText, {
            parse_mode: "Markdown",
        });

        // ─── 6. Update state ─────────────────────────────────────
        await setLastHeartbeat(bossUserId, Date.now());
        audit.heartbeatCompleted(bossUserId);

        logger.info("Heartbeat sent successfully.", { userId: bossUserId });
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Heartbeat failed.", { error: errorMsg });
        audit.heartbeatFailed(bossUserId, errorMsg);
    }
}

/**
 * Build a trend search query based on user's interests/industry from core memory.
 */
function buildTrendQuery(coreFacts: Array<{ fact_key: string; fact_value: string }>): string {
    // Extract relevant facts for trend research
    const relevantKeys = ["industry", "interests", "company", "role", "business", "focus"];
    const interests = coreFacts
        .filter((f) => relevantKeys.some((k) => f.fact_key.toLowerCase().includes(k)))
        .map((f) => f.fact_value)
        .join(" ");

    const today = new Date().toISOString().split("T")[0];

    if (interests.trim()) {
        return `${interests} latest news trends ${today}`;
    }

    // Default fallback for general AI/tech trends
    return `AI technology business news trends ${today}`;
}

/**
 * Build the LLM prompt for composing the heartbeat message.
 */
function buildHeartbeatPrompt(context: {
    coreFacts: Array<{ fact_key: string; fact_value: string }>;
    recentMessages: Array<{ role: string; content: string }>;
    semanticContext: string[];
    trendResults: string;
    preferences?: Record<string, string>;
}): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    const timeStr = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
    });

    const factsText =
        context.coreFacts.length > 0
            ? context.coreFacts.map((f) => `- ${f.fact_key}: ${f.fact_value}`).join("\n")
            : "No specific facts stored yet.";

    const recentText =
        context.recentMessages.length > 0
            ? context.recentMessages
                  .slice(-5)
                  .map((m) => `${m.role}: ${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}`)
                  .join("\n")
            : "No recent messages.";

    const semanticText =
        context.semanticContext.length > 0
            ? context.semanticContext.join("\n---\n")
            : "No relevant past context found.";

    const prefsText = context.preferences
        ? Object.entries(context.preferences)
              .map(([k, v]) => `- ${k}: ${v}`)
              .join("\n")
        : "Default style (friendly, professional, proactive)";

    return `You are Jovi, sending your daily morning heartbeat message to Boss.

CURRENT DATE: ${dateStr}
CURRENT TIME: ${timeStr}

─────────────────────────────────────────────────────────────
BOSS'S CORE MEMORY (Important facts about them):
${factsText}

─────────────────────────────────────────────────────────────
RECENT CONVERSATION CONTEXT (Last few exchanges):
${recentText}

─────────────────────────────────────────────────────────────
RELEVANT PAST CONTEXT (From semantic memory):
${semanticText}

─────────────────────────────────────────────────────────────
TODAY'S RELEVANT NEWS & TRENDS:
${context.trendResults}

─────────────────────────────────────────────────────────────
HEARTBEAT STYLE PREFERENCES:
${prefsText}

─────────────────────────────────────────────────────────────

INSTRUCTIONS:
1. Greet Boss warmly with a personalized "Good morning" that feels natural (use their name if known)
2. Optionally ask a personal check-in question (e.g., "How are you feeling today?" or "Did you track your weight?")
3. Provide a brief "Daily Briefing" with 2-3 relevant news items or trends from the research
4. Reference any ongoing projects, tasks, or goals from memory if applicable
5. Keep the tone friendly, professional, and proactive — like a personal AI strategist
6. End with an offer to help with today's priorities
7. Keep the total message under 500 words
8. Use Markdown formatting for structure (bold for headers, bullet points for lists)
9. Do NOT sound robotic — be warm and human

Generate the heartbeat message now:`;
}

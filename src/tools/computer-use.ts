/**
 * Computer Use Tool — Jovi's Manus/Claude-style autonomous PC control.
 *
 * computer_use_task orchestrates:
 *   1. PLAN   — one-shot LLM call decomposes the task into ordered steps
 *   2. EXECUTE — step-by-step execution via remote relay
 *   3. VERIFY — after each action, vision checks success
 *   4. RETRY  — on failure: scroll → swap selector↔coords → re-analyze → skip
 *
 * All browser actions use Playwright selectors first (fast, reliable).
 * Vision coordinates are the fallback when selectors fail.
 */

import fs from "node:fs";
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { sendRemoteRequest, saveImageFromResult, isRemoteAgentConnected } from "../utils/remote-relay.js";
import { planTask, type PlannedStep } from "../agent/planner.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

// ─── Vision client (same as analyze-image.ts) ────────────
const visionClient = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
});
const VISION_MODEL = "anthropic/claude-3.5-sonnet";

const MAX_STEPS_HARD_CAP = 30;
const ACTION_WAIT_MS     = 900;   // wait after action before screenshotting
const NAVIGATE_WAIT_MS   = 1_500; // extra wait after navigation

// ─── Tool Definition ─────────────────────────────────────

export const computerUseDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "computer_use_task",
        description:
            "Autonomously control Boss's PC to complete a multi-step task. " +
            "Jovi will plan the task, execute it step-by-step (with vision verification after each step), " +
            "and recover from failures automatically. " +
            "Examples: 'open YouTube and search for X', 'fill out this form on website Y', " +
            "'open Excel and create a table', 'navigate to site Z and extract data'. " +
            "Requires Agent Mode ON and remote-agent running on the PC.",
        parameters: {
            type: "object",
            properties: {
                task: {
                    type: "string",
                    description: "Plain-English description of what to do on the PC. Be specific about the goal.",
                },
                max_steps: {
                    type: "number",
                    description: `Max steps before stopping. Default 15, cap ${MAX_STEPS_HARD_CAP}.`,
                },
            },
            required: ["task"],
        },
    },
};

// ─── Vision helpers ──────────────────────────────────────

interface VisionAction {
    action: string;
    reason: string;
    confidence: number;
    params: Record<string, unknown>;
    screen_summary?: string;
}

interface VerifyResult {
    success: boolean;
    reason: string;
    retry_suggestion?: string;
}

async function takeScreenshot(): Promise<string | null> {
    try {
        const res = await sendRemoteRequest("screenshot", {});
        if (res.error || !res.imageData) return null;
        return await saveImageFromResult(res, "cu_shot");
    } catch { return null; }
}

async function imageToBase64(filePath: string): Promise<string | null> {
    try {
        return fs.readFileSync(filePath).toString("base64");
    } catch { return null; }
}

async function askVision(systemPrompt: string, userText: string, imagePath: string): Promise<string> {
    const b64 = await imageToBase64(imagePath);
    if (!b64) return "{}";

    const res = await visionClient.chat.completions.create({
        model: VISION_MODEL,
        max_tokens: 512,
        temperature: 0.1,
        messages: [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: [
                    { type: "text", text: userText },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${b64}`, detail: "high" } },
                ],
            },
        ],
    });
    return res.choices[0]?.message?.content?.trim() ?? "{}";
}

function parseJSON<T>(raw: string, fallback: T): T {
    try {
        const clean = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        return JSON.parse(clean) as T;
    } catch { return fallback; }
}

// ─── Vision-based next-action decision ───────────────────

const DECISION_SYSTEM = `You are Jovi, an AI controlling a Windows 11 PC.
Analyze the screenshot and decide the SINGLE next action.
Respond ONLY in valid JSON — no markdown, no explanation:
{
  "screen_summary": "one-line description of current state",
  "action": "browser_navigate|browser_click|browser_type|browser_scroll|browser_back|browser_eval|keyboard|mouse|scroll|open|screenshot|done",
  "reason": "why this action",
  "confidence": 0.0-1.0,
  "params": {}
}
Params per action:
  browser_navigate: { "url": string }
  browser_click: { "selector"?: string, "x"?: number, "y"?: number }
  browser_type: { "text": string, "selector"?: string }
  browser_scroll: { "direction": "up"|"down", "delta"?: number }
  keyboard: { "keys"?: string, "text"?: string }
  mouse: { "x": number, "y": number, "button"?: "left"|"right"|"double" }
  scroll: { "x": number, "y": number, "direction": "up"|"down", "amount"?: number }
  open: { "target": string }
  browser_eval: { "script": string }
  screenshot: {}
  done: { "outcome": string }
If confidence < 0.5, use "screenshot" to take another look.`;

async function decideNextAction(task: string, step: number, maxSteps: number, log: string[], imagePath: string): Promise<VisionAction> {
    const userText = `TASK: ${task}\nSTEP: ${step}/${maxSteps}\nPREVIOUS:\n${log.slice(-5).join("\n") || "None"}\n\nWhat is the next action?`;
    const raw = await askVision(DECISION_SYSTEM, userText, imagePath);
    return parseJSON<VisionAction>(raw, { action: "screenshot", reason: "parse error", confidence: 0, params: {} });
}

// ─── Post-action verifier ─────────────────────────────────

const VERIFY_SYSTEM = `You are verifying whether an action on a Windows 11 PC succeeded.
Respond ONLY in valid JSON:
{ "success": true|false, "reason": "...", "retry_suggestion": "what to try instead (optional)" }`;

async function verifyAction(actionDesc: string, imagePath: string): Promise<VerifyResult> {
    const raw = await askVision(
        VERIFY_SYSTEM,
        `Action taken: "${actionDesc}"\nDid the UI change as expected? Is the task progressing?`,
        imagePath,
    );
    return parseJSON<VerifyResult>(raw, { success: true, reason: "verify parse error" });
}

// ─── Action executor ─────────────────────────────────────

async function executeAction(action: VisionAction): Promise<string> {
    const p = action.params;
    switch (action.action) {
        case "browser_navigate":
            return (await sendRemoteRequest("browser_navigate", p)).stdout || "navigated";
        case "browser_click":
            return (await sendRemoteRequest("browser_click", p)).stdout || "clicked";
        case "browser_type":
            return (await sendRemoteRequest("browser_type", p)).stdout || "typed";
        case "browser_scroll":
            return (await sendRemoteRequest("browser_scroll", p)).stdout || "scrolled";
        case "browser_back":
            return (await sendRemoteRequest("browser_back", {})).stdout || "back";
        case "browser_eval":
            return (await sendRemoteRequest("browser_eval", p)).stdout || "eval done";
        case "keyboard":
            return (await sendRemoteRequest("keyboard", p)).stdout || "keys sent";
        case "mouse":
            return (await sendRemoteRequest("mouse", p)).stdout || "clicked";
        case "scroll":
            return (await sendRemoteRequest("scroll", p)).stdout || "scrolled";
        case "open":
            return (await sendRemoteRequest("open", p)).stdout || "opened";
        case "screenshot":
            return "screenshot";
        case "done":
            return "done";
        default:
            return "unknown action";
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Main executor ───────────────────────────────────────

export async function executeComputerUseTask(args: { task: string; max_steps?: number }): Promise<string> {
    if (!isRemoteAgentConnected()) {
        return JSON.stringify({ success: false, error: "Remote agent not connected. Run `npm run remote-agent` on Boss's PC." });
    }

    const task     = args.task;
    const maxSteps = Math.min(args.max_steps ?? 15, MAX_STEPS_HARD_CAP);
    const stepLog: string[] = [];
    let step = 0;
    let outcome = "";

    logger.info(`🖥️ Computer Use starting: "${task}" (max ${maxSteps} steps)`);

    // ── Phase 1: Generate plan ───────────────────────────
    const plan = await planTask(task);
    let planIndex = 0;

    if (plan) {
        stepLog.push(`📋 Plan: ${plan.map(s => s.description).join(" → ")}`);
    }

    // ── Phase 2: Vision-action loop ──────────────────────
    while (step < maxSteps) {
        step++;

        // Take screenshot
        const shot = await takeScreenshot();
        if (!shot) {
            stepLog.push(`Step ${step}: ❌ Screenshot failed`);
            break;
        }

        // Decide next action — use plan hint if available, else pure vision
        let action: VisionAction;

        if (plan && planIndex < plan.length) {
            const planned: PlannedStep = plan[planIndex];
            // Still vision-decide but prepend plan context
            const hint = `PLAN STEP ${planIndex + 1}/${plan.length}: ${planned.description} (action: ${planned.action}, params: ${JSON.stringify(planned.params)})`;
            const userText = `TASK: ${task}\nSTEP: ${step}/${maxSteps}\n${hint}\nPREVIOUS:\n${stepLog.slice(-3).join("\n") || "None"}\n\nExecute this plan step or adapt if needed.`;
            const raw = await askVision(DECISION_SYSTEM, userText, shot);
            action = parseJSON<VisionAction>(raw, {
                action: planned.action,
                reason: planned.description,
                confidence: 0.8,
                params: planned.params,
            });
        } else {
            action = await decideNextAction(task, step, maxSteps, stepLog, shot);
        }

        logger.info(`Step ${step}: ${action.action} (confidence=${action.confidence}) — ${action.reason}`);

        // Done?
        if (action.action === "done") {
            outcome = String(action.params.outcome ?? "Task complete");
            stepLog.push(`Step ${step}: ✅ Done — ${outcome}`);
            break;
        }

        // Low confidence — screenshot and retry without executing
        if (action.confidence < 0.5) {
            stepLog.push(`Step ${step}: 🔍 Low confidence (${action.confidence}) — re-analyzing`);
            continue;
        }

        // ── Execute with retry loop ──────────────────────
        let succeeded = false;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await executeAction(action);
                succeeded = true;
            } catch (err: any) {
                stepLog.push(`Step ${step} attempt ${attempt}: ❌ ${err.message}`);
                // Retry strategy: swap selector → coords on browser_click
                if (action.action === "browser_click" && action.params.selector && attempt === 2) {
                    delete action.params.selector;
                    if (!action.params.x) { action.params.x = 640; action.params.y = 400; }
                }
                await sleep(500);
                continue;
            }
            break;
        }

        if (!succeeded) {
            stepLog.push(`Step ${step}: ⛔ Failed after 3 retries — skipping`);
            if (plan) planIndex++;
            continue;
        }

        const waitMs = action.action === "browser_navigate" ? NAVIGATE_WAIT_MS : ACTION_WAIT_MS;
        await sleep(waitMs);

        // ── Verify action succeeded ──────────────────────
        const postShot = await takeScreenshot();
        if (postShot) {
            const verify = await verifyAction(`${action.action}: ${JSON.stringify(action.params)}`, postShot);
            if (!verify.success) {
                stepLog.push(`Step ${step}: ⚠️ Verify failed — ${verify.reason}`);
                // Try retry suggestion: scroll to reveal element
                if (verify.retry_suggestion?.toLowerCase().includes("scroll")) {
                    await sendRemoteRequest("browser_scroll", { direction: "down", delta: 300 });
                    await sleep(500);
                }
                // Don't advance plan — try the step again next iteration
                continue;
            }
        }

        stepLog.push(`Step ${step}: ✅ ${action.action}(${JSON.stringify(action.params).slice(0, 60)}) — ${action.reason}`);

        // Advance plan pointer when plan step completes
        if (plan && planIndex < plan.length) planIndex++;
    }

    if (!outcome) outcome = step >= maxSteps ? "Max steps reached" : "Task loop ended";

    // Cleanup temp screenshots
    for (const line of stepLog) {
        const m = line.match(/\/tmp\/cu_shot[^\s]+\.png/);
        if (m) { try { fs.unlinkSync(m[0]); } catch { /* ignore */ } }
    }

    logger.info(`🖥️ Computer Use complete: ${outcome} (${step} steps)`);

    return JSON.stringify({
        success: true,
        task,
        steps_taken: step,
        outcome,
        log: stepLog,
    });
}

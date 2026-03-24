/**
 * Task Planner — Phase 2 upgrade for Computer Use.
 *
 * Converts a plain-English task into an ordered JSON execution plan
 * before the vision-action loop begins. This makes Jovi proactive
 * (plan → execute → verify) rather than purely reactive (look → click).
 *
 * Called once at the start of computer_use_task.
 */

import OpenAI from "openai";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

const plannerClient = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
});

const PLANNER_MODEL = "anthropic/claude-3.5-sonnet";

export interface PlannedStep {
    step: number;
    action: string;
    description: string;
    params: Record<string, unknown>;
}

/**
 * Decompose a task into an ordered list of planned steps.
 * Returns null if planning fails — caller falls back to pure vision-action loop.
 */
export async function planTask(task: string): Promise<PlannedStep[] | null> {
    if (!config.openrouter.apiKey) return null;

    const prompt = `You are a computer automation planner. Decompose the following task into ordered steps.

TASK: "${task}"

Available actions:
- browser_navigate: open a URL { url: string }
- browser_click: click element { selector?: string, x?: number, y?: number }
- browser_type: type text { text: string, selector?: string }
- browser_scroll: scroll { direction: "up"|"down", delta?: number }
- browser_back: go back {}
- browser_eval: run JS { script: string }
- keyboard: send keys { keys?: string, text?: string }
- mouse: click at coords { x: number, y: number, button?: "left"|"right"|"double" }
- scroll: scroll desktop { x: number, y: number, direction: "up"|"down", amount?: number }
- open: open app/URL { target: string }
- screenshot: take screenshot to assess {}
- done: task complete { outcome: string }

Return ONLY a valid JSON array. No markdown, no explanation. Example:
[
  { "step": 1, "action": "browser_navigate", "description": "Open YouTube", "params": { "url": "https://youtube.com" } },
  { "step": 2, "action": "browser_click", "description": "Click search box", "params": { "selector": "input#search" } },
  { "step": 3, "action": "browser_type", "description": "Type search term", "params": { "text": "sustainable buildings" } },
  { "step": 4, "action": "keyboard", "description": "Press Enter", "params": { "keys": "{ENTER}" } },
  { "step": 5, "action": "done", "description": "Search complete", "params": { "outcome": "Searched YouTube for sustainable buildings" } }
]`;

    try {
        const res = await plannerClient.chat.completions.create({
            model: PLANNER_MODEL,
            max_tokens: 1024,
            temperature: 0.1,
            messages: [{ role: "user", content: prompt }],
        });

        const raw = res.choices[0]?.message?.content?.trim() ?? "";
        // Strip markdown code fences if present
        const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        const steps: PlannedStep[] = JSON.parse(json);
        logger.info(`📋 Task plan generated: ${steps.length} steps`);
        return steps;
    } catch (err: any) {
        logger.warn("Planner failed — falling back to vision-only loop.", { err: err.message });
        return null;
    }
}

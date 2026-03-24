/**
 * Browser control tools — cloud side (relay wrappers).
 *
 * These tools send commands to the Playwright browser running on Boss's PC
 * via the remote relay. The PC-side handlers are in remote-agent.ts.
 *
 * All browser tools are gated behind Agent Mode (REMOTE_TOOL_NAMES in index.ts).
 * browser_screenshot returns { imagePath } — the vision-in-loop patch in
 * src/agent/loop.ts automatically injects the image into the LLM context.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { sendRemoteRequest, saveImageFromResult, isRemoteAgentConnected } from "../utils/remote-relay.js";

function requireAgent(): string | null {
    if (!isRemoteAgentConnected()) return "Remote agent not connected. Start `npm run remote-agent` on the PC.";
    return null;
}

// ─── browser_navigate ────────────────────────────────────

export const browserNavigateDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_browser_navigate",
        description: "Open a URL in the Playwright browser on Boss's PC. Boss can watch it happen in real time. Returns the page title and status.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "Full URL to navigate to (include https://)" },
            },
            required: ["url"],
        },
    },
};

export async function executeBrowserNavigate(args: { url: string }): Promise<string> {
    const err = requireAgent(); if (err) return err;
    const res = await sendRemoteRequest("browser_navigate", { url: args.url });
    if (res.error) throw new Error(res.error);
    return res.stdout || `Navigated to ${args.url}`;
}

// ─── browser_screenshot ──────────────────────────────────

export const browserScreenshotDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_browser_screenshot",
        description: "Take a screenshot of the current browser viewport on Boss's PC. Returns an image so you can see what the browser shows.",
        parameters: { type: "object", properties: {}, required: [] },
    },
};

export async function executeBrowserScreenshot(): Promise<string> {
    const err = requireAgent(); if (err) return err;
    const res = await sendRemoteRequest("browser_screenshot", {});
    if (res.error) throw new Error(res.error);
    const imagePath = await saveImageFromResult(res, "browser_shot");
    return JSON.stringify({ text: "Browser screenshot captured.", imagePath });
}

// ─── browser_click ───────────────────────────────────────

export const browserClickDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_browser_click",
        description: "Click on an element in the browser by CSS selector OR by pixel coordinates (x, y). Prefer selector when available — use coordinates as fallback.",
        parameters: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector of the element to click (e.g. 'input#search', 'button.submit')" },
                x:        { type: "number", description: "X pixel coordinate (used if selector not provided)" },
                y:        { type: "number", description: "Y pixel coordinate (used if selector not provided)" },
            },
        },
    },
};

export async function executeBrowserClick(args: { selector?: string; x?: number; y?: number }): Promise<string> {
    const err = requireAgent(); if (err) return err;
    const res = await sendRemoteRequest("browser_click", args);
    if (res.error) throw new Error(res.error);
    return res.stdout || "Clicked.";
}

// ─── browser_type ────────────────────────────────────────

export const browserTypeDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_browser_type",
        description: "Type text into a browser input field. Provide a CSS selector to fill a specific field, or leave it blank to type into the currently focused element.",
        parameters: {
            type: "object",
            properties: {
                text:     { type: "string", description: "Text to type" },
                selector: { type: "string", description: "CSS selector of the input field (optional — types into focused element if omitted)" },
            },
            required: ["text"],
        },
    },
};

export async function executeBrowserType(args: { text: string; selector?: string }): Promise<string> {
    const err = requireAgent(); if (err) return err;
    const res = await sendRemoteRequest("browser_type", args);
    if (res.error) throw new Error(res.error);
    return res.stdout || `Typed: "${args.text.slice(0, 60)}"`;
}

// ─── browser_scroll ──────────────────────────────────────

export const browserScrollDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_browser_scroll",
        description: "Scroll the browser page up or down by a pixel delta.",
        parameters: {
            type: "object",
            properties: {
                direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
                delta:     { type: "number", description: "Pixels to scroll (default 300)" },
            },
            required: ["direction"],
        },
    },
};

export async function executeBrowserScroll(args: { direction: "up" | "down"; delta?: number }): Promise<string> {
    const err = requireAgent(); if (err) return err;
    const res = await sendRemoteRequest("browser_scroll", { direction: args.direction, delta: args.delta ?? 300 });
    if (res.error) throw new Error(res.error);
    return res.stdout || `Scrolled browser ${args.direction}`;
}

// ─── browser_back ────────────────────────────────────────

export const browserBackDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_browser_back",
        description: "Navigate back to the previous page in the browser.",
        parameters: { type: "object", properties: {}, required: [] },
    },
};

export async function executeBrowserBack(): Promise<string> {
    const err = requireAgent(); if (err) return err;
    const res = await sendRemoteRequest("browser_back", {});
    if (res.error) throw new Error(res.error);
    return res.stdout || "Navigated back.";
}

// ─── browser_eval ────────────────────────────────────────

export const browserEvalDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_browser_eval",
        description: "Run JavaScript in the browser page and return the result. Use for extracting data, checking element state, or automating complex interactions.",
        parameters: {
            type: "object",
            properties: {
                script: { type: "string", description: "JavaScript expression to evaluate in the page context (e.g. 'document.title')" },
            },
            required: ["script"],
        },
    },
};

export async function executeBrowserEval(args: { script: string }): Promise<string> {
    const err = requireAgent(); if (err) return err;
    const res = await sendRemoteRequest("browser_eval", { script: args.script });
    if (res.error) throw new Error(res.error);
    return res.stdout || "null";
}

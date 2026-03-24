/**
 * GUI-automation tools for remote PC control.
 *
 * These tools let the LLM interact with the user's actual desktop:
 *   - Take screenshots to see the screen
 *   - Send keyboard input to the active window
 *   - Click the mouse at screen coordinates
 *   - Capture photos from the webcam
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { sendRemoteRequest, saveImageFromResult, isRemoteAgentConnected } from "../utils/remote-relay.js";
import { logger } from "../utils/logger.js";

// ─── Tool Definitions ───────────────────────────────────

export const remoteScreenshotDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_screenshot",
        description:
            "Take a screenshot of Boss's PC screen. Returns the screenshot as an image. " +
            "Use this to SEE what is on the screen before performing GUI actions like mouse clicks or keyboard input.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
    },
};

export const remoteKeyboardDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_keyboard",
        description:
            "Send keyboard input to the currently active window on Boss's PC. " +
            "Use 'text' to type literal text. Use 'keys' for special keys and combos. " +
            "Keys format follows PowerShell SendKeys syntax: " +
            "{ENTER} = Enter, {TAB} = Tab, {ESC} = Escape, {BACKSPACE} = Backspace, " +
            "^ = Ctrl, % = Alt, + = Shift. Examples: ^s = Ctrl+S, ^a = Ctrl+A, %{F4} = Alt+F4, " +
            "{ENTER} = press Enter. You can combine: ^c = Ctrl+C, +{TAB} = Shift+Tab.",
        parameters: {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "Literal text to type into the active window. Use this for typing words/sentences.",
                },
                keys: {
                    type: "string",
                    description:
                        "Special key combo in SendKeys format. Use this for shortcuts like {ENTER}, ^s, %{F4}. " +
                        "Do NOT use both 'text' and 'keys' at the same time.",
                },
            },
            required: [],
        },
    },
};

export const remoteMouseDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_mouse",
        description:
            "Move the mouse and click at specific screen coordinates on Boss's PC. " +
            "IMPORTANT: Always take a screenshot first to see where elements are on screen, " +
            "then use the coordinates to click on the right spot.",
        parameters: {
            type: "object",
            properties: {
                x: {
                    type: "number",
                    description: "X coordinate (horizontal position) on screen to click.",
                },
                y: {
                    type: "number",
                    description: "Y coordinate (vertical position) on screen to click.",
                },
                button: {
                    type: "string",
                    enum: ["left", "right", "double"],
                    description: "Mouse button to click. Defaults to 'left'.",
                },
            },
            required: ["x", "y"],
        },
    },
};

export const remoteCameraDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_camera",
        description:
            "Capture a photo from Boss's PC webcam. Requires ffmpeg to be installed on the PC. " +
            "Returns the photo as an image.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
    },
};

// ─── Executors ──────────────────────────────────────────

export async function executeRemoteScreenshot(): Promise<{ text: string; imagePath?: string }> {
    if (!isRemoteAgentConnected()) {
        return { text: "Remote agent is NOT connected. Boss needs to run 'npm run remote-agent' on the PC first." };
    }

    try {
        const result = await sendRemoteRequest("screenshot", {}, 15_000);
        if (result.exitCode !== 0) {
            return { text: `Screenshot failed: ${result.stderr || result.error || "Unknown error"}` };
        }

        const imagePath = saveImageFromResult(result, "jovi_screenshot");
        if (!imagePath) {
            return { text: "Screenshot captured but failed to save the image file." };
        }

        return { text: "Here's what's on your screen right now:", imagePath };
    } catch (err: any) {
        logger.error("Remote screenshot failed.", { error: err.message });
        return { text: `Screenshot failed: ${err.message}` };
    }
}

export async function executeRemoteKeyboard(args: { keys?: string; text?: string }): Promise<string> {
    if (!isRemoteAgentConnected()) {
        return "Remote agent is NOT connected. Boss needs to run 'npm run remote-agent' on the PC first.";
    }

    if (!args.keys && !args.text) {
        return "Error: Provide either 'text' (to type words) or 'keys' (for key combos like {ENTER}).";
    }

    try {
        const result = await sendRemoteRequest("keyboard", { keys: args.keys, text: args.text }, 10_000);
        if (result.exitCode !== 0) {
            return `Keyboard input failed: ${result.stderr || result.error || "Unknown error"}`;
        }
        return result.stdout || "Keyboard input sent successfully.";
    } catch (err: any) {
        logger.error("Remote keyboard failed.", { error: err.message });
        return `Keyboard input failed: ${err.message}`;
    }
}

export async function executeRemoteMouse(args: { x: number; y: number; button?: string }): Promise<string> {
    if (!isRemoteAgentConnected()) {
        return "Remote agent is NOT connected. Boss needs to run 'npm run remote-agent' on the PC first.";
    }

    try {
        const result = await sendRemoteRequest("mouse", {
            x: args.x,
            y: args.y,
            button: args.button ?? "left",
        }, 10_000);
        if (result.exitCode !== 0) {
            return `Mouse click failed: ${result.stderr || result.error || "Unknown error"}`;
        }
        return result.stdout || `Mouse clicked at (${args.x}, ${args.y}).`;
    } catch (err: any) {
        logger.error("Remote mouse click failed.", { error: err.message });
        return `Mouse click failed: ${err.message}`;
    }
}

export async function executeRemoteCamera(): Promise<{ text: string; imagePath?: string }> {
    if (!isRemoteAgentConnected()) {
        return { text: "Remote agent is NOT connected. Boss needs to run 'npm run remote-agent' on the PC first." };
    }

    try {
        const result = await sendRemoteRequest("camera", {}, 30_000);
        if (result.exitCode !== 0) {
            return { text: `Camera capture failed: ${result.stderr || result.error || "Unknown error"}` };
        }

        const imagePath = saveImageFromResult(result, "jovi_camera");
        if (!imagePath) {
            return { text: "Photo captured but failed to save the image file." };
        }

        return { text: "Here's the photo from your webcam:", imagePath };
    } catch (err: any) {
        logger.error("Remote camera capture failed.", { error: err.message });
        return { text: `Camera capture failed: ${err.message}` };
    }
}

// ─── Scroll Tool ─────────────────────────────────────────

export const remoteScrollDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_scroll",
        description: "Scroll the mouse wheel at a screen position on Boss's PC. Use to reveal off-screen content, scroll through lists, or navigate long pages.",
        parameters: {
            type: "object",
            properties: {
                x:         { type: "number",  description: "X coordinate to scroll at" },
                y:         { type: "number",  description: "Y coordinate to scroll at" },
                direction: { type: "string",  enum: ["up", "down"], description: "Scroll direction" },
                amount:    { type: "number",  description: "Number of scroll notches (default 3)" },
            },
            required: ["x", "y", "direction"],
        },
    },
};

export async function executeRemoteScroll(args: { x: number; y: number; direction: "up" | "down"; amount?: number }): Promise<string> {
    if (!isRemoteAgentConnected()) return "Remote agent not connected. Start remote-agent on the PC.";
    const res = await sendRemoteRequest("scroll", { x: args.x, y: args.y, direction: args.direction, amount: args.amount ?? 3 });
    if (res.error) throw new Error(res.error);
    return res.stdout || `Scrolled ${args.direction} ${args.amount ?? 3} notches at (${args.x}, ${args.y})`;
}

// ─── Window Tools ─────────────────────────────────────────

export const remoteWindowListDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_window_list",
        description: "List all open windows on Boss's PC with their titles, process names, and PIDs.",
        parameters: { type: "object", properties: {}, required: [] },
    },
};

export async function executeRemoteWindowList(): Promise<string> {
    if (!isRemoteAgentConnected()) return "Remote agent not connected.";
    const res = await sendRemoteRequest("window_list", {});
    if (res.error) throw new Error(res.error);
    return res.stdout || "No windows found.";
}

export const remoteWindowFocusDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_window_focus",
        description: "Bring a window to the front on Boss's PC by matching its title. Use after opening an app to ensure it is in focus.",
        parameters: {
            type: "object",
            properties: {
                window_title: { type: "string", description: "Partial or full window title to match (case-insensitive)" },
            },
            required: ["window_title"],
        },
    },
};

export async function executeRemoteWindowFocus(args: { window_title: string }): Promise<string> {
    if (!isRemoteAgentConnected()) return "Remote agent not connected.";
    const res = await sendRemoteRequest("window_focus", { window_title: args.window_title });
    if (res.error) throw new Error(res.error);
    return res.stdout || `Focused window matching: ${args.window_title}`;
}

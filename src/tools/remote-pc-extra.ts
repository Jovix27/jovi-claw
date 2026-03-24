/**
 * remote-pc-extra.ts — Extended Agent Mode tools
 * Requires Agent Mode ON and remote agent connected.
 *
 * Tools:
 *   remote_pc_clipboard_get  — Read clipboard
 *   remote_pc_clipboard_set  — Write clipboard
 *   remote_pc_file_read      — Read file content
 *   remote_pc_file_write     — Write file content (base64-safe)
 *   remote_pc_file_list      — List directory
 *   remote_pc_process_list   — List running processes
 *   remote_pc_process_kill   — Kill a process by name or PID
 *   remote_pc_notify         — Windows toast notification
 *   remote_pc_open           — Open URL / file / app
 *   remote_pc_system_info    — CPU, RAM, disk, battery, uptime
 */

import type OpenAI from "openai";
import { sendRemoteRequest } from "../utils/remote-relay.js";

// ─── Helpers ────────────────────────────────────────────

function notConnected(): string {
    return JSON.stringify({ error: "Remote agent is not connected. Enable Agent Mode first." });
}

async function remote(
    type: Parameters<typeof sendRemoteRequest>[0],
    params: Record<string, unknown> = {},
    timeoutMs?: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
    return sendRemoteRequest(type, params, timeoutMs);
}

// ─── clipboard_get ───────────────────────────────────────

export const clipboardGetDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_clipboard_get",
        description: "Read the current clipboard content from Boss's remote PC.",
        parameters: { type: "object", properties: {}, required: [] },
    },
};

export async function executeClipboardGet(): Promise<string> {
    try {
        const r = await remote("clipboard_get");
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        return JSON.stringify({ clipboard: r.stdout.trim() });
    } catch (e: any) { return notConnected(); }
}

// ─── clipboard_set ───────────────────────────────────────

export const clipboardSetDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_clipboard_set",
        description: "Set the clipboard content on Boss's remote PC.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string", description: "Text to copy to clipboard" },
            },
            required: ["text"],
        },
    },
};

export async function executeClipboardSet(args: { text: string }): Promise<string> {
    try {
        const r = await remote("clipboard_set", { text: args.text });
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        return JSON.stringify({ success: true });
    } catch (e: any) { return notConnected(); }
}

// ─── file_read ───────────────────────────────────────────

export const fileReadDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_file_read",
        description: "Read the content of a file on Boss's remote PC.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute file path, e.g. C:\\Users\\Boss\\notes.txt" },
            },
            required: ["path"],
        },
    },
};

export async function executeFileRead(args: { path: string }): Promise<string> {
    try {
        const r = await remote("file_read", { path: args.path }, 15_000);
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        return JSON.stringify({ path: args.path, content: r.stdout });
    } catch (e: any) { return notConnected(); }
}

// ─── file_write ──────────────────────────────────────────

export const fileWriteDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_file_write",
        description: "Write content to a file on Boss's remote PC. Creates parent directories if needed.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute file path to write to" },
                content: { type: "string", description: "Text content to write" },
            },
            required: ["path", "content"],
        },
    },
};

export async function executeFileWrite(args: { path: string; content: string }): Promise<string> {
    try {
        // Base64-encode content so any special chars survive the PowerShell round-trip
        const content_b64 = Buffer.from(args.content, "utf8").toString("base64");
        const r = await remote("file_write", { path: args.path, content_b64 }, 15_000);
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        return JSON.stringify({ success: true, path: args.path });
    } catch (e: any) { return notConnected(); }
}

// ─── file_list ───────────────────────────────────────────

export const fileListDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_file_list",
        description: "List files and folders in a directory on Boss's remote PC.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Directory path to list, e.g. C:\\Users\\Boss\\Documents" },
            },
            required: ["path"],
        },
    },
};

export async function executeFileList(args: { path: string }): Promise<string> {
    try {
        const r = await remote("file_list", { path: args.path }, 15_000);
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        try {
            return JSON.stringify({ path: args.path, entries: JSON.parse(r.stdout || "[]") });
        } catch {
            return JSON.stringify({ path: args.path, entries: r.stdout });
        }
    } catch (e: any) { return notConnected(); }
}

// ─── process_list ────────────────────────────────────────

export const processListDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_process_list",
        description: "List the top running processes on Boss's remote PC, sorted by CPU usage.",
        parameters: { type: "object", properties: {}, required: [] },
    },
};

export async function executeProcessList(): Promise<string> {
    try {
        const r = await remote("process_list", {}, 15_000);
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        try {
            return JSON.stringify({ processes: JSON.parse(r.stdout || "[]") });
        } catch {
            return JSON.stringify({ processes: r.stdout });
        }
    } catch (e: any) { return notConnected(); }
}

// ─── process_kill ────────────────────────────────────────

export const processKillDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_process_kill",
        description: "Kill a running process on Boss's remote PC by name or PID.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Process name, e.g. notepad, chrome, Teams" },
                pid: { type: "number", description: "Process ID (use name OR pid)" },
            },
        },
    },
};

export async function executeProcessKill(args: { name?: string; pid?: number }): Promise<string> {
    try {
        const r = await remote("process_kill", args, 10_000);
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        return JSON.stringify({ success: true, message: r.stdout.trim() });
    } catch (e: any) { return notConnected(); }
}

// ─── notify ──────────────────────────────────────────────

export const notifyDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_notify",
        description: "Show a Windows toast notification on Boss's remote PC screen.",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "Notification title" },
                message: { type: "string", description: "Notification body text" },
            },
            required: ["title", "message"],
        },
    },
};

export async function executeNotify(args: { title: string; message: string }): Promise<string> {
    try {
        const r = await remote("notify", args, 15_000);
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        return JSON.stringify({ success: true });
    } catch (e: any) { return notConnected(); }
}

// ─── open ────────────────────────────────────────────────

export const openDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_open",
        description: "Open a URL, file, or application on Boss's remote PC using the system default handler.",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "URL (https://...), file path, or app name to open" },
            },
            required: ["target"],
        },
    },
};

export async function executeOpen(args: { target: string }): Promise<string> {
    try {
        const r = await remote("open", { target: args.target }, 10_000);
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        return JSON.stringify({ success: true, opened: args.target });
    } catch (e: any) { return notConnected(); }
}

// ─── system_info ─────────────────────────────────────────

export const systemInfoDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_system_info",
        description: "Get real-time system info from Boss's remote PC: CPU load, RAM, disk, battery, uptime, hostname.",
        parameters: { type: "object", properties: {}, required: [] },
    },
};

export async function executeSystemInfo(): Promise<string> {
    try {
        const r = await remote("system_info", {}, 20_000);
        if (r.exitCode !== 0) return JSON.stringify({ error: r.stderr || r.error });
        try {
            return JSON.stringify({ info: JSON.parse(r.stdout) });
        } catch {
            return JSON.stringify({ info: r.stdout });
        }
    } catch (e: any) { return notConnected(); }
}

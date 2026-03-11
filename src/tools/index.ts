import { logger } from "../utils/logger.js";
import { getCurrentTimeTool } from "./get-current-time.js";
import { respondWithVoiceTool } from "./send-voice-reply.js";
import type OpenAI from "openai";
import { getMcpToolDefinitions, isMcpTool, executeMcpTool } from "../utils/mcp-client.js";
import { recordSuccess, recordFailure, getMetricsSummary, formatMetricsReport } from "../utils/tool-metrics.js";

// ─── Tool interface ─────────────────────────────────────
export interface JoviTool {
    name: string;
    definition: OpenAI.ChatCompletionTool;
    execute: (input: Record<string, unknown>, userId?: number) => Promise<string>;
}

// ─── Agent Mode State ───────────────────────────────────
import { getCoreMemory, setCoreMemory } from "../utils/memory.js";

const AGENT_MODE_KEY = "agent_mode_enabled";

export async function setAgentMode(userId: number, enabled: boolean): Promise<void> {
    await setCoreMemory(userId, AGENT_MODE_KEY, enabled ? "true" : "false");
    logger.info(`Agent mode ${enabled ? "ENABLED 🟢" : "DISABLED 🔴"} for user ${userId}`);
}

export async function getAgentMode(userId: number): Promise<boolean> {
    const memory = await getCoreMemory(userId);
    const fact = memory.find(f => f.fact_key === AGENT_MODE_KEY);
    return fact?.fact_value === "true";
}

const REMOTE_TOOL_NAMES = new Set([
    "remote_pc_execute",
    "remote_pc_screenshot",
    "remote_pc_keyboard",
    "remote_pc_mouse",
    "remote_pc_camera",
]);

// ─── Registry ───────────────────────────────────────────
const registry = new Map<string, JoviTool>();

/**
 * Register a tool in the registry.
 */
function register(tool: JoviTool): void {
    if (registry.has(tool.name)) {
        logger.warn(`Tool "${tool.name}" already registered — overwriting.`);
    }
    registry.set(tool.name, tool);
    logger.debug(`Registered tool: ${tool.name}`);
}

/**
 * Get all tool definitions for the OpenAI API (function-calling format).
 * Includes both built-in tools and MCP-discovered tools.
 * Filters out remote PC tools if agent mode is disabled.
 */
export async function getToolDefinitions(userId: number): Promise<OpenAI.ChatCompletionTool[]> {
    const agentModeEnabled = await getAgentMode(userId);
    const builtIn = Array.from(registry.values())
        .filter((t) => agentModeEnabled || !REMOTE_TOOL_NAMES.has(t.name))
        .map((t) => t.definition);
    const mcp = getMcpToolDefinitions().filter(
        (t) => t.type !== "function" || (t.function.name !== "mcp_windows_cli_execute_command" && t.function.name !== "mcp_windows-cli_execute_command")
    );
    return [...builtIn, ...mcp];
}

/**
 * Execute a tool by name. Routes to MCP if the tool belongs to an MCP server.
 * Tracks execution metrics for monitoring and debugging.
 */
export async function executeTool(
    name: string,
    input: Record<string, unknown>,
    userId?: number
): Promise<string> {
    const startTime = Date.now();

    // Enforce security: Block direct execution of raw CLI MCP tool as it bypasses command validation
    if (name === "mcp_windows_cli_execute_command" || name === "mcp_windows-cli_execute_command") {
        recordFailure(name, "Security blocked direct execution", Date.now() - startTime);
        return JSON.stringify({ error: "Direct use of mcp_windows_cli_execute_command is blocked for security. Use the validated `remote_pc_execute` tool instead." });
    }

    // Check MCP tools first
    if (isMcpTool(name)) {
        logger.info(`Routing to MCP tool: ${name}`, { input });
        try {
            const result = await executeMcpTool(name, input);
            recordSuccess(name, Date.now() - startTime);
            return result;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            recordFailure(name, msg, Date.now() - startTime);
            throw error;
        }
    }

    const tool = registry.get(name);
    if (!tool) {
        logger.error(`Tool not found: ${name}`);
        recordFailure(name, "Tool not found");
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    logger.info(`Executing tool: ${name}`, { input, userId });

    try {
        const result = await tool.execute(input, userId);
        const latency = Date.now() - startTime;
        recordSuccess(name, latency);
        logger.debug(`Tool result for ${name}:`, { result: result.slice(0, 200), latencyMs: latency });
        return result;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        recordFailure(name, msg, Date.now() - startTime);
        logger.error(`Tool "${name}" failed.`, { error: msg });
        return JSON.stringify({ error: `Tool execution failed: ${msg}` });
    }
}

/**
 * Get tool execution metrics summary
 */
export { getMetricsSummary, formatMetricsReport };

import { rememberFactDef, executeRememberFact } from "./remember-fact.js";
import { recallMemoryDef, executeRecallMemory } from "./recall-memory.js";

import { openApplicationDef, executeOpenApplication } from "./open-application.js";
import { getSystemStatusDef, executeGetSystemStatus } from "./get-system-status.js";
import { webSearchDef, executeWebSearch } from "./web-search.js";
import { generateImageDef, executeGenerateImage } from "./generate-image.js";
import { sendEmailDef, executeSendEmail } from "./send-email.js";
import { delegateToSubagentDef, executeDelegateToSubagent } from "./delegate-subagent.js";
import { generatePdfDef, executeGeneratePdf } from "./generate-pdf.js";
import { remotePcExecuteDef, executeRemotePcCommand } from "./remote-pc-execute.js";
import {
    remoteScreenshotDef, remoteKeyboardDef, remoteMouseDef, remoteCameraDef,
    executeRemoteScreenshot, executeRemoteKeyboard, executeRemoteMouse, executeRemoteCamera
} from "./remote-pc-gui.js";
import { toggleAgentModeDef, executeToggleAgentMode } from "./agent-mode.js";

// New ChatGPT/Claude-like capabilities
import { analyzeImageDef, executeAnalyzeImage } from "./analyze-image.js";
import { codeInterpreterDef, executeCodeInterpreter } from "./code-interpreter.js";
import { analyzeDocumentDef, executeAnalyzeDocument } from "./analyze-document.js";
import { browseWebDef, executeBrowseWeb } from "./browse-web.js";
import { readSkillDef, executeReadSkill } from "./read-skill.js";

// Integration with Jovi Workspace (BuildSight)
import { joviIntegrationDef, executeJoviIntegration } from "./jovi-integration.js";

// Add new tools here as they are created.
register(getCurrentTimeTool);
register(respondWithVoiceTool);
register({
    name: "delegate_to_subagent",
    definition: delegateToSubagentDef,
    execute: (args, userId) => executeDelegateToSubagent(args as any, userId)
});
register({
    name: "generate_professional_pdf",
    definition: generatePdfDef,
    execute: (args, userId) => executeGeneratePdf(args as any, userId)
});
register({
    name: "remember_fact",
    definition: rememberFactDef,
    execute: (args, userId) => executeRememberFact(args as any, userId)
});
register({
    name: "recall_memory",
    definition: recallMemoryDef,
    execute: (args, userId) => executeRecallMemory(args as any, userId)
});
register({
    name: "open_application",
    definition: openApplicationDef,
    execute: (args) => executeOpenApplication(args as any)
});
register({
    name: "get_system_status",
    definition: getSystemStatusDef,
    execute: (args) => executeGetSystemStatus(args as any)
});
register({
    name: "web_search",
    definition: webSearchDef,
    execute: (args) => executeWebSearch(args as any)
});
register({
    name: "generate_image",
    definition: generateImageDef,
    execute: (args) => executeGenerateImage(args as any)
});
register({
    name: "send_email",
    definition: sendEmailDef,
    execute: (args) => executeSendEmail(args as any)
});
register({
    name: "remote_pc_execute",
    definition: remotePcExecuteDef,
    execute: (args) => executeRemotePcCommand(args as any)
});
register({
    name: "remote_pc_screenshot",
    definition: remoteScreenshotDef,
    execute: async () => {
        const res = await executeRemoteScreenshot();
        return JSON.stringify({ text: res.text, imageFile: res.imagePath });
    }
});
register({
    name: "remote_pc_keyboard",
    definition: remoteKeyboardDef,
    execute: (args) => executeRemoteKeyboard(args as any)
});
register({
    name: "remote_pc_mouse",
    definition: remoteMouseDef,
    execute: (args) => executeRemoteMouse(args as any)
});
register({
    name: "remote_pc_camera",
    definition: remoteCameraDef,
    execute: async () => {
        const res = await executeRemoteCamera();
        return JSON.stringify({ text: res.text, imageFile: res.imagePath });
    }
});
register({
    name: "toggle_agent_mode",
    definition: toggleAgentModeDef,
    execute: (args, userId) => executeToggleAgentMode(args as any, userId)
});

// ─── New ChatGPT/Claude-like Tools ─────────────────────
register({
    name: "analyze_image",
    definition: analyzeImageDef,
    execute: (args) => executeAnalyzeImage(args as any)
});
register({
    name: "code_interpreter",
    definition: codeInterpreterDef,
    execute: (args) => executeCodeInterpreter(args as any)
});
register({
    name: "analyze_document",
    definition: analyzeDocumentDef,
    execute: (args) => executeAnalyzeDocument(args as any)
});
register({
    name: "browse_web",
    definition: browseWebDef,
    execute: (args) => executeBrowseWeb(args as any)
});
register({
    name: "read_skill",
    definition: readSkillDef,
    execute: (args) => executeReadSkill(args as any)
});
register({
    name: "jovi_workspace_integration",
    definition: joviIntegrationDef,
    execute: (args) => executeJoviIntegration(args as any)
});

logger.info(`Built-in tool registry loaded.`, { count: registry.size });

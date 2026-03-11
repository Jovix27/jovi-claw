import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { logger } from "./logger.js";
import { audit } from "../security/audit-logger.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types ──────────────────────────────────────────────
interface McpServerConfig {
    command?: string;      // for stdio-based servers
    args?: string[];       // for stdio-based servers
    url?: string;          // for URL-based servers (SSE/Zapier)
    env?: Record<string, string>;
    disabled?: boolean;
}

interface McpConfig {
    mcpServers: Record<string, McpServerConfig>;
}

interface McpConnection {
    client: Client;
    transport: StdioClientTransport | SSEClientTransport;
    serverName: string;
    tools: string[];  // tool names owned by this server
}

/**
 * Resolve ${VAR} placeholders in a string from process.env.
 */
function resolveEnvVar(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
        return process.env[varName] ?? "";
    });
}

// ─── State ──────────────────────────────────────────────
const connections = new Map<string, McpConnection>();
const toolToServer = new Map<string, string>();  // toolName → serverName
const mcpToolDefs: OpenAI.ChatCompletionTool[] = [];

// ─── Env-var substitution ────────────────────────────────
/**
 * Replaces ${VAR_NAME} placeholders in a string with the value from
 * process.env. Throws if a referenced variable is not set, to prevent
 * silently passing empty credentials to child processes.
 */
function resolveEnvPlaceholders(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
        const resolved = process.env[varName];
        if (!resolved) {
            throw new Error(
                `mcp_config.json references env var \${${varName}} but it is not set. ` +
                `Add it to your .env file.`
            );
        }
        return resolved;
    });
}

function resolveArgs(args: string[]): string[] {
    return args.map(resolveEnvPlaceholders);
}

function resolveEnvRecord(env?: Record<string, string>): Record<string, string> | undefined {
    if (!env) return undefined;
    const resolved: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
        resolved[k] = resolveEnvPlaceholders(v);
    }
    return resolved;
}

// ─── Init ───────────────────────────────────────────────
/**
 * Reads mcp_config.json, spawns each server, discovers tools.
 * Non-fatal: if a server fails to connect, we log and skip it.
 */
export async function initMcpClients(): Promise<void> {
    const configPath = path.resolve(__dirname, "../../mcp_config.json");

    if (!fs.existsSync(configPath)) {
        logger.info("No mcp_config.json found — skipping MCP server init.");
        return;
    }

    let config: McpConfig;
    try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (err) {
        logger.error("Failed to parse mcp_config.json.", {
            error: err instanceof Error ? err.message : String(err),
        });
        return;
    }

    const entries = Object.entries(config.mcpServers);
    logger.info(`Found ${entries.length} MCP server(s) in config.`);

    for (const [serverName, serverConfig] of entries) {
        if (serverConfig.disabled) {
            logger.info(`MCP server "${serverName}" is disabled — skipping.`);
            continue;
        }

        try {
            await connectServer(serverName, serverConfig);
        } catch (err) {
            logger.error(`Failed to connect MCP server: ${serverName}`, {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    logger.info(`MCP init complete. ${connections.size} server(s) connected, ${mcpToolDefs.length} tool(s) registered.`);
}

/**
 * Strip verbose description fields from nested schema properties to save tokens.
 * Keeps type, required, and property names — strips descriptions from each property.
 */
function trimSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { type: schema.type ?? "object" };
    if (schema.required) result.required = schema.required;

    if (schema.properties && typeof schema.properties === "object") {
        const trimmedProps: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
            // Keep only type + enum, strip description to save tokens
            const prop: Record<string, unknown> = { type: val.type ?? "string" };
            if (val.enum) prop.enum = val.enum;
            if (val.items) prop.items = val.items;
            if (val.default !== undefined) prop.default = val.default;
            // Include a very short description if present (max 80 chars)
            if (val.description && typeof val.description === "string") {
                prop.description = val.description.length > 80
                    ? val.description.slice(0, 77) + "..."
                    : val.description;
            }
            trimmedProps[key] = prop;
        }
        result.properties = trimmedProps;
    }

    return result;
}

async function connectServer(
    serverName: string,
    config: McpServerConfig
): Promise<void> {
    // Resolve ${VAR} placeholders in args and env before spawning
    let resolvedArgs: string[];
    let resolvedConfigEnv: Record<string, string> | undefined;
    try {
        resolvedArgs = resolveArgs(config.args ?? []);
        resolvedConfigEnv = resolveEnvRecord(config.env);
    } catch (err) {
        // Missing env var — log clearly and skip this server
        logger.error(`MCP server "${serverName}" skipped: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }

    const isUrlBased = !!config.url;

    logger.info(`Connecting to MCP server: ${serverName}...`, {
        type: isUrlBased ? "url (SSE)" : "stdio",
        ...(isUrlBased ? {} : { command: config.command, argCount: resolvedArgs.length }),
    });

    const client = new Client({
        name: `jovi-ai-${serverName}`,
        version: "1.0.0",
    });

    let transport: StdioClientTransport | SSEClientTransport;

    if (isUrlBased) {
        // URL-based server (Zapier, remote MCP) — use SSE transport
        const resolvedUrl = resolveEnvVar(config.url!);
        transport = new SSEClientTransport(new URL(resolvedUrl));
    } else {
        // Stdio-based server (npx, local process)
        const mergedEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries({ ...process.env, ...(resolvedConfigEnv ?? {}) })) {
            if (v !== undefined) mergedEnv[k] = v;
        }

        transport = new StdioClientTransport({
            command: config.command!,
            args: resolvedArgs,
            env: mergedEnv,
        });
    }

    // Connect with a timeout to prevent hanging the entire bot startup
    const connectionPromise = client.connect(transport);
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Connection timeout after 30s`)), 30000)
    );

    await Promise.race([connectionPromise, timeoutPromise]);

    // Discover tools
    const { tools } = await client.listTools();
    const toolNames: string[] = [];

    for (const tool of tools) {
        // Prefix tool name with server name to avoid collisions
        // Sanitize server name to ensure LLMs like Gemini don't trip over hyphens
        const sanitizedServerName = serverName.replace(/-/g, "_");
        const qualifiedName = `mcp_${sanitizedServerName}_${tool.name}`;
        toolNames.push(qualifiedName);

        // Map tool → server for routing
        toolToServer.set(qualifiedName, serverName);

        // Truncate description to save tokens
        const desc = (tool.description ?? `MCP tool from ${serverName}`);
        const shortDesc = desc.length > 200 ? desc.slice(0, 197) + "..." : desc;

        // Trim parameter schema to reduce token usage
        const rawSchema = (tool.inputSchema as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
        };
        const trimmedSchema = trimSchema(rawSchema);

        // Convert MCP schema → OpenAI function-calling format
        const def: OpenAI.ChatCompletionTool = {
            type: "function",
            function: {
                name: qualifiedName,
                description: shortDesc,
                parameters: trimmedSchema,
            },
        };
        mcpToolDefs.push(def);
    }

    connections.set(serverName, {
        client,
        transport,
        serverName,
        tools: toolNames,
    });

    audit.mcpConnected(serverName, tools.length);
    logger.info(`✔ Connected to MCP server: ${serverName} (${tools.length} tools)`);
}

// ─── Tool definitions ───────────────────────────────────
/**
 * Returns all discovered MCP tool definitions in OpenAI format.
 */
export function getMcpToolDefinitions(): OpenAI.ChatCompletionTool[] {
    return mcpToolDefs;
}

// ─── Tool execution ──────────────────────────────────────
/**
 * Returns true if a tool name belongs to an MCP server.
 */
export function isMcpTool(toolName: string): boolean {
    // Normalize both hyphens and underscores for robustness
    const normalized = toolName.replace(/-/g, "_");
    return toolToServer.has(normalized);
}

/**
 * Execute an MCP tool by its qualified name (mcp_serverName_toolName).
 */
export async function executeMcpTool(
    qualifiedName: string,
    args: Record<string, unknown>
): Promise<string> {
    const normalizedName = qualifiedName.replace(/-/g, "_");
    const serverName = toolToServer.get(normalizedName);
    if (!serverName) {
        return JSON.stringify({ error: `No MCP server found for tool: ${qualifiedName} (normalized: ${normalizedName})` });
    }

    const conn = connections.get(serverName);
    if (!conn) {
        return JSON.stringify({ error: `MCP server "${serverName}" is not connected.` });
    }

    // Strip the prefix to get the original MCP tool name
    const sanitizedServerName = serverName.replace(/-/g, "_");
    const originalName = qualifiedName.replace(`mcp_${sanitizedServerName}_`, "");

    logger.info(`Calling MCP tool: ${originalName} on server: ${serverName}`, { args });

    try {
        const result = await conn.client.callTool({
            name: originalName,
            arguments: args,
        });

        // Extract text content from MCP result
        if (result.content && Array.isArray(result.content)) {
            const textParts = (result.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === "text" && c.text)
                .map((c) => c.text!);
            return textParts.join("\n") || JSON.stringify(result);
        }

        return JSON.stringify(result);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`MCP tool "${originalName}" failed on server "${serverName}".`, { error: msg });
        return JSON.stringify({ error: `MCP tool execution failed: ${msg}` });
    }
}

// ─── Shutdown ────────────────────────────────────────────
/**
 * Gracefully close all MCP server connections.
 */
export async function closeMcpClients(): Promise<void> {
    for (const [name, conn] of connections) {
        try {
            logger.info(`Closing MCP server: ${name}`);
            // Timeout per connection to prevent hanging on broken transports
            const closePromise = conn.client.close();
            const timeout = new Promise<void>((resolve) =>
                setTimeout(() => {
                    logger.warn(`Timeout closing MCP server: ${name} — forcing cleanup.`);
                    resolve();
                }, 5000)
            );
            await Promise.race([closePromise, timeout]);
        } catch (err) {
            logger.warn(`Error closing MCP server: ${name}`, {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    connections.clear();
    toolToServer.clear();
    mcpToolDefs.length = 0;
    logger.info("All MCP clients closed.");
}

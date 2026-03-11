import type OpenAI from "openai";
import { exec } from "node:child_process";
import { logger } from "../utils/logger.js";
import { sendRemoteCommand, isRemoteAgentConnected } from "../utils/remote-relay.js";

export const openApplicationDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "open_application",
        description: "Opens applications natively on the user's local Windows PC. Use this when the user asks to open Calculator, Edge, Chrome, Notepad, File Explorer, etc. Works remotely even when the bot is deployed in the cloud.",
        parameters: {
            type: "object",
            properties: {
                appName: {
                    type: "string",
                    description: "The name of the application to open (e.g., 'calc', 'msedge', 'chrome', 'notepad', 'explorer').",
                },
                searchQuery: {
                    type: "string",
                    description: "Optional: If opening a browser, a URL or search query to pass to it.",
                }
            },
            required: ["appName"],
        },
    },
};

export async function executeOpenApplication({ appName, searchQuery }: { appName: string, searchQuery?: string }): Promise<string> {
    logger.info(`Opening application/link: ${appName}`);

    let command = appName.toLowerCase().trim();

    // Normalize common names
    if (command.includes("calculat")) command = "calc";
    if (command.includes("edge") || command.includes("browser")) command = "msedge";
    if (command.includes("wordpad")) command = "write";
    if (command.includes("cmd") || command.includes("terminal")) command = "cmd";
    if (command === "settings") command = "ms-settings:";

    try {
        let fullCommand: string;

        // Check if it's already a protocol link (e.g., ms-settings:, tel:, mailto:) or a URL
        const isProtocolLink = command.includes(":") && !command.includes(" ");
        const isUrl = command.startsWith("http");

        if (isProtocolLink || isUrl) {
            fullCommand = `Start-Process "${command}"`;
        } else {
            fullCommand = `Start-Process "${command}"`;
        }

        if (searchQuery) {
            let safeSearch = searchQuery.replace(/"/g, '`"');
            if (!searchQuery.startsWith("http")) {
                safeSearch = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
            }
            fullCommand = `Start-Process "${command}" -ArgumentList "${safeSearch}"`;
        }

        logger.debug(`Executing command: ${fullCommand}`);

        // ─── Route through remote relay if agent is connected ────
        if (isRemoteAgentConnected()) {
            logger.info(`Remote agent connected — sending command to user's PC: ${fullCommand}`);
            try {
                const result = await sendRemoteCommand(fullCommand, "powershell");
                logger.info(`Remote open_application result: exitCode=${result.exitCode}`);
                return JSON.stringify({
                    success: true,
                    message: `Successfully opened ${appName} on your PC.`,
                    remote: true,
                });
            } catch (relayErr) {
                logger.error(`Remote relay failed for open_application`, {
                    error: relayErr instanceof Error ? relayErr.message : String(relayErr),
                });
                return JSON.stringify({
                    error: `Failed to open ${appName} remotely: ${relayErr instanceof Error ? relayErr.message : String(relayErr)}`,
                    hint: "Make sure the remote-agent is running on your PC.",
                });
            }
        }

        // ─── Fallback: local exec (for development / local testing) ────
        logger.info(`No remote agent — falling back to local exec: ${fullCommand}`);
        exec(fullCommand, { shell: "powershell.exe" }, (error) => {
            if (error) {
                logger.error(`Failed to execute OS control: ${fullCommand}`, { error });
            }
        });

        return JSON.stringify({ success: true, message: `Successfully requested to execute: ${fullCommand}` });
    } catch (error) {
        logger.error(`Error in OS control`, { error });
        return JSON.stringify({ error: String(error) });
    }
}

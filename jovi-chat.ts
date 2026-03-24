/**
 * jovi-chat.ts — Talk to Jovi directly from your terminal.
 * Usage: node --import tsx jovi-chat.ts
 */

import "dotenv/config";
import readline from "node:readline";
import { runAgentLoop } from "./src/agent/loop.js";
import { initMemoryDB } from "./src/utils/memory.js";
import { initSemanticMemory } from "./src/utils/semantic.js";
import { initMcpClients, closeMcpClients } from "./src/utils/mcp-client.js";
import { logger } from "./src/utils/logger.js";

// Force tool registry side-effect
import "./src/tools/index.js";

// ─── Boss user ID (from .env ALLOWED_USER_IDS) ──────────────
const BOSS_ID = parseInt(process.env.ALLOWED_USER_IDS?.split(",")[0] || "0", 10);

// ─── ANSI colours ────────────────────────────────────────────
const C = {
    reset: "\x1b[0m",
    cyan:  "\x1b[36m",
    green: "\x1b[32m",
    yellow:"\x1b[33m",
    dim:   "\x1b[2m",
    bold:  "\x1b[1m",
};

function printBanner() {
    console.log(`
${C.cyan}${C.bold}  ╦╔═╗╦  ╦╦  ╔═╗╦  — Terminal Chat
  ║║ ║╚╗╔╝║  ╠═╣║
  ╚╝╚═╝ ╚╝ ╩  ╩ ╩╩${C.reset}
${C.dim}  Type your message and press Enter. Type 'exit' to quit.${C.reset}
${"─".repeat(50)}
`);
}

async function main() {
    // Silence info logs so they don't pollute the chat UI
    process.env.LOG_LEVEL = "error";

    printBanner();

    // Init subsystems
    await initMemoryDB();
    await initSemanticMemory().catch(() => {}); // non-fatal
    await initMcpClients().catch(() => {});

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });

    const ask = () => {
        rl.question(`${C.yellow}You: ${C.reset}`, async (input) => {
            const msg = input.trim();
            if (!msg) { ask(); return; }
            if (msg.toLowerCase() === "exit" || msg.toLowerCase() === "quit") {
                console.log(`\n${C.dim}Jovi: Goodbye, Boss. 👋${C.reset}\n`);
                await closeMcpClients();
                rl.close();
                process.exit(0);
            }

            try {
                const result = await runAgentLoop(msg, BOSS_ID);
                console.log(`\n${C.green}Jovi:${C.reset} ${result.text}\n`);
            } catch (err) {
                console.error(`\n${C.dim}[Error] ${err instanceof Error ? err.message : String(err)}${C.reset}\n`);
            }

            ask();
        });
    };

    ask();
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});

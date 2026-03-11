import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const server = new Server(
    { name: "local-windows-cli", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "execute_command",
                description: "Execute a command in the Windows CLI. Use this to open files, format drives, fetch logs, or even run applications like calc.exe.",
                inputSchema: {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                            description: "The command to execute (e.g. 'dir', 'calc.exe', 'echo Hello')"
                        },
                        shell: {
                            type: "string",
                            enum: ["cmd", "powershell"],
                            description: "The shell to use (defaults to cmd)"
                        }
                    },
                    required: ["command"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "execute_command") {
        const { command, shell = "cmd" } = request.params.arguments as any;
        try {
            // Using execAsync ensures the command runs in the background 
            // without directly dumping into our stdio stream, 
            // preventing the MCP EOF corruption crash!
            const options = { shell: shell === "powershell" ? "powershell.exe" : "cmd.exe" };
            const { stdout, stderr } = await execAsync(command, options);

            return {
                content: [
                    { type: "text", text: `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}` }
                ]
            };
        } catch (err: any) {
            return {
                content: [
                    { type: "text", text: `Error executing command: ${err.message}\nSTDOUT:\n${err.stdout}\nSTDERR:\n${err.stderr}` }
                ],
                isError: true
            };
        }
    }

    throw new Error("Tool not found");
});

(async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Local Windows CLI MCP Server running on stdio"); // Uses stderr so it doesn't break JSON-RPC
})();

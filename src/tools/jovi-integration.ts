import { logger } from "../utils/logger.js";
import { sendWhatsAppDM } from "../bot/whatsapp-integration.js";

export const executeJoviIntegration = async (args: any): Promise<string> => {
    logger.info("Jovi Workspace Agent triggering Jovi Claw Integration", { args });
    
    // Check if the user wants an update or to perform an action related to BuildSight
    const action = args.action || "status";
    
    if (action === "sync_update") {
        return "Jovi Workspace Agent says: The workflow.md has been generated. The 75% GIS implementation and low-light dataset scans are currently underway! We are on track for the 3rd week of April deadline.";
    }
    
    if (action === "request_assistance") {
        return "Jovi Workspace Agent requires assistance from Jovi Claw regarding background execution monitoring. Please keep an eye on Python scripts running in the terminal.";
    }

    if (action === "send_wa_boss") {
        const number = args.number || "8015164110";
        const message = args.message || "Hi boss, I am Jovi";
        try {
            await sendWhatsAppDM(number, message);
            return `Successfully sent WhatsApp message to ${number}`;
        } catch (e) {
            return `Failed to send WhatsApp: ${(e as Error).message}`;
        }
    }

    return "Connected to Jovi Workspace Agent successfully. Ready for shared BuildSight execution.";
};

export const joviIntegrationDef = {
    type: "function" as const,
    function: {
        name: "jovi_workspace_integration",
        description: "Enables communication between the Jovi Telegram Bot (Claw) and the local VS Code Jovi Workspace Agent for the BuildSight project.",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    description: "The action to perform (e.g., 'sync_update', 'request_assistance', 'send_wa_boss')",
                    enum: ["sync_update", "request_assistance", "ping", "send_wa_boss"]
                },
                number: {
                    type: "string",
                    description: "Phone number for WhatsApp (default is Boss number)"
                },
                message: {
                    type: "string",
                    description: "Message content"
                }
            },
            required: ["action"],
        },
    },
};

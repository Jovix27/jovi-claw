import type OpenAI from "openai";
import si from "systeminformation";
import { logger } from "../utils/logger.js";

export const getSystemStatusDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "get_system_status",
        description: "Retrieves hardware and system vital statistics from the user's PC to answer questions like 'how much battery is left?' or 'how much RAM is being used?'",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    enum: ["battery", "cpu", "memory", "all"],
                    description: "The specific hardware component to check.",
                }
            },
            required: ["query"],
        },
    },
};

export async function executeGetSystemStatus({ query }: { query: "battery" | "cpu" | "memory" | "all" }): Promise<string> {
    logger.info(`Checking system status: ${query}`);
    try {
        const result: Record<string, any> = {};

        if (query === "battery" || query === "all") {
            const battery = await si.battery();
            result.battery = {
                hasBattery: battery.hasBattery,
                isCharging: battery.isCharging,
                percent: battery.percent,
                timeRemainingMinutes: battery.timeRemaining,
            };
        }

        if (query === "cpu" || query === "all") {
            const load = await si.currentLoad();
            const cpu = await si.cpuTemperature();
            result.cpu = {
                currentLoadPercent: load.currentLoad.toFixed(1) + "%",
                temperatureCelsius: cpu.main || "Unknown",
            };
        }

        if (query === "memory" || query === "all") {
            const mem = await si.mem();
            const totalGb = (mem.total / 1024 / 1024 / 1024).toFixed(1);
            const usedGb = (mem.active / 1024 / 1024 / 1024).toFixed(1);
            const freeGb = (mem.available / 1024 / 1024 / 1024).toFixed(1);
            result.memory = {
                totalGb,
                usedGb,
                freeGb,
                usagePercent: ((mem.active / mem.total) * 100).toFixed(1) + "%"
            };
        }

        return JSON.stringify({ success: true, hardwareStatus: result });
    } catch (error) {
        logger.error(`Error fetching system status`, { error });
        return JSON.stringify({ error: String(error) });
    }
}

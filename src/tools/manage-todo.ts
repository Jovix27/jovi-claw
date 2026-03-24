import { logger } from "../utils/logger.js";
import { config } from "../config/env.js";
import { GoogleAuth } from "google-auth-library";

// ─── Boss's To-Do List — Google Sheets Config ─────────────────
const SPREADSHEET_ID = "1-08KeydburA7eP04aY78_1HQeeyRgFF_jQ3rIJsSTuU";
const SHEET_NAME = "New Google Sheet for Schedule"; // Tab name (gid: 1130367379)
// Actual columns: A=Date | B=Day | C=Task Name | D=Status | E=Category | F=Description
const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

let authClient: GoogleAuth | null = null;
async function getAccessToken(): Promise<string> {
    const b64 = config.googleSheets.serviceAccountB64;
    if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 is missing in .env");
    
    if (!authClient) {
        const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
        authClient = new GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });
    }
    const client = await authClient.getClient();
    const token = await client.getAccessToken();
    return token.token as string;
}

function rangeUrl(range: string, params: Record<string, string> = {}): string {
    const search = new URLSearchParams(params);
    const qs = search.toString() ? `?${search.toString()}` : "";
    return `${BASE_URL}/values/${encodeURIComponent(range)}${qs}`;
}

async function sheetsGet(range: string): Promise<any> {
    const token = await getAccessToken();
    const res = await fetch(rangeUrl(range), {
        headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Sheets GET failed (${res.status}): ${err}`);
    }
    return res.json();
}

async function sheetsAppend(range: string, values: string[][]): Promise<any> {
    const token = await getAccessToken();
    const url = `${BASE_URL}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}` 
        },
        body: JSON.stringify({ values }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Sheets APPEND failed (${res.status}): ${err}`);
    }
    return res.json();
}

async function sheetsUpdate(range: string, values: string[][]): Promise<any> {
    const token = await getAccessToken();
    const url = `${BASE_URL}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
        method: "PUT",
        headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}` 
        },
        body: JSON.stringify({ values }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Sheets UPDATE failed (${res.status}): ${err}`);
    }
    return res.json();
}

// ─── Format helpers ─────────────────────────────────────────────
function getISTDate(): { date: string; day: string } {
    const now = new Date();
    const date = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
    const day = now.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" });
    return { date, day };
}

// ─── Tool Executor ──────────────────────────────────────────────
export const executeManageTodo = async (args: any): Promise<string> => {
    const action = (args.action as string)?.toLowerCase();

    if (!config.googleSheets.serviceAccountB64) {
        return JSON.stringify({ success: false, error: "GOOGLE_SERVICE_ACCOUNT_B64 is not set in .env." });
    }

    const sheetRange = `${SHEET_NAME}!A:F`;

    try {
        // ── list: Fetch all tasks (rows 2 onward, skip header) ───
        if (action === "list") {
            const data = await sheetsGet(`${SHEET_NAME}!A2:F`);
            const rows: string[][] = data.values || [];
            if (rows.length === 0) return JSON.stringify({ success: true, tasks: [], message: "To-do list is empty." });

            const tasks = rows.map((row, i) => ({
                row: i + 2,
                date: row[0] || "",
                day: row[1] || "",
                taskName: row[2] || "",
                status: row[3] || "Pending",
                category: row[4] || "",
                description: row[5] || "",
            }));
            return JSON.stringify({ success: true, count: tasks.length, tasks });
        }

        // ── add: Add a new task row ──────────────────────────────
        if (action === "add") {
            const taskName = args.task as string;
            if (!taskName) return JSON.stringify({ success: false, error: "'task' is required for add." });

            const { date, day } = getISTDate();
            const status = (args.status as string) || "Pending";
            const category = (args.category as string) || "General";
            const description = (args.description as string) || "";

            await sheetsAppend(sheetRange, [[date, day, taskName, status, category, description]]);
            logger.info("TODO: Task added", { taskName, category });
            return JSON.stringify({ success: true, message: `Task added: "${taskName}" [${category}] on ${date}` });
        }

        // ── update_status: Update the status cell for a row ──────
        if (action === "update_status") {
            const rowNum = args.row as number;
            const newStatus = args.status as string;
            if (!rowNum || !newStatus) {
                return JSON.stringify({ success: false, error: "'row' and 'status' are required for update_status." });
            }
            await sheetsUpdate(`${SHEET_NAME}!D${rowNum}`, [[newStatus]]);
            logger.info("TODO: Status updated", { row: rowNum, status: newStatus });
            return JSON.stringify({ success: true, message: `Row ${rowNum} status → "${newStatus}"` });
        }

        // ── summary: Count by status ─────────────────────────────
        if (action === "summary") {
            const data = await sheetsGet(`${SHEET_NAME}!A2:F`);
            const rows: string[][] = data.values || [];
            const counts: Record<string, number> = {};
            for (const row of rows) {
                const s = row[3] || "Pending";
                counts[s] = (counts[s] || 0) + 1;
            }
            return JSON.stringify({ success: true, total: rows.length, breakdown: counts });
        }

        // ── fetch_pending: Return only pending tasks ─────────────
        if (action === "fetch_pending") {
            const data = await sheetsGet(`${SHEET_NAME}!A2:F`);
            const rows: string[][] = data.values || [];
            const pending = rows
                .map((row, i) => ({
                    row: i + 2,
                    date: row[0],
                    taskName: row[2],
                    status: row[3],
                    category: row[4],
                    description: row[5],
                }))
                .filter(t => !t.status || t.status.toLowerCase() === "pending");
            return JSON.stringify({ success: true, pendingCount: pending.length, pending });
        }

        return JSON.stringify({
            success: false,
            error: `Unknown action: "${action}". Valid actions: list, add, update_status, summary, fetch_pending.`
        });

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("manage_todo tool error", { error: msg });
        return JSON.stringify({ success: false, error: msg });
    }
};

// ─── Tool Definition ────────────────────────────────────────────
export const manageTodoDef = {
    type: "function" as const,
    function: {
        name: "manage_todo",
        description: "Manage Boss's personal To-Do List in Google Sheets (titled 'New Google Sheet for Schedule'). Columns: Date, Day, Task Name, Status, Category. Use proactively: add tasks when Boss mentions work items, update status when marked done, fetch pending on heartbeat, list/summarize on request.",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["list", "add", "update_status", "summary", "fetch_pending"],
                    description: "list=all tasks, add=new task, update_status=change status of a row, summary=count by status, fetch_pending=only pending tasks"
                },
                task: {
                    type: "string",
                    description: "Task name/description (required for 'add')"
                },
                row: {
                    type: "number",
                    description: "Sheet row number to update (required for 'update_status')"
                },
                status: {
                    type: "string",
                    description: "Status value: 'Pending', 'In Progress', 'Done', 'Blocked', 'Cancelled'"
                },
                category: {
                    type: "string",
                    description: "Task category e.g. 'College', 'Technical', 'Career', 'Personal', 'General'"
                },
                description: {
                    type: "string",
                    description: "Extra detail or note about the task (maps to column F in the sheet)"
                }
            },
            required: ["action"],
        },
    },
};

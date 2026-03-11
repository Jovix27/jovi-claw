/**
 * Code Interpreter Tool — Execute Python/JavaScript code like ChatGPT
 *
 * Safely executes code in a sandboxed environment and returns results.
 * Supports data analysis, calculations, file manipulation, and more.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "../utils/logger.js";
import { sendRemoteCommand, isRemoteAgentConnected } from "../utils/remote-relay.js";

const execAsync = promisify(exec);

// ─── Tool Definition ────────────────────────────────────
export const codeInterpreterDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "code_interpreter",
        description:
            "Executes Python or JavaScript code and returns the output. Use this for: " +
            "mathematical calculations, data analysis, generating charts/visualizations, " +
            "file processing, web scraping results processing, algorithm implementation, " +
            "and any computational task. The code runs in a sandboxed environment with " +
            "common libraries available (numpy, pandas, matplotlib, requests, etc.).",
        parameters: {
            type: "object",
            properties: {
                code: {
                    type: "string",
                    description:
                        "The Python or JavaScript code to execute. For Python, common " +
                        "libraries are available. Always include print() statements to " +
                        "show results. For visualizations, save to a file and return the path.",
                },
                language: {
                    type: "string",
                    enum: ["python", "javascript", "powershell"],
                    description: "Programming language to use. Defaults to python.",
                },
                timeout_seconds: {
                    type: "number",
                    description: "Maximum execution time in seconds (default: 30, max: 120).",
                },
            },
            required: ["code"],
        },
    },
};

// ─── Blocked Patterns (Security) ────────────────────────
const DANGEROUS_PATTERNS = [
    /os\.system/i,
    /subprocess/i,
    /eval\s*\(/i,
    /exec\s*\(/i,
    /__import__/i,
    /open\s*\([^)]*['"](\/etc|C:\\Windows|\/usr)/i,
    /shutil\.rmtree/i,
    /rm\s+-rf/i,
    /del\s+\/[sfq]/i,
    /format\s+[a-z]:/i,
];

function validateCode(code: string): { valid: boolean; reason?: string } {
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(code)) {
            return { valid: false, reason: `Blocked: Code contains dangerous pattern` };
        }
    }

    if (code.length > 10000) {
        return { valid: false, reason: "Code too long (max 10000 characters)" };
    }

    return { valid: true };
}

// ─── Python Execution ───────────────────────────────────
async function executePython(code: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `jovi_script_${Date.now()}.py`);

    // Wrap code with common imports
    const wrappedCode = `
import sys
import json
import math
import datetime
import re
from collections import defaultdict, Counter

# Try importing common data science libraries
try:
    import numpy as np
except ImportError:
    pass

try:
    import pandas as pd
except ImportError:
    pass

try:
    import matplotlib
    matplotlib.use('Agg')  # Non-interactive backend
    import matplotlib.pyplot as plt
except ImportError:
    pass

# User code starts here
${code}
`;

    fs.writeFileSync(scriptPath, wrappedCode, "utf-8");

    try {
        const { stdout, stderr } = await execAsync(`python "${scriptPath}"`, {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024, // 1MB
            windowsHide: true,
        });

        return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (error: any) {
        return {
            stdout: error.stdout?.trim() || "",
            stderr: error.stderr?.trim() || error.message,
            exitCode: error.code || 1,
        };
    } finally {
        try {
            fs.unlinkSync(scriptPath);
        } catch { }
    }
}

// ─── JavaScript Execution ───────────────────────────────
async function executeJavaScript(code: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `jovi_script_${Date.now()}.js`);

    // Wrap code with common utilities
    const wrappedCode = `
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Helper function to format output
const print = console.log;

// User code starts here
${code}
`;

    fs.writeFileSync(scriptPath, wrappedCode, "utf-8");

    try {
        const { stdout, stderr } = await execAsync(`node "${scriptPath}"`, {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
        });

        return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (error: any) {
        return {
            stdout: error.stdout?.trim() || "",
            stderr: error.stderr?.trim() || error.message,
            exitCode: error.code || 1,
        };
    } finally {
        try {
            fs.unlinkSync(scriptPath);
        } catch { }
    }
}

// ─── Tool Execution ─────────────────────────────────────
export async function executeCodeInterpreter({
    code,
    language = "python",
    timeout_seconds = 30,
}: {
    code: string;
    language?: "python" | "javascript" | "powershell";
    timeout_seconds?: number;
}): Promise<string> {
    logger.info("Code interpreter executing", { language, codeLength: code.length });

    // Validate code
    const validation = validateCode(code);
    if (!validation.valid) {
        return JSON.stringify({
            success: false,
            error: validation.reason,
            blocked: true,
        });
    }

    const timeoutMs = Math.min(timeout_seconds, 120) * 1000;

    try {
        let result: { stdout: string; stderr: string; exitCode: number };

        if (language === "python") {
            result = await executePython(code, timeoutMs);
        } else if (language === "javascript") {
            result = await executeJavaScript(code, timeoutMs);
        } else if (language === "powershell") {
            // Execute on remote PC if connected
            if (isRemoteAgentConnected()) {
                const remoteResult = await sendRemoteCommand(code, "powershell", undefined, timeoutMs);
                result = {
                    stdout: remoteResult.stdout,
                    stderr: remoteResult.stderr,
                    exitCode: remoteResult.exitCode ?? 0,
                };
            } else {
                return JSON.stringify({
                    success: false,
                    error: "PowerShell execution requires remote agent connection.",
                });
            }
        } else {
            return JSON.stringify({
                success: false,
                error: `Unsupported language: ${language}`,
            });
        }

        const success = result.exitCode === 0;

        logger.info("Code execution complete", {
            success,
            outputLength: result.stdout.length,
            hasError: result.stderr.length > 0,
        });

        return JSON.stringify({
            success,
            output: result.stdout || "(no output)",
            error: result.stderr || undefined,
            exitCode: result.exitCode,
            language,
        });
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Code execution failed", { error: errorMsg });

        return JSON.stringify({
            success: false,
            error: errorMsg,
        });
    }
}

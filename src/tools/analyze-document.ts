/**
 * Document Analysis Tool — Read and analyze PDFs, Word docs, text files
 *
 * Extracts text from various document formats and can answer questions about them.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { logger } from "../utils/logger.js";

// ─── Tool Definition ────────────────────────────────────
export const analyzeDocumentDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "analyze_document",
        description:
            "Extracts and analyzes text from documents (PDF, TXT, MD, JSON, CSV, etc.). " +
            "Can summarize content, answer questions about the document, extract specific " +
            "information, or provide a full text extraction. Use this when Boss sends a " +
            "document or asks about file contents.",
        parameters: {
            type: "object",
            properties: {
                file_source: {
                    type: "string",
                    description:
                        "Path to the document file or URL to download from. " +
                        "Supports: .txt, .md, .json, .csv, .log, .xml, .html",
                },
                task: {
                    type: "string",
                    enum: ["extract_text", "summarize", "answer_question", "extract_data"],
                    description:
                        "What to do with the document: " +
                        "'extract_text' - Get full text, " +
                        "'summarize' - Provide a summary, " +
                        "'answer_question' - Answer a specific question, " +
                        "'extract_data' - Extract structured data (tables, lists)",
                },
                question: {
                    type: "string",
                    description:
                        "For 'answer_question' task, the specific question to answer about the document.",
                },
                max_chars: {
                    type: "number",
                    description:
                        "Maximum characters to return (default: 10000). Use lower values for summaries.",
                },
            },
            required: ["file_source", "task"],
        },
    },
};

// ─── Helper Functions ───────────────────────────────────

async function downloadFile(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith("https") ? https : http;

        client.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                // Follow redirect
                downloadFile(response.headers.location!).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve(Buffer.concat(chunks)));
            response.on("error", reject);
        }).on("error", reject);
    });
}

function extractTextFromFile(filePath: string, content: Buffer): string {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
        case ".txt":
        case ".md":
        case ".log":
        case ".py":
        case ".js":
        case ".ts":
        case ".jsx":
        case ".tsx":
        case ".css":
        case ".html":
        case ".xml":
        case ".yaml":
        case ".yml":
        case ".sh":
        case ".bat":
        case ".ps1":
            return content.toString("utf-8");

        case ".json":
            try {
                const json = JSON.parse(content.toString("utf-8"));
                return JSON.stringify(json, null, 2);
            } catch {
                return content.toString("utf-8");
            }

        case ".csv":
            return parseCSV(content.toString("utf-8"));

        default:
            // Try to read as text
            const text = content.toString("utf-8");
            // Check if it's actually text (not binary)
            if (/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
                throw new Error(`Binary file format not supported: ${ext}. Use PDF tools for PDFs.`);
            }
            return text;
    }
}

function parseCSV(content: string): string {
    const lines = content.split("\n");
    if (lines.length === 0) return content;

    // Try to detect headers and format nicely
    const headers = lines[0].split(",").map(h => h.trim());
    let formatted = `CSV with ${lines.length} rows and ${headers.length} columns\n\n`;
    formatted += `Columns: ${headers.join(", ")}\n\n`;

    // Show first few rows
    const preview = lines.slice(0, 11).join("\n");
    formatted += `Preview (first 10 rows):\n${preview}`;

    if (lines.length > 11) {
        formatted += `\n... and ${lines.length - 11} more rows`;
    }

    return formatted;
}

function summarizeText(text: string, maxChars: number): string {
    // Simple extractive summary - take first portion and key sentences
    if (text.length <= maxChars) return text;

    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);

    let summary = "";
    const targetLength = Math.min(maxChars, 2000);

    // Take important sentences (longer ones, ones with keywords)
    const importantKeywords = ["important", "key", "main", "summary", "conclusion", "result", "therefore", "however"];

    const scoredSentences = sentences.map((s, i) => ({
        text: s.trim(),
        score: s.length / 100 +
               (i < 5 ? 2 : 0) + // Favor early sentences
               (importantKeywords.some(k => s.toLowerCase().includes(k)) ? 1 : 0),
        index: i,
    }));

    scoredSentences.sort((a, b) => b.score - a.score);

    for (const sent of scoredSentences) {
        if (summary.length + sent.text.length + 2 <= targetLength) {
            summary += sent.text + ". ";
        }
    }

    return summary.trim() || text.slice(0, maxChars);
}

// ─── Tool Execution ─────────────────────────────────────
export async function executeAnalyzeDocument({
    file_source,
    task,
    question,
    max_chars = 10000,
}: {
    file_source: string;
    task: "extract_text" | "summarize" | "answer_question" | "extract_data";
    question?: string;
    max_chars?: number;
}): Promise<string> {
    logger.info("Analyzing document", { source: file_source.slice(0, 100), task });

    try {
        let content: Buffer;
        let fileName: string;

        // Get file content
        if (file_source.startsWith("http://") || file_source.startsWith("https://")) {
            content = await downloadFile(file_source);
            fileName = path.basename(new URL(file_source).pathname) || "document.txt";
        } else {
            const filePath = path.isAbsolute(file_source)
                ? file_source
                : path.resolve(process.cwd(), file_source);

            if (!fs.existsSync(filePath)) {
                return JSON.stringify({
                    success: false,
                    error: `File not found: ${filePath}`,
                });
            }

            content = fs.readFileSync(filePath);
            fileName = path.basename(filePath);
        }

        // Extract text
        let text: string;
        try {
            text = extractTextFromFile(fileName, content);
        } catch (error) {
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Failed to extract text",
            });
        }

        // Process based on task
        let result: string;

        switch (task) {
            case "extract_text":
                result = text.slice(0, max_chars);
                if (text.length > max_chars) {
                    result += `\n\n[Truncated - ${text.length - max_chars} more characters]`;
                }
                break;

            case "summarize":
                result = summarizeText(text, Math.min(max_chars, 2000));
                break;

            case "answer_question":
                // Return relevant context for the question
                // In a full implementation, this would use semantic search
                result = `Document content for analysis:\n\n${text.slice(0, max_chars)}`;
                if (question) {
                    result = `Question: ${question}\n\nDocument content:\n${text.slice(0, max_chars - question.length - 50)}`;
                }
                break;

            case "extract_data":
                // Try to identify structured data
                const lines = text.split("\n");
                const dataLines = lines.filter(l =>
                    l.includes(",") || l.includes("\t") || l.includes("|") || /^\s*[-*]\s/.test(l)
                );
                result = `Structured data found (${dataLines.length} lines):\n\n${dataLines.slice(0, 100).join("\n")}`;
                break;

            default:
                result = text.slice(0, max_chars);
        }

        logger.info("Document analysis complete", { fileName, textLength: text.length, resultLength: result.length });

        return JSON.stringify({
            success: true,
            fileName,
            fileSize: content.length,
            textLength: text.length,
            task,
            result,
        });
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Document analysis failed", { error: errorMsg });

        return JSON.stringify({
            success: false,
            error: errorMsg,
        });
    }
}

import type OpenAI from "openai";
import nodemailer from "nodemailer";
import dns from "node:dns";
import { logger } from "../utils/logger.js";

// Force IPv4 for all DNS lookups in this process.
// Bypasses Railway outbound IPv6 routing issues that caused ENETUNREACH on smtp.gmail.com
dns.setDefaultResultOrder("ipv4first");

export const sendEmailDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "send_email",
        description: "Send an email via Gmail on behalf of Boss. Use this when asked to send an email, forward information, or reach out to someone.",
        parameters: {
            type: "object",
            properties: {
                to: {
                    type: "string",
                    description: "Recipient email address (or comma-separated list).",
                },
                subject: {
                    type: "string",
                    description: "Email subject line.",
                },
                body: {
                    type: "string",
                    description: "Email body — plain text or simple HTML.",
                },
                cc: {
                    type: "string",
                    description: "Optional CC email address(es).",
                },
            },
            required: ["to", "subject", "body"],
        },
    },
};

export async function executeSendEmail({
    to,
    subject,
    body,
    cc,
}: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
}): Promise<string> {
    const gmailUser = process.env.GMAIL_USER;
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser || !gmailAppPassword) {
        return JSON.stringify({
            success: false,
            error: "Gmail not configured. GMAIL_USER and GMAIL_APP_PASSWORD env vars are missing.",
        });
    }

    logger.info(`Sending email to: ${to}`, { subject });

    try {
        const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            auth: {
                user: gmailUser,
                pass: gmailAppPassword,
            },
        });

        const info = await transporter.sendMail({
            from: `"Jovi (via Boss)" <${gmailUser}>`,
            to,
            cc: cc || undefined,
            subject,
            text: body,
            html: body.includes("<") ? body : body.replace(/\n/g, "<br>"),
        });

        logger.info(`Email sent successfully. MessageId: ${info.messageId}`);
        return JSON.stringify({
            success: true,
            messageId: info.messageId,
            to,
            subject,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to send email`, { error: msg });
        return JSON.stringify({ success: false, error: msg });
    }
}

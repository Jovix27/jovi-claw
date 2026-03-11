/**
 * Web Browsing Tool — Fetch and analyze web pages like ChatGPT
 *
 * Can visit URLs, extract content, and answer questions about web pages.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import https from "node:https";
import http from "node:http";
import { logger } from "../utils/logger.js";

// ─── Tool Definition ────────────────────────────────────
export const browseWebDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "browse_web",
        description:
            "Fetches and extracts content from a web page URL. Can read articles, " +
            "documentation, blog posts, and other web content. Use this when Boss asks " +
            "to visit a specific URL, read a webpage, or get information from a website. " +
            "Returns the main text content stripped of HTML.",
        parameters: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "The full URL to visit (must start with http:// or https://)",
                },
                extract_mode: {
                    type: "string",
                    enum: ["text", "links", "all", "raw"],
                    description:
                        "'text' - Extract main text content (default), " +
                        "'links' - Extract all links from the page, " +
                        "'all' - Both text and links, " +
                        "'raw' - Return raw HTML (truncated)",
                },
                max_chars: {
                    type: "number",
                    description: "Maximum characters to return (default: 8000)",
                },
            },
            required: ["url"],
        },
    },
};

// ─── Helper Functions ───────────────────────────────────

async function fetchUrl(url: string, maxRedirects = 5): Promise<{ content: string; finalUrl: string; contentType: string }> {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            reject(new Error("Too many redirects"));
            return;
        }

        const client = url.startsWith("https") ? https : http;

        const request = client.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Jovi-AI/1.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
            timeout: 15000,
        }, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    const absoluteUrl = redirectUrl.startsWith("http")
                        ? redirectUrl
                        : new URL(redirectUrl, url).toString();
                    fetchUrl(absoluteUrl, maxRedirects - 1).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }

            const contentType = response.headers["content-type"] || "text/html";
            const chunks: Buffer[] = [];

            response.on("data", (chunk) => {
                chunks.push(chunk);
                // Limit to ~2MB
                if (Buffer.concat(chunks).length > 2 * 1024 * 1024) {
                    request.destroy();
                    reject(new Error("Response too large (> 2MB)"));
                }
            });

            response.on("end", () => {
                resolve({
                    content: Buffer.concat(chunks).toString("utf-8"),
                    finalUrl: url,
                    contentType,
                });
            });

            response.on("error", reject);
        });

        request.on("error", reject);
        request.on("timeout", () => {
            request.destroy();
            reject(new Error("Request timeout"));
        });
    });
}

function stripHtmlTags(html: string): string {
    // Remove script and style elements
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");

    // Remove HTML tags but keep content
    text = text.replace(/<[^>]+>/g, " ");

    // Decode HTML entities
    text = text
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&mdash;/g, "—")
        .replace(/&ndash;/g, "–")
        .replace(/&#\d+;/g, "");

    // Normalize whitespace
    text = text
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();

    return text;
}

function extractLinks(html: string, baseUrl: string): Array<{ text: string; href: string }> {
    const links: Array<{ text: string; href: string }> = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        const text = match[2].trim();

        if (href && text && !href.startsWith("#") && !href.startsWith("javascript:")) {
            try {
                const absoluteUrl = href.startsWith("http")
                    ? href
                    : new URL(href, baseUrl).toString();
                links.push({ text, href: absoluteUrl });
            } catch { }
        }
    }

    // Deduplicate
    const seen = new Set<string>();
    return links.filter(link => {
        if (seen.has(link.href)) return false;
        seen.add(link.href);
        return true;
    });
}

function extractTitle(html: string): string {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : "";
}

function extractMetaDescription(html: string): string {
    const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    return metaMatch ? metaMatch[1].trim() : "";
}

// ─── Tool Execution ─────────────────────────────────────
export async function executeBrowseWeb({
    url,
    extract_mode = "text",
    max_chars = 8000,
}: {
    url: string;
    extract_mode?: "text" | "links" | "all" | "raw";
    max_chars?: number;
}): Promise<string> {
    logger.info("Browsing web", { url, extract_mode });

    // Validate URL
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return JSON.stringify({
            success: false,
            error: "Invalid URL. Must start with http:// or https://",
        });
    }

    try {
        const { content, finalUrl, contentType } = await fetchUrl(url);

        // Check if it's HTML
        const isHtml = contentType.includes("text/html") || content.trim().startsWith("<");

        let result: any = {
            success: true,
            url: finalUrl,
            contentType,
        };

        if (!isHtml) {
            // Return raw content for non-HTML
            result.content = content.slice(0, max_chars);
            result.type = "raw";
        } else {
            result.title = extractTitle(content);
            result.description = extractMetaDescription(content);

            switch (extract_mode) {
                case "raw":
                    result.html = content.slice(0, max_chars);
                    break;

                case "links":
                    const links = extractLinks(content, finalUrl);
                    result.links = links.slice(0, 50);
                    result.linkCount = links.length;
                    break;

                case "all":
                    const text = stripHtmlTags(content);
                    const allLinks = extractLinks(content, finalUrl);
                    result.content = text.slice(0, max_chars - 2000);
                    result.links = allLinks.slice(0, 20);
                    result.linkCount = allLinks.length;
                    break;

                case "text":
                default:
                    const textContent = stripHtmlTags(content);
                    result.content = textContent.slice(0, max_chars);
                    if (textContent.length > max_chars) {
                        result.truncated = true;
                        result.totalChars = textContent.length;
                    }
                    break;
            }
        }

        logger.info("Web browsing complete", { url: finalUrl, contentLength: content.length });

        return JSON.stringify(result);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Web browsing failed", { url, error: errorMsg });

        return JSON.stringify({
            success: false,
            url,
            error: errorMsg,
        });
    }
}

import type OpenAI from "openai";
import { logger } from "../utils/logger.js";

export const webSearchDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "web_search",
        description: "Search the web in real-time for up-to-date information, news, facts, or any query you don't know. Use this for current events, prices, companies, people, or anything time-sensitive.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The search query — be specific for best results.",
                }
            },
            required: ["query"],
        },
    },
};

/**
 * Simple HTML entity decoder
 */
function decodeHTMLEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}

/**
 * Parse Google News RSS XML into a list of articles.
 * No npm packages needed — pure regex on the RSS XML.
 */
function parseRss(xml: string): { title: string; url: string; date: string }[] {
    const items: { title: string; url: string; date: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 6) {
        const block = match[1];
        let title = (/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(block) ||
            /<title>([\s\S]*?)<\/title>/.exec(block))?.[1]?.trim() ?? "";
        const link = /<link>([\s\S]*?)<\/link>/.exec(block)?.[1]?.trim() ?? "";
        const date = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1]?.trim() ?? "";

        if (title && link) {
            title = decodeHTMLEntities(title);
            items.push({ title, url: link, date });
        }
    }
    return items;
}


/**
 * Google News RSS — free, no API key, works from any cloud IP.
 * Returns the top 6 matching news articles for any query.
 */
async function searchGoogleNews(query: string): Promise<{ title: string; url: string; date: string }[] | null> {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    try {
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; JoviBot/1.0)" },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        const xml = await res.text();
        const items = parseRss(xml);
        return items.length > 0 ? items : null;
    } catch {
        return null;
    }
}

/**
 * Jina.ai Reader — general web search, LLM-optimised markdown output.
 * Used as secondary source for non-news factual queries.
 */
async function searchJina(query: string): Promise<string | null> {
    const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
    try {
        const res = await fetch(url, {
            headers: {
                "Accept": "text/plain",
                "User-Agent": "Mozilla/5.0 (compatible; JoviBot/1.0)",
            },
            signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) return null;
        const text = await res.text();
        if (!text || text.trim().length < 80) return null;
        return text.length > 2500 ? text.slice(0, 2500) + "\n[...truncated]" : text;
    } catch {
        return null;
    }
}

export async function executeWebSearch({ query }: { query: string }): Promise<string> {
    logger.info(`Web search: "${query}"`);

    // Run Google News RSS and Jina.ai in parallel for speed
    const [newsItems, jinaResult] = await Promise.all([
        searchGoogleNews(query),
        searchJina(query),
    ]);

    // Prefer Google News if it returned results
    if (newsItems && newsItems.length > 0) {
        logger.info(`Web search: got ${newsItems.length} news results from Google News RSS`);
        return JSON.stringify({
            success: true,
            source: "Google News",
            query,
            articles: newsItems,
        });
    }

    // Fall back to Jina.ai for general/factual queries
    if (jinaResult) {
        logger.info(`Web search: got result from Jina.ai`);
        return JSON.stringify({
            success: true,
            source: "Jina.ai",
            query,
            results: jinaResult,
        });
    }

    logger.warn(`Web search: all sources failed for query: "${query}"`);
    return JSON.stringify({
        success: false,
        query,
        error: "Web search returned no results from any source. Please try a different query.",
    });
}

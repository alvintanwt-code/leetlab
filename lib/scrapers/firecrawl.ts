import Firecrawl from "@mendable/firecrawl-js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

let _client: Firecrawl | null = null;

function client(): Firecrawl {
  if (_client) return _client;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY missing — set it in .env.local");
  _client = new Firecrawl({ apiKey });
  return _client;
}

export type ScrapeResult = {
  markdown: string;
  url: string;
  scrapedAt: string;
};

export type JsonScrapeResult<T = unknown> = {
  json: T;
  url: string;
  scrapedAt: string;
};

// Firecrawl SDK action shapes we use. Keep loose — SDK types are not exported cleanly.
export type FirecrawlAction =
  | { type: "wait"; milliseconds: number }
  | { type: "click"; selector: string }
  | { type: "executeJavascript"; script: string };

const cacheDir = join(process.cwd(), "data", "raw");

function cachePath(key: string, ext: string): string {
  return join(cacheDir, key + ext);
}

export async function scrapeMarkdown(
  url: string,
  opts: {
    cacheKey?: string;
    waitFor?: number;
    force?: boolean;
    actions?: FirecrawlAction[];
    onlyMainContent?: boolean;
  } = {},
): Promise<ScrapeResult> {
  const { cacheKey, waitFor = 6000, force = false, actions, onlyMainContent = false } = opts;
  if (cacheKey && !force) {
    const p = cachePath(cacheKey, ".md");
    if (existsSync(p)) {
      return { markdown: readFileSync(p, "utf8"), url, scrapedAt: "cache" };
    }
  }
  const params: Record<string, unknown> = { formats: ["markdown"], waitFor, onlyMainContent };
  if (actions) params.actions = actions;
  const res = await client().scrape(url, params as Parameters<Firecrawl["scrape"]>[1]);
  const markdown = (res as { markdown?: string }).markdown ?? "";
  if (cacheKey) {
    const p = cachePath(cacheKey, ".md");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, markdown);
  }
  return { markdown, url, scrapedAt: new Date().toISOString() };
}

export async function scrapeJson<T = unknown>(
  url: string,
  prompt: string,
  opts: {
    cacheKey?: string;
    waitFor?: number;
    force?: boolean;
    actions?: FirecrawlAction[];
    onlyMainContent?: boolean;
  } = {},
): Promise<JsonScrapeResult<T>> {
  const { cacheKey, waitFor = 6000, force = false, actions, onlyMainContent = true } = opts;
  if (cacheKey && !force) {
    const p = cachePath(cacheKey, ".json");
    if (existsSync(p)) {
      return { json: JSON.parse(readFileSync(p, "utf8")) as T, url, scrapedAt: "cache" };
    }
  }
  const params: Record<string, unknown> = {
    formats: [{ type: "json", prompt }],
    waitFor,
    onlyMainContent,
  };
  if (actions) params.actions = actions;
  const res = await client().scrape(url, params as Parameters<Firecrawl["scrape"]>[1]);
  const json = ((res as { json?: T }).json ?? ({} as T)) as T;
  if (cacheKey) {
    const p = cachePath(cacheKey, ".json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(json, null, 2));
  }
  return { json, url, scrapedAt: new Date().toISOString() };
}

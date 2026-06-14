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

const cacheDir = join(process.cwd(), "data", "raw");

function cachePath(key: string): string {
  return join(cacheDir, key + ".md");
}

export async function scrapeMarkdown(
  url: string,
  opts: { cacheKey?: string; waitFor?: number; force?: boolean } = {},
): Promise<ScrapeResult> {
  const { cacheKey, waitFor = 6000, force = false } = opts;
  if (cacheKey && !force) {
    const p = cachePath(cacheKey);
    if (existsSync(p)) {
      return {
        markdown: readFileSync(p, "utf8"),
        url,
        scrapedAt: "cache",
      };
    }
  }
  const res = await client().scrape(url, {
    formats: ["markdown"],
    waitFor,
    onlyMainContent: false,
  });
  const markdown = (res as { markdown?: string }).markdown ?? "";
  if (cacheKey) {
    const p = cachePath(cacheKey);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, markdown);
  }
  return { markdown, url, scrapedAt: new Date().toISOString() };
}

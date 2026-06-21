// Refresh data/yield-overrides.json for entries with source="fwd".
//
// Why this script exists: Morningstar's public MFsnapshot returns an empty
// YieldHistory for MAS-coded SG funds (e.g. FSSA Dividend Advantage, SG9999002083).
// The same data IS rendered on FWD's fund-report page, sourced from a different
// Morningstar feed. We scrape FWD via Firecrawl, click open the Dividends
// accordion, and parse the "12 mo Yield" cell.
//
// Run with:
//   FIRECRAWL_API_KEY=... npx tsx scripts/scrape-platform-yields.ts
//
// Reads + writes data/yield-overrides.json. Manual entries (source !== "fwd")
// are preserved untouched.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Override = {
  yieldPct: number | null;
  source: string;
  msid?: string;
  asOf?: string | null;
  note?: string;
};
type OverridesFile = { _comment?: string; overrides: Record<string, Override> };

const FILE = join(process.cwd(), "data", "yield-overrides.json");
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const ACCORDION_SCRIPT = `(async () => {
  for (let i = 0; i < 5; i++) {
    document.querySelectorAll('h2, h3, button, a, span, div').forEach(el => {
      const t = (el.textContent || '').trim();
      if (t === 'Open') { try { el.click(); } catch(e) {} }
    });
    await new Promise(r => setTimeout(r, 1000));
  }
})()`;

async function scrapeFwdYield(msid: string, apiKey: string): Promise<{ yieldPct: number; asOf: string | null } | null> {
  const url = `https://www.fwd.com.sg/personalised-financial-advice/fund-report/?id=${encodeURIComponent(msid)}&idType=MSID&languageId=en-GB`;
  const body = {
    url,
    formats: ["markdown"],
    onlyMainContent: true,
    waitFor: 12000,
    actions: [
      { type: "executeJavascript", script: ACCORDION_SCRIPT },
      { type: "wait", milliseconds: 6000 },
    ],
  };
  const r = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.error(`  scrape failed: ${r.status} ${await r.text().catch(() => "")}`);
    return null;
  }
  const j = (await r.json()) as { data?: { markdown?: string } };
  const md = j?.data?.markdown ?? "";
  // "| 12 mo Yield | 3.37% |"
  const yieldMatch = md.match(/\|\s*12\s*mo\s*Yield\s*\|\s*([\d.]+)\s*%\s*\|/i);
  if (!yieldMatch) {
    console.error(`  "12 mo Yield" not found in scraped markdown (length=${md.length})`);
    return null;
  }
  const yieldPct = Number(yieldMatch[1]);
  // Ex-dividend date — useful "asOf" for the override row.
  const exDivMatch = md.match(/\|\s*Ex-dividend\s*\|\s*([^|]+?)\s*\|/i);
  const asOf = exDivMatch ? exDivMatch[1].trim() : null;
  return { yieldPct, asOf };
}

async function main() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error("FIRECRAWL_API_KEY not set");
    process.exit(1);
  }

  const file = JSON.parse(readFileSync(FILE, "utf8")) as OverridesFile;
  const isins = Object.keys(file.overrides);
  let updates = 0;
  let skipped = 0;
  let failed = 0;

  for (const isin of isins) {
    const row = file.overrides[isin];
    if (row.source !== "fwd") {
      console.log(`SKIP ${isin} (source=${row.source})`);
      skipped++;
      continue;
    }
    if (!row.msid) {
      console.log(`SKIP ${isin} (no msid)`);
      skipped++;
      continue;
    }
    console.log(`SCRAPE ${isin} (msid=${row.msid}) — ${row.note?.slice(0, 60) ?? ""}`);
    const scraped = await scrapeFwdYield(row.msid, apiKey);
    if (!scraped) {
      console.log(`  FAILED — keeping prior value ${row.yieldPct}`);
      failed++;
      continue;
    }
    const prev = row.yieldPct;
    row.yieldPct = scraped.yieldPct;
    row.asOf = scraped.asOf;
    console.log(`  → ${scraped.yieldPct}% (asOf ${scraped.asOf ?? "unknown"})${prev != null ? `, was ${prev}%` : ""}`);
    updates++;
  }

  writeFileSync(FILE, JSON.stringify(file, null, 2) + "\n", "utf8");
  console.log(`\nDone. updated=${updates} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

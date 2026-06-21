// Refresh data/yield-overrides.json by scraping platform fund-centre pages.
//
// Why this script exists: Morningstar's public MFsnapshot returns an empty
// YieldHistory for MAS-coded SG funds (e.g. FSSA Dividend Advantage SG9999002083
// on FWD/TMLS, Amova SG Div Eq SG9999003826 on TMLS). The same data IS rendered
// on the platform fund-report pages, sourced from a different Morningstar feed.
//
// Two refresh modes — selected per entry by `source`:
//   - source="fwd"          → scrape FWD, parse "12 mo Yield" cell directly.
//   - source="tmls-monthly" → scrape TMLS, parse latest dividend amount + NAV,
//                             compute amount × 12 / NAV (fund pays monthly).
//   - source="manual"       → leave untouched.
//
// Run with:
//   FIRECRAWL_API_KEY=... npx tsx scripts/scrape-platform-yields.ts
//
// Reads + writes data/yield-overrides.json.

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

// JS that hammers every accordion-toggle label until each section is open.
// Used on both FWD and TMLS — both render Morningstar's widget which uses
// "Open" as the toggle text.
const ACCORDION_SCRIPT = `(async () => {
  for (let i = 0; i < 6; i++) {
    document.querySelectorAll('h2, h3, button, a, span, div').forEach(el => {
      const t = (el.textContent || '').trim();
      if (t === 'Open') { try { el.click(); } catch(e) {} }
    });
    await new Promise(r => setTimeout(r, 1200));
  }
})()`;

async function firecrawlScrape(url: string, apiKey: string, waitFor = 12_000): Promise<string | null> {
  const body = {
    url,
    formats: ["markdown"],
    onlyMainContent: true,
    waitFor,
    actions: [
      { type: "executeJavascript", script: ACCORDION_SCRIPT },
      { type: "wait", milliseconds: 6_000 },
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
  return j?.data?.markdown ?? null;
}

async function scrapeFwdYield(msid: string, apiKey: string): Promise<{ yieldPct: number; asOf: string | null } | null> {
  const url = `https://www.fwd.com.sg/personalised-financial-advice/fund-report/?id=${encodeURIComponent(
    msid,
  )}&idType=MSID&languageId=en-GB`;
  const md = await firecrawlScrape(url, apiKey);
  if (!md) return null;
  // "| 12 mo Yield | 3.37% |"
  const yieldMatch = md.match(/\|\s*12\s*mo\s*Yield\s*\|\s*([\d.]+)\s*%\s*\|/i);
  if (!yieldMatch) {
    console.error(`  "12 mo Yield" not found in FWD markdown (length=${md.length})`);
    return null;
  }
  const exDivMatch = md.match(/\|\s*Ex-dividend\s*\|\s*([^|]+?)\s*\|/i);
  return { yieldPct: Number(yieldMatch[1]), asOf: exDivMatch ? exDivMatch[1].trim() : null };
}

// TMLS uses a hash-routed SPA: the URL must include `#?id=<MSID>` so the
// client-side router picks up the fund. Annualises from the latest payout
// assuming monthly distribution — caller verifies this is right for the fund.
async function scrapeTmlsMonthlyYield(
  msid: string,
  apiKey: string,
): Promise<{ yieldPct: number; asOf: string | null; latestPayout: number; nav: number } | null> {
  const url = `https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundreport.html?universeid=FOALL$$ALL_4556&currencyId=SGD#?id=${encodeURIComponent(
    msid,
  )}`;
  // TMLS SPA needs longer to settle than FWD.
  const md = await firecrawlScrape(url, apiKey, 18_000);
  if (!md) return null;
  // Latest dividend amount cell — TMLS shows "| Dividend amount | SGD 0.008 |"
  const amountMatch = md.match(/\|\s*Dividend amount\s*\|\s*[A-Z]{3}\s*([\d.]+)\s*\|/i);
  if (!amountMatch) {
    console.error(`  "Dividend amount" not found in TMLS markdown (length=${md.length})`);
    return null;
  }
  // NAV is shown earlier on the page outside the accordion.
  // "Latest NAV\n\n1.9284" — multi-line.
  const navMatch = md.match(/Latest NAV[\s\n]+([\d.]+)/i);
  if (!navMatch) {
    console.error(`  "Latest NAV" not found in TMLS markdown`);
    return null;
  }
  const exDivMatch = md.match(/\|\s*Ex-dividend\s*\|\s*([^|]+?)\s*\|/i);
  const latestPayout = Number(amountMatch[1]);
  const nav = Number(navMatch[1]);
  if (!isFinite(latestPayout) || !isFinite(nav) || nav <= 0) {
    console.error(`  parsed numbers invalid: payout=${latestPayout} nav=${nav}`);
    return null;
  }
  const yieldPct = Math.round(((latestPayout * 12) / nav) * 10_000) / 100;
  return { yieldPct, asOf: exDivMatch ? exDivMatch[1].trim() : null, latestPayout, nav };
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
    if (row.source === "manual") {
      console.log(`SKIP ${isin} (manual)`);
      skipped++;
      continue;
    }
    if (!row.msid) {
      console.log(`SKIP ${isin} (no msid)`);
      skipped++;
      continue;
    }
    console.log(`SCRAPE ${isin} (source=${row.source}, msid=${row.msid})`);

    if (row.source === "fwd") {
      const scraped = await scrapeFwdYield(row.msid, apiKey);
      if (!scraped) {
        console.log(`  FAILED — keeping prior value ${row.yieldPct}%`);
        failed++;
        continue;
      }
      const prev = row.yieldPct;
      row.yieldPct = scraped.yieldPct;
      row.asOf = scraped.asOf;
      console.log(`  → ${scraped.yieldPct}% (asOf ${scraped.asOf ?? "unknown"})${prev != null ? `, was ${prev}%` : ""}`);
      updates++;
      continue;
    }

    if (row.source === "tmls-monthly") {
      const scraped = await scrapeTmlsMonthlyYield(row.msid, apiKey);
      if (!scraped) {
        console.log(`  FAILED — keeping prior value ${row.yieldPct}%`);
        failed++;
        continue;
      }
      const prev = row.yieldPct;
      row.yieldPct = scraped.yieldPct;
      row.asOf = scraped.asOf;
      console.log(
        `  → ${scraped.yieldPct}% (latest payout ${scraped.latestPayout} × 12 / NAV ${scraped.nav}, asOf ${
          scraped.asOf ?? "unknown"
        })${prev != null ? `, was ${prev}%` : ""}`,
      );
      updates++;
      continue;
    }

    console.log(`SKIP ${isin} (unknown source=${row.source})`);
    skipped++;
  }

  writeFileSync(FILE, JSON.stringify(file, null, 2) + "\n", "utf8");
  console.log(`\nDone. updated=${updates} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

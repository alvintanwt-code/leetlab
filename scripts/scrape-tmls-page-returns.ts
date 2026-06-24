// Scrape TMLS fund-report pages directly via Firecrawl to fill the funds the
// Morningstar timeseries widget can't reach (e.g. FSSA Regional China / India).
// The TMLS page renders calendar-year returns, trailing 1M/3M/6M/1Y/3Y/5Y
// returns and standard deviation — same Morningstar data, just behind a
// different widget feed than scrape-mas-returns.ts uses.
//
// Run:
//   FIRECRAWL_API_KEY=… npx tsx scripts/scrape-tmls-page-returns.ts
//   FIRECRAWL_API_KEY=… npx tsx scripts/scrape-tmls-page-returns.ts --msid F0HKG062N3
//
// Reads + merges into data/return-overrides.json. Entries written here carry
// the same shape as the Morningstar-derived ones but omit the monthly `series`
// field — chart line still excludes them, but the picker / review YTD +
// calendar columns now resolve.

import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const ACCORDION_SCRIPT = `(async () => {
  for (let i = 0; i < 6; i++) {
    document.querySelectorAll('h2, h3, button, a, span, div').forEach(el => {
      const t = (el.textContent || '').trim();
      if (t === 'Open') { try { el.click(); } catch(e) {} }
    });
    await new Promise(r => setTimeout(r, 1500));
  }
})()`;

type Override = {
  msid: string;
  asOf: string;
  ytd: number | null;
  ann1y: number | null;
  ann3y: number | null;
  ann5y: number | null;
  ann10y: number | null;
  calendar: Record<string, number>;
  series?: { d: string; cum: number }[];
  stddev3y?: number | null;
};

async function firecrawlScrape(url: string, apiKey: string): Promise<string | null> {
  const body = {
    url,
    formats: ["markdown"],
    onlyMainContent: true,
    waitFor: 18_000,
    actions: [
      { type: "wait", milliseconds: 8_000 },
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

// Markdown number → JS number, handling U+2212 minus and en/em dashes.
function parseNum(raw: string): number | null {
  const cleaned = raw.replace(/[−–—]/g, "-").replace(/\s+/g, "").replace(/%$/, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "–") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Split a markdown row like "| Fund | 3.64 | 38.34 | ... |" into trimmed cells
// (without the leading/trailing "| " markers).
function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

// Locate two consecutive rows where the first matches `headerPattern` for the
// label column and the second is the corresponding fund row. Returns null when
// the table isn't on the page or the structure differs.
function findTable(md: string, headerStart: RegExp, fundLabel: RegExp): { header: string[]; fund: string[] } | null {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i];
    if (!headerStart.test(a)) continue;
    // skip alignment separator lines like "|---|---|"
    let j = i + 1;
    while (j < lines.length && /^\s*\|[-: |]+\|\s*$/.test(lines[j])) j++;
    const b = lines[j];
    if (!b || !fundLabel.test(b)) continue;
    return { header: splitRow(a), fund: splitRow(b) };
  }
  return null;
}

function parseCalendarReturns(md: string): { calendar: Record<string, number>; ytd: number | null } {
  // Header looks like: | | 2016 | 2017 | … | 2025 | YTD |
  const table = findTable(md, /^\s*\|\s*\|\s*20\d{2}\s*\|/, /^\s*\|\s*Fund\s*\|/);
  if (!table) return { calendar: {}, ytd: null };
  const calendar: Record<string, number> = {};
  let ytd: number | null = null;
  // header[0] is the empty corner, header[1..n] are 2016/2017/.../2025/YTD
  for (let i = 1; i < table.header.length; i++) {
    const h = table.header[i];
    const v = parseNum(table.fund[i] ?? "");
    if (v == null) continue;
    if (/^20\d{2}$/.test(h)) calendar[h] = v;
    else if (/^YTD$/i.test(h)) ytd = v;
  }
  return { calendar, ytd };
}

function parseTrailingReturns(md: string): { ann1y: number | null; ann3y: number | null; ann5y: number | null } {
  // Header: | | 1M | 3M | 6M | 1Y (ann) | 3Y (ann) | 5Y (ann) |
  const table = findTable(md, /^\s*\|\s*\|\s*1M\s*\|\s*3M\s*\|/, /^\s*\|\s*Fund\s*\|/);
  if (!table) return { ann1y: null, ann3y: null, ann5y: null };
  let ann1y: number | null = null;
  let ann3y: number | null = null;
  let ann5y: number | null = null;
  for (let i = 1; i < table.header.length; i++) {
    const h = table.header[i];
    const v = parseNum(table.fund[i] ?? "");
    if (v == null) continue;
    if (/^1Y/i.test(h)) ann1y = v;
    else if (/^3Y/i.test(h)) ann3y = v;
    else if (/^5Y/i.test(h)) ann5y = v;
  }
  return { ann1y, ann3y, ann5y };
}

function parseStdDev3Y(md: string): number | null {
  // Row: | Standard deviation (%) | 16.00 | 17.00 | 20.00 |   (1Y, 3Y, 5Y)
  const m = md.match(/\|\s*Standard deviation\s*\(%\)\s*\|\s*([-−\d.]+|–)\s*\|\s*([-−\d.]+|–)\s*\|\s*([-−\d.]+|–)\s*\|/);
  if (!m) return null;
  return parseNum(m[2]); // 3Y column
}

function latestDataMonth(md: string): string {
  // "Date of Latest NAV: 22 June 2026" — fallback to current YYYY-MM if absent.
  const m = md.match(/Date of Latest NAV\s*([\d]{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return new Date().toISOString().slice(0, 7);
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  const idx = months.findIndex((mo) => m[2].toLowerCase().startsWith(mo.toLowerCase()));
  if (idx < 0) return `${m[3]}-01`;
  return `${m[3]}-${String(idx + 1).padStart(2, "0")}`;
}

async function main() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error("FIRECRAWL_API_KEY not set. Export it or add to .env.local.");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL!);
  const onlyMsidIdx = process.argv.indexOf("--msid");
  const onlyMsid = onlyMsidIdx >= 0 ? process.argv[onlyMsidIdx + 1] : null;

  // Pull TMLS MAS-coded funds that don't already have a usable override entry.
  const rows = (onlyMsid
    ? await sql`
        SELECT DISTINCT f.external_id, f.isin, f.name
        FROM funds f
        JOIN providers p ON p.id = f.provider_id
        WHERE p.slug = 'tmls' AND f.external_id = ${onlyMsid}
      `
    : await sql`
        SELECT DISTINCT f.external_id, f.isin, f.name
        FROM funds f
        JOIN providers p ON p.id = f.provider_id
        WHERE p.slug = 'tmls' AND f.isin LIKE 'SG9999%'
        ORDER BY f.name
      `) as Array<{ external_id: string; isin: string; name: string }>;

  const outPath = join(process.cwd(), "data", "return-overrides.json");
  let prior: Record<string, Override> = {};
  if (existsSync(outPath)) {
    try {
      const parsed = JSON.parse(readFileSync(outPath, "utf8")) as { overrides?: Record<string, Override> };
      prior = parsed.overrides ?? {};
    } catch {
      // ignore
    }
  }

  // Skip funds that already have a populated entry (with calendar data); the
  // Morningstar timeseries scrape covered them already.
  const toScrape = rows.filter((r) => {
    const ov = prior[r.isin];
    return !ov || Object.keys(ov.calendar ?? {}).length === 0;
  });

  console.log(`Scraping ${toScrape.length} TMLS fund page(s) via Firecrawl…\n`);

  const overrides: Record<string, Override> = {};
  let ok = 0;
  let fail = 0;
  for (const [i, r] of toScrape.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));
    const url = `https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundreport.html?universeid=FOALL%24%24ALL_4556&currencyId=SGD#?id=${encodeURIComponent(r.external_id)}`;
    const md = await firecrawlScrape(url, apiKey);
    if (!md) {
      console.log(`  [${i + 1}/${toScrape.length}] ${r.external_id} ${r.name.slice(0, 40)} — SCRAPE FAILED`);
      fail++;
      continue;
    }
    const { calendar, ytd } = parseCalendarReturns(md);
    const { ann1y, ann3y, ann5y } = parseTrailingReturns(md);
    const stddev3y = parseStdDev3Y(md);
    if (Object.keys(calendar).length === 0 && ytd == null && ann1y == null) {
      console.log(`  [${i + 1}/${toScrape.length}] ${r.external_id} ${r.name.slice(0, 40)} — NO TABLES FOUND`);
      fail++;
      continue;
    }
    overrides[r.isin] = {
      msid: r.external_id,
      asOf: latestDataMonth(md),
      ytd,
      ann1y,
      ann3y,
      ann5y,
      ann10y: null,
      calendar,
      stddev3y,
    };
    const calStr = Object.entries(calendar)
      .slice(-3)
      .map(([y, v]) => `${y}:${v.toFixed(1)}%`)
      .join(" ");
    console.log(
      `  [${i + 1}/${toScrape.length}] ${r.external_id} ${r.name.slice(0, 40).padEnd(40)} ` +
        `1Y ${ann1y?.toFixed(1) ?? "—"} 3Y ${ann3y?.toFixed(1) ?? "—"} 5Y ${ann5y?.toFixed(1) ?? "—"} ` +
        `YTD ${ytd?.toFixed(2) ?? "—"}% stddev3y ${stddev3y?.toFixed(1) ?? "—"} [${calStr}]`,
    );
    ok++;
  }

  console.log(`\n✓ ${ok}/${toScrape.length} succeeded (${fail} failed)`);

  if (ok > 0) {
    const merged: Record<string, Override> = { ...prior, ...overrides };
    const payload = {
      _comment:
        "Monthly-derived returns for MAS-coded SG funds where Morningstar's MFsnapshot is empty. " +
        "Scraped from lt.morningstar.com/api/rest.svc/timeseries_cumulativereturn (most entries) and " +
        "tokiomarine.com fund-report pages (TMLS-only funds the timeseries feed doesn't expose). " +
        "Refreshed by scripts/scrape-mas-returns.ts and scripts/scrape-tmls-page-returns.ts.",
      asOfRun: new Date().toISOString().slice(0, 10),
      overrides: merged,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${outPath} (${Object.keys(merged).length} entries total, ${ok} new from TMLS scrape)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

// Scrape monthly total-return history for GWM (POEMS) funds that Morningstar's
// public widget API can't serve — MAS-coded SG9999/SGXZ funds whose MFsnapshot
// and timeseries_cumulativereturn both come back empty.
//
// Source: the Phillip Web Charting widget embedded on every POEMS fund page
// (phillipchartweb.poems.com.sg/displaychart.aspx). Its price history arrives
// over a push protocol (pmp.js, iframe/form-post), not a plain JSON endpoint,
// so we load the chart in headless Chrome, switch it to Daily × 20 Years, and
// read the Highcharts series straight off the page.
//
// The chart plots unit PRICE, not total return. Dividends come from the fund
// page's dividend table (all rows are in the server-rendered HTML) and are
// reinvested at the ex-date price, so distributing classes aren't understated.
// Each fund's computed 1Y/3Y/5Y/10Y is printed next to POEMS's own published
// total returns (Morningstar-sourced) as a sanity check.
//
// Output merges into data/return-overrides.json in the same shape as
// scripts/scrape-mas-returns.ts, so syntheticGrowth10K picks it up with no
// runtime changes. Entries that already carry a Morningstar series are left
// alone unless --force is passed.
//
//   npx tsx scripts/scrape-poems-navs.ts                    # all mapped funds
//   npx tsx scripts/scrape-poems-navs.ts --isin SG9999002224 # one fund
//   npx tsx scripts/scrape-poems-navs.ts --dry              # don't write the file
//   npx tsx scripts/scrape-poems-navs.ts --force            # overwrite Morningstar-sourced entries

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer-core";

// ISIN → POEMS fund code. Every mapping was checked against the ISIN printed
// on www.poems.com.sg/fund-finder/{code}/ (2026-09-15); the script re-checks
// on every run and skips a fund if the page ISIN no longer matches.
const POEMS_FUNDS: Record<string, { code: string; name: string }> = {
  SG9999002224: { code: "511090", name: "Allianz Global High Payout SGD" },
  SG9999000418: { code: "501003", name: "abrdn Glbl Technology SGD" },
  SG9999004360: { code: "509040", name: "Amova Singapore Equity SGD" },
  SG9999002794: { code: "532001", name: "Eastspring Inv UT Global Technology" },
  SG9999003289: { code: "526701", name: "Infinity US 500 Stock Index SGD" },
  SG9999003305: { code: "526702", name: "Infinity European Stock Index SGD" },
  SGXZ39775085: { code: "526705", name: "Infinity US 500 Stock Index C SGD" },
  SG9999003321: { code: "526703", name: "Infinity Global Stock Index SGD" },
  SG9999003339: { code: "526720", name: "Infinity Global Stock Index USD" },
  SG9999002422: { code: "526135", name: "LionGlobal Taiwan SGD" },
  SG9999007884: { code: "534123", name: "Phillip Singapore Rel Est Inc I SGD" },
  SG9999015952: { code: "526184", name: "LionGlobal Disruptive Innovation SGD I" },
  SG9999002356: { code: "526110", name: "LionGlobal Korea SGD" },
  SG9999013460: { code: "526180", name: "LionGlobal Singapore Div Eq SGD QDist" },
  SGXZ49509284: { code: "036524", name: "United China A-Shares Innovt A SGD Acc" },
  SG9999001176: { code: "036035", name: "United Global Healthcare SGD Acc" },
  SG9999001192: { code: "036060", name: "United Global Technology" },
  SG9999010029: { code: "036315", name: "United Asian High Yield Bd SGD Dist" },
  SG9999003826: { code: "509300", name: "Amova Singapore Div Eq SGD" },
  SG9999003925: { code: "509501", name: "Amova Singapore Div Eq USD" },
};

// Public chart-widget key embedded in every POEMS fund page's iframe URL.
const CHART_KEY = "331b7e417c8b4b7b9fad710fa2815736";
const CHART_URL = (code: string) =>
  `https://phillipchartweb.poems.com.sg/displaychart.aspx?g=${CHART_KEY}&c=${code};UT`;
const FUND_PAGE_URL = (code: string) => `https://www.poems.com.sg/fund-finder/${code}/`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

// The chart servers start answering "Chart is not available" after a burst of
// ~8 loads in quick succession, so pace fund-to-fund and back off once on a
// refusal before giving up on that fund.
const PAUSE_BETWEEN_FUNDS_MS = 20_000;
const RETRY_AFTER_REFUSAL_MS = 120_000;

const MONTHS_KEPT = 121; // 10 years + anchor month, same window as scrape-mas-returns.ts

const LOCAL_CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);

type Dividend = { exDate: string; amount: number }; // exDate YYYY-MM-DD
type PricePoint = { d: string; p: number }; // d YYYY-MM-DD (SGT)
type Series = { d: string; cum: number }[];

type Override = {
  msid: string;
  asOf: string;
  ytd: number | null;
  ann1y: number | null;
  ann3y: number | null;
  ann5y: number | null;
  ann10y: number | null;
  calendar: Record<string, number>;
  series: Series;
  stddev3y?: number | null;
};

/* ---------------- fund page (dividends + published returns) ---------------- */

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parsePoemsDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
}

function tableRows(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim()))
    .filter((r) => r.length > 0);
}

async function fetchFundPage(code: string): Promise<{
  isin: string | null;
  dividends: Dividend[];
  published: Record<string, number>;
}> {
  const res = await fetch(FUND_PAGE_URL(code), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fund page HTTP ${res.status}`);
  const html = await res.text();

  const isin = html.match(/ISIN:<\/strong><span>([A-Z0-9]+)/)?.[1] ?? null;

  const dividends: Dividend[] = [];
  const divIdx = html.indexOf("Dividend Payout per unit");
  if (divIdx >= 0) {
    const seg = html.slice(divIdx);
    const table = seg.slice(0, seg.indexOf("</table>"));
    for (const r of tableRows(table)) {
      const exDate = parsePoemsDate(r[0] ?? "");
      const amount = parseFloat(r[2] ?? "");
      if (exDate && Number.isFinite(amount) && amount > 0) dividends.push({ exDate, amount });
    }
  }
  dividends.sort((a, b) => a.exDate.localeCompare(b.exDate));

  const published: Record<string, number> = {};
  const trIdx = html.indexOf("Total Returns(%)");
  if (trIdx >= 0) {
    const seg = html.slice(trIdx);
    for (const r of tableRows(seg.slice(0, seg.indexOf("</table>")))) {
      const v = parseFloat(r[1] ?? "");
      if (Number.isFinite(v)) published[r[0]] = v;
    }
  }
  return { isin, dividends, published };
}

/* ---------------- chart widget (daily unit prices) ---------------- */

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  const executablePath = LOCAL_CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) {
    throw new Error("No local Chrome / Chromium found. Install Chrome or set CHROME_EXECUTABLE.");
  }
  return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}

async function readSeries(page: Page, code: string): Promise<PricePoint[]> {
  return page.evaluate((name: string) => {
    const H = (window as unknown as { Highcharts?: { charts: unknown[] } }).Highcharts;
    const chart = H?.charts.find(Boolean) as
      | { series: { name: string; xData?: number[]; yData?: (number | number[] | null)[] }[] }
      | undefined;
    const s = chart?.series.find((x) => x.name === name);
    if (!s) return [];
    const xs = s.xData ?? [];
    const ys = s.yData ?? [];
    const pad = (n: number) => String(n).padStart(2, "0");
    const out: { d: string; p: number }[] = [];
    for (let i = 0; i < xs.length; i++) {
      const y = ys[i];
      const p = Array.isArray(y) ? y[3] : y; // OHLC arrays → close
      if (p == null || !Number.isFinite(p)) continue;
      const dt = new Date(xs[i]); // chart runs with useUTC:false → local (SGT) dates
      out.push({ d: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, p });
    }
    return out;
  }, code);
}

class ChartRefused extends Error {}

async function chartRefused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.body?.innerText.includes("Chart is not available") ?? false);
}

async function waitForStableSeries(page: Page, code: string, minMs: number, maxMs: number): Promise<PricePoint[]> {
  const start = Date.now();
  let last = -1;
  let stableTicks = 0;
  let pts: PricePoint[] = [];
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 750));
    pts = await readSeries(page, code);
    if (pts.length === 0 && (await chartRefused(page))) throw new ChartRefused("chart refused");
    if (pts.length > 0 && pts.length === last) stableTicks++;
    else stableTicks = 0;
    last = pts.length;
    if (stableTicks >= 3 && Date.now() - start >= minMs) break;
  }
  return pts;
}

async function fetchDailyPrices(browser: Browser, code: string): Promise<PricePoint[]> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    // tsx (esbuild keepNames) wraps functions in a __name() helper; page.evaluate
    // ships those functions to the browser as source text, where it doesn't exist.
    await page.evaluateOnNewDocument("globalThis.__name = (fn) => fn;");
    await page.emulateTimezone("Asia/Singapore");
    await page.goto(CHART_URL(code), { waitUntil: "networkidle2", timeout: 60_000 });
    // Default view is Daily × 1 Year — wait for it, then widen to 20 Years.
    const initial = await waitForStableSeries(page, code, 1_500, 30_000);
    if (initial.length === 0) return [];
    await page.evaluate(() => {
      const $ = (window as unknown as { jQuery: (s: string) => { first(): { val(v: string): { trigger(e: string): void } } } }).jQuery;
      $(".pi_chartCycle").first().val("1440").trigger("change");
      $(".pi_chartPeriod").first().val("20").trigger("change");
    });
    const full = await waitForStableSeries(page, code, 4_000, 60_000);
    return full.length >= initial.length ? full : initial;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/* ---------------- total-return maths ---------------- */

// POEMS's dividend table doesn't always reach back to the start of the price
// history (Allianz Global High Payout lists payouts only from Dec 2018 while
// prices run from 2006). Price-only months would understate total return, so
// when prices predate the earliest recorded payout by more than a year, start
// the series the month before that payout. Conservative: a fund that genuinely
// began distributing late loses some valid history, but never shows a
// price-only figure as total return.
function trimToDividendCoverage(
  prices: PricePoint[],
  dividends: Dividend[],
): { prices: PricePoint[]; from: string | null } {
  if (dividends.length === 0) return { prices, from: null };
  const first = dividends[0].exDate;
  const oneYearBefore = `${parseInt(first.slice(0, 4), 10) - 1}${first.slice(4)}`;
  if (prices[0].d >= oneYearBefore) return { prices, from: null };
  const [y, m] = first.slice(0, 7).split("-").map(Number);
  const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { prices: prices.filter((p) => p.d.slice(0, 7) >= prevYm), from: prevYm };
}

// Reinvest each dividend at the first available price on/after its ex-date.
function totalReturnIndex(prices: PricePoint[], dividends: Dividend[]): PricePoint[] {
  let units = 1;
  let di = 0;
  while (di < dividends.length && dividends[di].exDate < prices[0].d) di++; // pre-history payouts
  return prices.map((pt) => {
    while (di < dividends.length && dividends[di].exDate <= pt.d) {
      units *= 1 + dividends[di].amount / pt.p;
      di++;
    }
    return { d: pt.d, p: units * pt.p };
  });
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

// Month-end sampling. The in-progress month is dropped so asOf is always a
// completed month, matching the Morningstar-sourced entries.
function monthlyCumulative(tr: PricePoint[]): Series {
  const byMonth = new Map<string, number>();
  for (const pt of tr) byMonth.set(pt.d.slice(0, 7), pt.p);
  const currentYm = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }).slice(0, 7);
  const months = [...byMonth.keys()].filter((ym) => ym < currentYm).sort().slice(-MONTHS_KEPT);
  if (months.length < 2) return [];
  const base = byMonth.get(months[0])!;
  return months.map((ym) => ({ d: lastDayOfMonth(ym), cum: (byMonth.get(ym)! / base - 1) * 100 }));
}

// Same definitions as scripts/scrape-mas-returns.ts so both sources line up.
function calendarYearReturns(series: Series): Record<string, number> {
  const endByYear = new Map<number, { d: string; cum: number }>();
  for (const p of series) endByYear.set(parseInt(p.d.slice(0, 4), 10), p);
  const years = [...endByYear.keys()].sort((a, b) => a - b);
  const out: Record<string, number> = {};
  for (let i = 0; i < years.length; i++) {
    const end = endByYear.get(years[i])!;
    if (end.d.slice(5, 7) !== "12") continue; // partial years go to YTD
    const start = i === 0 ? series[0] : endByYear.get(years[i - 1])!;
    out[String(years[i])] = Number((((1 + end.cum / 100) / (1 + start.cum / 100) - 1) * 100).toFixed(2));
  }
  return out;
}

function ytdReturn(series: Series): number | null {
  const last = series[series.length - 1];
  if (!last || last.d.slice(5, 7) === "12") return null;
  const priorDec = series.find((p) => p.d.startsWith(`${parseInt(last.d.slice(0, 4), 10) - 1}-12`));
  if (!priorDec) return null;
  return ((1 + last.cum / 100) / (1 + priorDec.cum / 100) - 1) * 100;
}

function trailingAnnualised(series: Series, months: number): number | null {
  if (series.length <= months) return null;
  const last = series[series.length - 1];
  const ref = series[series.length - 1 - months];
  const total = (1 + last.cum / 100) / (1 + ref.cum / 100) - 1;
  return months <= 12 ? total * 100 : (Math.pow(1 + total, 12 / months) - 1) * 100;
}

function stddev3y(series: Series): number | null {
  if (series.length <= 36) return null;
  const tail = series.slice(-37);
  const rets = tail.slice(1).map((p, i) => (1 + p.cum / 100) / (1 + tail[i].cum / 100) - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12) * 100;
}

// Point-in-time trailing return from the daily TR index, for comparing against
// POEMS's published (daily-as-of) figures.
function dailyTrailing(tr: PricePoint[], years: number): number | null {
  const last = tr[tr.length - 1];
  const target = `${parseInt(last.d.slice(0, 4), 10) - years}${last.d.slice(4)}`;
  const ref = [...tr].reverse().find((p) => p.d <= target);
  if (!ref || ref === tr[0] && tr[0].d > target) return null;
  const total = last.p / ref.p - 1;
  return years <= 1 ? total * 100 : (Math.pow(1 + total, 1 / years) - 1) * 100;
}

/* ---------------- main ---------------- */

const fmt = (v: number | null | undefined) => (v == null ? "   —  " : `${v >= 0 ? " " : ""}${v.toFixed(1)}`.padStart(6));

async function main() {
  const isinIdx = process.argv.indexOf("--isin");
  const onlyIsin = isinIdx >= 0 ? process.argv[isinIdx + 1] : null;
  const dry = process.argv.includes("--dry");
  const force = process.argv.includes("--force");

  const outPath = join(process.cwd(), "data", "return-overrides.json");
  const file = existsSync(outPath)
    ? (JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown> & { overrides?: Record<string, Override> })
    : {};
  const prior: Record<string, Override> = file.overrides ?? {};

  const targets = Object.entries(POEMS_FUNDS).filter(([isin]) => {
    if (onlyIsin) return isin === onlyIsin;
    const existing = prior[isin];
    const morningstarSourced = existing?.series?.length && !existing.msid.startsWith("poems:");
    if (morningstarSourced && !force) {
      console.log(`  skip ${isin} ${POEMS_FUNDS[isin].name} — already has a Morningstar series (use --force)`);
      return false;
    }
    return true;
  });
  if (targets.length === 0) {
    console.error(onlyIsin ? `ISIN ${onlyIsin} is not in the POEMS mapping.` : "Nothing to scrape.");
    process.exit(1);
  }

  console.log(`\nScraping ${targets.length} POEMS fund(s) via Phillip Web Charting…\n`);
  const browser = await launchBrowser();
  const results: Record<string, Override> = {};
  let ok = 0;
  let failed = 0;

  try {
    for (const [i, [isin, { code, name }]] of targets.entries()) {
      const tag = `[${i + 1}/${targets.length}] ${isin} ${code} ${name.slice(0, 36).padEnd(36)}`;
      try {
        const pageInfo = await fetchFundPage(code);
        if (pageInfo.isin !== isin) {
          console.log(`  ${tag} SKIP — POEMS page ISIN is ${pageInfo.isin ?? "missing"}`);
          failed++;
          continue;
        }
        if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_FUNDS_MS));
        let prices: PricePoint[];
        try {
          prices = await fetchDailyPrices(browser, code);
        } catch (e) {
          if (!(e instanceof ChartRefused)) throw e;
          console.log(`  ${tag} chart refused — retrying in ${RETRY_AFTER_REFUSAL_MS / 1000}s`);
          await new Promise((r) => setTimeout(r, RETRY_AFTER_REFUSAL_MS));
          prices = await fetchDailyPrices(browser, code);
        }
        if (prices.length < 30) {
          console.log(`  ${tag} NO DATA (${prices.length} daily prices)`);
          failed++;
          continue;
        }
        const trimmed = trimToDividendCoverage(prices, pageInfo.dividends);
        const tr = totalReturnIndex(trimmed.prices, pageInfo.dividends);
        const series = monthlyCumulative(tr);
        if (series.length < 2) {
          console.log(`  ${tag} NO DATA (not enough completed months)`);
          failed++;
          continue;
        }
        const entry: Override = {
          msid: `poems:${code}`,
          asOf: series[series.length - 1].d,
          ytd: ytdReturn(series),
          ann1y: trailingAnnualised(series, 12),
          ann3y: trailingAnnualised(series, 36),
          ann5y: trailingAnnualised(series, 60),
          ann10y: trailingAnnualised(series, 120),
          calendar: calendarYearReturns(series),
          series: series.map((p) => ({ d: p.d, cum: Number(p.cum.toFixed(4)) })),
          stddev3y: stddev3y(series),
        };
        results[isin] = entry;
        ok++;

        const pub = pageInfo.published;
        const check = ([["1Y", 1, "1 Year"], ["3Y", 3, "3 Years"], ["5Y", 5, "5 Years"], ["10Y", 10, "10 Years"]] as const)
          .map(([label, yrs, key]) => {
            const mine = dailyTrailing(tr, yrs);
            const theirs = pub[key];
            const gap = mine != null && theirs != null ? Math.abs(mine - theirs) : null;
            const flag = gap != null && gap > 1.5 ? "!" : " ";
            return `${label} ${fmt(mine)}/${fmt(theirs ?? null)}${flag}`;
          })
          .join("  ");
        console.log(
          `  ${tag} ${prices.length} px ${prices[0].d}→${prices[prices.length - 1].d}, ` +
            `${pageInfo.dividends.length} divs, asOf ${entry.asOf}` +
            (trimmed.from ? `, series from ${trimmed.from} (dividend records start ${pageInfo.dividends[0].exDate})` : "") +
            "\n" +
            `      ours/POEMS: ${check}`,
        );
      } catch (e) {
        console.log(`  ${tag} FAILED: ${(e as Error).message}`);
        failed++;
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  console.log(`\n✓ ${ok}/${targets.length} succeeded (${failed} failed). "!" = gap vs POEMS > 1.5pp`);

  if (dry) {
    console.log("--dry: not writing data/return-overrides.json");
    return;
  }
  if (ok === 0) return;
  const merged = { ...prior, ...results };
  writeFileSync(
    outPath,
    JSON.stringify({ ...file, poemsAsOfRun: new Date().toISOString().slice(0, 10), overrides: merged }, null, 2),
  );
  console.log(`Wrote ${outPath} (${Object.keys(merged).length} entries total, ${ok} from POEMS this run)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

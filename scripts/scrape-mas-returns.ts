// Scrape monthly cumulative returns for MAS-coded FWD funds from Morningstar's
// public chart endpoint (lt.morningstar.com/.../timeseries_cumulativereturn),
// then derive YTD, calendar-year, and trailing 1Y/3Y/5Y locally.
//
// Why: Morningstar's MFsnapshot returns empty for these MAS-coded SG funds,
// so the screener fallback only gives us ann_1y/3y/5y/10y. The widget chart
// on the FWD fund-report page hits this timeseries endpoint instead, which
// DOES return a monthly cumulative return series. We replicate the call here.
//
// Run with: npx tsx scripts/scrape-mas-returns.ts
// Optional flag: --msid F0HKG062MZ to limit to one fund.

import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });

import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const LT_KEY = "4j6t9375dd"; // public widget key seen on FWD/TMLS Morningstar reports
const LT_BASE = `https://lt.morningstar.com/api/rest.svc/timeseries_cumulativereturn/${LT_KEY}`;

type HistoryPoint = { EndDate: string; Value: string };
type Series = { d: string; cum: number }[]; // cum = cumulative % return from the anchor date

async function fetchCumulativeReturns(
  msid: string,
  startDate: string,
  endDate: string,
  currencyId = "SGD",
): Promise<Series | null> {
  const params = new URLSearchParams({
    currencyId,
    endDate,
    frequency: "monthly",
    id: msid,
    idType: "Morningstar",
    outputType: "json",
    performanceType: "",
    restructureDateOptions: "ignore",
    startDate,
  });
  const url = `${LT_BASE}?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const j = await res.json() as {
    TimeSeries?: {
      Security?: { CumulativeReturnSeries?: { HistoryDetail?: HistoryPoint[] }[] }[];
    };
  };
  const detail = j?.TimeSeries?.Security?.[0]?.CumulativeReturnSeries?.[0]?.HistoryDetail;
  if (!detail || detail.length === 0) return null;
  return detail.map((p) => ({ d: p.EndDate, cum: parseFloat(p.Value) }));
}

// Convert cumulative-return percentages to a growth-of-100 series.
function toGrowthOf100(series: Series): { d: string; v: number }[] {
  return series.map((p) => ({ d: p.d, v: 100 * (1 + p.cum / 100) }));
}

// Compute calendar-year returns from the cumulative series:
//   return_Y = (1 + cum_dec_Y/100) / (1 + cum_dec_Y-1/100) - 1
// For the first year (no prior Dec), anchor to the series' very first point.
function calendarYearReturns(series: Series): { year: number; return_pct: number }[] {
  if (series.length < 2) return [];
  // Pick the December-end point for each year (or last available month of that year).
  const endByYear = new Map<number, { d: string; cum: number }>();
  for (const p of series) {
    const y = parseInt(p.d.slice(0, 4), 10);
    const existing = endByYear.get(y);
    if (!existing || p.d > existing.d) endByYear.set(y, p);
  }
  // Anchor for the first year is the series' starting point (not strictly Jan 1,
  // but the earliest available NAV — close enough since Morningstar anchors at 0).
  const anchor = series[0];
  const years = Array.from(endByYear.keys()).sort((a, b) => a - b);
  const out: { year: number; return_pct: number }[] = [];
  for (let i = 0; i < years.length; i++) {
    const y = years[i];
    const end = endByYear.get(y)!;
    const start = i === 0 ? anchor : endByYear.get(years[i - 1])!;
    // Only emit if the year-end is actually December — partial latest year goes to YTD.
    const endMonth = parseInt(end.d.slice(5, 7), 10);
    if (i === years.length - 1 && endMonth < 12) continue;
    const ret = ((1 + end.cum / 100) / (1 + start.cum / 100) - 1) * 100;
    out.push({ year: y, return_pct: ret });
  }
  return out;
}

// YTD = cumulative return from last Dec close → latest available month.
function ytdReturn(series: Series): { asOf: string; return_pct: number } | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const lastYear = parseInt(last.d.slice(0, 4), 10);
  // Find the December close of the prior year.
  const priorDec = [...series].reverse().find((p) => {
    const y = parseInt(p.d.slice(0, 4), 10);
    const m = parseInt(p.d.slice(5, 7), 10);
    return y === lastYear - 1 && m === 12;
  });
  if (!priorDec) return null;
  const lastMonth = parseInt(last.d.slice(5, 7), 10);
  // Only YTD if the latest point is mid-year (not already a December close).
  if (lastMonth === 12 && last.d.endsWith("12-31")) return null;
  const ret = ((1 + last.cum / 100) / (1 + priorDec.cum / 100) - 1) * 100;
  return { asOf: last.d, return_pct: ret };
}

// Trailing N-month return → annualised when n > 12.
function trailingAnnualised(series: Series, months: number): number | null {
  if (series.length <= months) return null;
  const last = series[series.length - 1];
  const ref = series[series.length - 1 - months];
  const totalRet = (1 + last.cum / 100) / (1 + ref.cum / 100) - 1;
  if (months <= 12) return totalRet * 100;
  const years = months / 12;
  return (Math.pow(1 + totalRet, 1 / years) - 1) * 100;
}

type Override = {
  msid: string;
  asOf: string; // latest data month
  ytd: number | null;
  ann1y: number | null;
  ann3y: number | null;
  ann5y: number | null;
  ann10y: number | null;
  calendar: Record<string, number>; // year → return_pct
  // Monthly cumulative-return series, rebased to 0 at the anchor date. The
  // runtime converts this into a growth-of-100 line for the trailing chart.
  series: { d: string; cum: number }[];
};

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const onlyArgIdx = process.argv.indexOf("--msid");
  const onlyMsid = onlyArgIdx >= 0 ? process.argv[onlyArgIdx + 1] : null;

  const rows = onlyMsid
    ? await sql`
        SELECT f.external_id, f.isin, f.name
        FROM funds f
        JOIN providers p ON p.id = f.provider_id
        WHERE p.slug = 'fwd' AND f.external_id = ${onlyMsid}
      `
    : await sql`
        SELECT f.external_id, f.isin, f.name
        FROM funds f
        JOIN providers p ON p.id = f.provider_id
        WHERE p.slug = 'fwd' AND f.isin LIKE 'SG9999%'
        ORDER BY f.name
      `;

  console.log(`Scraping ${rows.length} MAS-coded FWD fund(s) via lt.morningstar.com timeseries…\n`);

  // 10-year window. Use today as endDate; the API gladly clamps to fund inception.
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDate = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate())
    .toISOString().slice(0, 10);

  const overrides: Record<string, Override> = {};
  let ok = 0;
  let fail = 0;

  for (const [i, r] of rows.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    const series = await fetchCumulativeReturns(r.external_id, startDate, endDate);
    if (!series) {
      console.log(`  [${i + 1}/${rows.length}] ${r.external_id} ${r.name} — NO DATA`);
      fail++;
      continue;
    }
    const cal = calendarYearReturns(series);
    const ytd = ytdReturn(series);
    const ann1y = trailingAnnualised(series, 12);
    const ann3y = trailingAnnualised(series, 36);
    const ann5y = trailingAnnualised(series, 60);
    const ann10y = trailingAnnualised(series, 120);
    overrides[r.isin] = {
      msid: r.external_id,
      asOf: series[series.length - 1].d,
      ytd: ytd?.return_pct ?? null,
      ann1y, ann3y, ann5y, ann10y,
      calendar: Object.fromEntries(cal.map((c) => [String(c.year), Number(c.return_pct.toFixed(2))])),
      series: series.map((p) => ({ d: p.d, cum: Number(p.cum.toFixed(4)) })),
    };
    const ytdStr = ytd ? `YTD ${ytd.return_pct.toFixed(2)}%` : "no YTD";
    const calStr = cal.slice(-3).map((c) => `${c.year}:${c.return_pct.toFixed(1)}%`).join(" ");
    console.log(
      `  [${i + 1}/${rows.length}] ${r.external_id} ${r.name.slice(0, 38).padEnd(38)} ` +
      `1Y ${ann1y?.toFixed(1) ?? "—"} 3Y ${ann3y?.toFixed(1) ?? "—"} 5Y ${ann5y?.toFixed(1) ?? "—"}  ${ytdStr}  [${calStr}]`,
    );
    ok++;
  }

  console.log(`\n✓ ${ok}/${rows.length} succeeded (${fail} failed)`);

  if (!onlyMsid) {
    const outPath = join(process.cwd(), "data", "return-overrides.json");
    const payload = {
      _comment:
        "Monthly-derived returns for MAS-coded SG funds where Morningstar's MFsnapshot is empty. " +
        "Scraped from lt.morningstar.com/api/rest.svc/timeseries_cumulativereturn (the same endpoint " +
        "the FWD fund-report chart hits). Refreshed by scripts/scrape-mas-returns.ts.",
      asOfRun: endDate,
      overrides,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${outPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

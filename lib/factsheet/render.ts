import type {
  ConfirmedPortfolio,
  ConfirmedPortfolioHolding,
} from "@/lib/db/queries";
import type { PortfolioXray } from "@/lib/portfolio-derive";
import type { BlendedSeries } from "@/lib/portfolio-performance";

/**
 * Owns the Global Alpha fact-sheet template. Everything the SKILL.md
 * brand system prescribes (Bitter/Nunito Sans/Archivo Narrow, teal palette,
 * hairlines, 816×1056 fixed pages, print-safe color-adjust) lives here.
 *
 * Consumer route (app/api/factsheet/[id]/route.ts) shapes the raw DB payload
 * into the `FactsheetInput` this function expects, so re-rendering for a
 * different portfolio never touches this file.
 */

const CATEGORY_LABEL: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
  aggressive: "Aggressive",
  dividend_income: "Income",
};

const MANDATE_LINES = [
  "We own <em>proven businesses</em>, anywhere in the world.",
  "We favour <em>smaller, profitable companies</em> bought at sensible prices.",
  "We respect market and credit cycles.",
  "We do not trade to look busy. Returns come from <em>staying invested</em>.",
];

export type FactsheetInput = {
  portfolio: ConfirmedPortfolio;
  holdings: ConfirmedPortfolioHolding[];
  xray: PortfolioXray | null;
  series: BlendedSeries;
  weightedYtd: number | null;
  weightedStddev3y: number | null;
  asOfMonth: Date;
};

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtPct(v: number | null | undefined, places = 1, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = signed ? (v >= 0 ? "+" : "−") : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(places)}%`;
}

function fmtSgd(v: number): string {
  return `S$${Math.round(v).toLocaleString("en-SG")}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleString("en-SG", { month: "long", year: "numeric" }).toUpperCase();
}

function shortMonth(iso: string): string {
  // iso is "YYYY-MM"
  const [y, m] = iso.split("-").map((s) => parseInt(s, 10));
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return d.toLocaleString("en-SG", { month: "short", year: "numeric" });
}

function chartYearTicks(startIso: string, endIso: string): number[] {
  const startY = parseInt(startIso.slice(0, 4), 10);
  const endY = parseInt(endIso.slice(0, 4), 10);
  const out: number[] = [];
  for (let y = startY; y <= endY; y++) out.push(y);
  return out;
}

// Rebase a growth-of-100 series to growth-of-S$100k anchored at first point.
function rebaseToSgd(series: BlendedSeries): { path: string; areaPath: string; end: number; yMin: number; yMax: number; startIso: string; endIso: string } | null {
  if (!series || series.points.length < 2) return null;
  const base = series.points[0].v;
  const values = series.points.map((p) => (p.v / base) * 100_000);
  const end = values[values.length - 1];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Round bounds to a friendly 25k grid.
  const step = 25_000;
  const yMin = Math.floor(rawMin / step) * step;
  const yMax = Math.ceil(rawMax / step) * step;
  const W = 700, H = 200;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - yMin) / (yMax - yMin)) * H;
    return [x, y];
  });
  const path = pts.map(([x, y], i) => (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
  const areaPath = path + ` L ${W} ${H} L 0 ${H} Z`;
  return { path, areaPath, end, yMin, yMax, startIso: series.start, endIso: series.end };
}

// ─── Rendering helpers ─────────────────────────────────────────
function renderAllocation(holdings: ConfirmedPortfolioHolding[], totalBps: number): string {
  return holdings
    .map((h) => {
      const pct = (h.weight_bps / totalBps) * 100;
      const barWidth = Math.max(2, pct); // tiny minimum so a 0.5% sliver is still visible
      return `
        <div class="alloc-row">
          <div class="alloc-nm">
            <span class="fn">${esc(h.name)}</span>
            <span class="pct num">${pct.toFixed(0)}%</span>
          </div>
          <div class="alloc-isin">${esc(h.isin ?? "—")} · ${esc(h.currency ?? "")}</div>
          <div class="alloc-bar"><div class="fill" style="width:${barWidth.toFixed(1)}%"></div></div>
        </div>`;
    })
    .join("");
}

function renderHoldingsLookThrough(holdings: PortfolioXray["holdings"] | undefined): string {
  if (!holdings || holdings.length === 0) {
    return `<div class="holdings-row" style="grid-template-columns:1fr;color:var(--mute)"><div>Not yet published.</div></div>`;
  }
  return holdings
    .slice(0, 10)
    .map((h: { label: string; weight_pct: number }, i: number) => {
      const rk = String(i + 1).padStart(2, "0");
      return `
        <div class="holdings-row">
          <div class="rk">${rk}</div>
          <div class="nm">${esc(h.label)}</div>
          <div class="sc">—</div>
          <div class="wt">${h.weight_pct.toFixed(2)}%</div>
        </div>`;
    })
    .join("");
}

function renderBarRows(rows: { label: string; weight_pct: number }[] | undefined): string {
  if (!rows || rows.length === 0) {
    return `<div class="grid-row"><div class="lbl" style="color:var(--mute)">Not yet published.</div><div></div><div></div></div>`;
  }
  const max = Math.max(...rows.map((r) => r.weight_pct));
  return rows
    .map((r) => {
      const barW = max > 0 ? (r.weight_pct / max) * 100 : 0;
      return `
        <div class="grid-row">
          <div class="lbl">${esc(r.label)}</div>
          <div class="track"><div class="fill" style="width:${barW.toFixed(1)}%"></div></div>
          <div class="val">${r.weight_pct.toFixed(1)}%</div>
        </div>`;
    })
    .join("");
}

export function renderFactsheetHtml(input: FactsheetInput): string {
  const { portfolio, holdings, xray, series, weightedYtd, weightedStddev3y, asOfMonth } = input;
  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;
  const rebased = rebaseToSgd(series);

  const categoryLabel = CATEGORY_LABEL[portfolio.category] ?? portfolio.category;
  const heroPct = xray?.r5y ?? xray?.r3y ?? xray?.r1y ?? null;
  const heroWindow = xray?.r5y != null ? "5-year annualised" : xray?.r3y != null ? "3-year annualised" : "1-year";
  const cumulativeSinceStart = rebased ? rebased.end / 1000 - 100 : null; // (end/100k - 1) × 100

  // Weighted expense from holdings (fund-level expense_ratio × weight); fall back to xray.expense if that's already sensible.
  const weightedExpense = holdings.reduce((s, h) => {
    if (h.expense_ratio == null) return s;
    return s + (h.weight_bps / totalBps) * h.expense_ratio;
  }, 0);

  const asOfMonthUpper = monthLabel(asOfMonth);
  const asOfMonthShort = asOfMonth.toLocaleString("en-SG", { month: "short", year: "numeric" });

  const yearTicks = rebased ? chartYearTicks(rebased.startIso, rebased.endIso) : [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(portfolio.name)} — Portfolio Fact Sheet · ${esc(asOfMonthShort)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bitter:wght@400;500;600&family=Nunito+Sans:wght@400;500;600&family=Archivo+Narrow:wght@400;500&display=swap">
<style>
  :root{
    --ink:#141614; --white:#FFFFFF;
    --hair:#D9DAD9; --hair-soft:#EBEBEC;
    --teal-deep:#00818B; --teal-bright:#00B4BE;
    --red:#E20C10; --mute:#545553; --mute-2:#838483;
    --serif:'Bitter', Georgia, 'Times New Roman', serif;
    --sans:'Nunito Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif;
    --cond:'Archivo Narrow', 'Arial Narrow', 'Helvetica Neue Condensed', Arial, sans-serif;
  }
  *{ box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body{ background:var(--hair-soft); color:var(--ink); font-family:var(--sans); font-size:12px; line-height:1.45; }
  .page{ width:816px; height:1056px; background:var(--white); padding:48px 56px; margin:24px auto; position:relative; overflow:hidden; display:flex; flex-direction:column; }
  @page{ size:letter; margin:0; }
  @media print{
    html, body{ background:var(--white); }
    .page{ margin:0; page-break-after:always; page-break-inside:avoid; }
    .page:last-of-type{ page-break-after:auto; }
  }
  em{ font-style:italic; font-weight:500; }
  .num{ font-variant-numeric:tabular-nums; }
  .cap-hair{ font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.14em; font-size:10.5px; color:var(--ink); padding-bottom:8px; border-bottom:1px solid var(--hair); margin-bottom:12px; display:block; }
  .cap-mute{ font-family:var(--cond); font-weight:400; text-transform:uppercase; letter-spacing:0.12em; font-size:10.5px; color:var(--mute); }

  .doc-hd{ display:flex; align-items:baseline; justify-content:space-between; padding-bottom:10px; border-bottom:1px solid var(--ink); }
  .doc-hd .brand{ font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.14em; font-size:11px; color:var(--ink); }
  .doc-hd .brand span{ color:var(--teal-deep); }
  .doc-hd .meta{ font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.14em; font-size:10.5px; color:var(--mute); }
  .eyebrow-rule{ width:32px; height:3px; background:var(--red); margin-top:24px; }
  .eyebrow-cap{ font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.14em; font-size:10.5px; color:var(--ink); margin-top:10px; }

  .headline{ font-family:var(--serif); font-weight:500; font-size:32px; line-height:1.15; color:var(--ink); margin-top:14px; max-width:640px; }
  .hero-row{ display:flex; align-items:flex-end; gap:32px; margin-top:28px; padding-bottom:22px; border-bottom:1px solid var(--hair); }
  .hero-fig{ font-family:var(--serif); font-weight:500; font-size:82px; line-height:0.95; color:var(--teal-deep); letter-spacing:-0.01em; }
  .hero-cap{ font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.14em; font-size:10.5px; color:var(--mute); max-width:280px; line-height:1.45; padding-bottom:10px; }

  .stat-strip{ display:grid; grid-template-columns:repeat(4, 1fr); border-bottom:1px solid var(--hair); }
  .stat-cell{ padding:14px 0 16px; padding-right:20px; border-right:1px solid var(--hair-soft); }
  .stat-cell:last-child{ border-right:none; padding-right:0; }
  .stat-cell:not(:first-child){ padding-left:20px; }
  .stat-lbl{ font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.14em; font-size:9.5px; color:var(--mute); }
  .stat-val{ font-family:var(--serif); font-weight:500; font-size:22px; color:var(--ink); margin-top:4px; letter-spacing:-0.005em; }
  .stat-val.teal{ color:var(--teal-deep); }
  .stat-val.mute{ color:var(--mute); }
  .stat-val.neg{ color:var(--red); }

  .chart-block{ padding:20px 0 16px; border-bottom:1px solid var(--hair); }
  .chart-hd{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:12px; }
  .chart-hd .lbl{ font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.14em; font-size:10.5px; color:var(--ink); }
  .chart-hd .end{ font-family:var(--serif); font-weight:500; font-size:16px; color:var(--teal-deep); }
  .chart-hd .end .cap-mute{ margin-left:8px; }
  #nav-chart{ width:100%; display:block; }
  .chart-x{ display:flex; justify-content:space-between; margin-top:4px; padding:0 2px; }
  .chart-x span{ font-family:var(--cond); font-weight:400; font-size:9.5px; color:var(--mute); letter-spacing:0.06em; }

  .bottom-cols{ display:grid; grid-template-columns:1fr 1fr; gap:32px; padding-top:18px; flex:1; }
  .mandate-line{ font-family:var(--serif); font-weight:400; font-size:14.5px; line-height:1.45; padding:10px 0; border-bottom:1px solid var(--hair-soft); color:var(--ink); }
  .mandate-line:first-of-type{ padding-top:6px; }
  .mandate-line:last-of-type{ border-bottom:none; }
  .mandate-num{ font-family:var(--cond); font-weight:500; color:var(--teal-deep); margin-right:10px; font-size:12px; }

  .alloc-row{ padding:10px 0; border-bottom:1px solid var(--hair-soft); }
  .alloc-row:last-child{ border-bottom:none; }
  .alloc-nm{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  .alloc-nm .fn{ font-family:var(--serif); font-weight:400; font-size:12.5px; color:var(--ink); }
  .alloc-nm .pct{ font-family:var(--serif); font-weight:500; font-size:14px; color:var(--teal-deep); }
  .alloc-isin{ font-family:var(--cond); font-weight:400; font-size:9.5px; color:var(--mute); letter-spacing:0.08em; margin-top:2px; }
  .alloc-bar{ margin-top:8px; height:8px; background:var(--hair-soft); position:relative; }
  .alloc-bar .fill{ position:absolute; top:0; left:0; bottom:0; background:var(--teal-bright); }

  .foot{ margin-top:auto; padding-top:14px; border-top:1px solid var(--hair); display:flex; justify-content:space-between; align-items:baseline; }
  .foot .disc{ font-family:var(--sans); font-weight:400; font-size:9px; color:var(--mute); line-height:1.5; max-width:560px; }
  .foot .pg{ font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.14em; font-size:9.5px; color:var(--mute); }

  .back-title{ display:flex; align-items:baseline; justify-content:space-between; padding:24px 0 16px; border-bottom:1px solid var(--hair); }
  .back-title .nm{ font-family:var(--serif); font-weight:500; font-size:30px; color:var(--teal-deep); letter-spacing:-0.01em; }
  .back-title .cum{ font-family:var(--serif); font-weight:500; font-size:22px; color:var(--teal-bright); letter-spacing:-0.005em; }
  .back-title .cum-cap{ font-family:var(--cond); font-weight:400; text-transform:uppercase; letter-spacing:0.14em; font-size:9.5px; color:var(--mute); display:block; text-align:right; margin-bottom:2px; }

  .back-cols{ display:grid; grid-template-columns:260px 1fr; gap:36px; padding-top:20px; flex:1; }
  .kv-row{ display:flex; justify-content:space-between; align-items:baseline; padding:8px 0; border-bottom:1px solid var(--hair-soft); font-size:12px; }
  .kv-row:last-child{ border-bottom:none; }
  .kv-row .k{ color:var(--mute); font-family:var(--cond); text-transform:uppercase; letter-spacing:0.1em; font-size:10px; font-weight:500; }
  .kv-row .v{ color:var(--ink); font-family:var(--sans); font-weight:500; font-size:12px; }

  .block{ margin-bottom:22px; } .block:last-child{ margin-bottom:0; }
  .prose{ font-family:var(--serif); font-weight:400; font-size:12.5px; line-height:1.55; color:var(--ink); }
  .prose p + p{ margin-top:8px; }

  .grid-rows{ display:grid; grid-template-columns:1fr; gap:6px; }
  .grid-row{ display:grid; grid-template-columns:130px 1fr 42px; align-items:center; gap:10px; }
  .grid-row .lbl{ font-family:var(--sans); font-weight:500; font-size:11px; color:var(--ink); }
  .grid-row .track{ height:8px; background:var(--hair-soft); position:relative; }
  .grid-row .track .fill{ position:absolute; inset:0 auto 0 0; background:var(--teal-bright); }
  .grid-row .val{ font-family:var(--cond); font-weight:500; font-size:11px; color:var(--ink); text-align:right; font-variant-numeric:tabular-nums; }

  .holdings-hdr{ display:grid; grid-template-columns:26px 1fr 60px 50px; padding:6px 0 6px; border-bottom:1px solid var(--hair); font-family:var(--cond); font-weight:500; text-transform:uppercase; letter-spacing:0.1em; font-size:9.5px; color:var(--mute); }
  .holdings-row{ display:grid; grid-template-columns:26px 1fr 60px 50px; padding:7px 0; border-bottom:1px solid var(--hair-soft); font-size:11.5px; align-items:baseline; }
  .holdings-row .rk{ font-family:var(--cond); font-weight:500; color:var(--mute); font-size:10.5px; }
  .holdings-row .nm{ font-family:var(--sans); font-weight:500; color:var(--ink); }
  .holdings-row .sc{ font-family:var(--cond); font-weight:400; color:var(--mute); font-size:10.5px; letter-spacing:0.06em; }
  .holdings-row .wt{ font-family:var(--cond); font-weight:500; color:var(--ink); text-align:right; font-variant-numeric:tabular-nums; }
</style>
</head>
<body>

<section class="page" aria-label="Fact sheet page 1 of 2">
  <div class="doc-hd">
    <div class="brand">${esc(portfolio.provider_name.toUpperCase())} <span>${esc(categoryLabel.toUpperCase())}</span></div>
    <div class="meta">PORTFOLIO FACT SHEET · ${esc(asOfMonthUpper)}</div>
  </div>

  <div class="eyebrow-rule"></div>
  <div class="eyebrow-cap">Discretionary Portfolio Service · Singapore</div>

  <h1 class="headline">
    ${esc(portfolio.name)} — a ${esc(categoryLabel.toLowerCase())} mandate held through <em>full market cycles</em>.
  </h1>

  <div class="hero-row">
    <div class="hero-fig num">${fmtPct(heroPct, 1, false)}</div>
    <div class="hero-cap">
      ${esc(heroWindow)} return<br>
      Look-through composite · SGD · gross of DPS fee
    </div>
  </div>

  <div class="stat-strip">
    <div class="stat-cell">
      <div class="stat-lbl">YTD</div>
      <div class="stat-val num ${weightedYtd == null ? "mute" : weightedYtd >= 0 ? "teal" : "neg"}">${fmtPct(weightedYtd, 1)}</div>
    </div>
    <div class="stat-cell">
      <div class="stat-lbl">1 Year</div>
      <div class="stat-val num ${xray?.r1y == null ? "mute" : xray.r1y >= 0 ? "teal" : "neg"}">${fmtPct(xray?.r1y ?? null, 1)}</div>
    </div>
    <div class="stat-cell">
      <div class="stat-lbl">3 Years p.a.</div>
      <div class="stat-val num ${xray?.r3y == null ? "mute" : xray.r3y >= 0 ? "teal" : "neg"}">${fmtPct(xray?.r3y ?? null, 1)}</div>
    </div>
    <div class="stat-cell">
      <div class="stat-lbl">5 Years p.a.</div>
      <div class="stat-val num ${xray?.r5y == null ? "mute" : xray.r5y >= 0 ? "teal" : "neg"}">${fmtPct(xray?.r5y ?? null, 1)}</div>
    </div>
  </div>

  <div class="chart-block">
    <div class="chart-hd">
      <div class="lbl">S$100,000 invested at ${rebased ? esc(shortMonth(rebased.startIso)) : "start"}</div>
      <div class="end">${rebased ? `<span class="num">${esc(fmtSgd(rebased.end))}</span><span class="cap-mute">end value · ${esc(shortMonth(rebased.endIso))}</span>` : "<span class=\"cap-mute\">series unavailable</span>"}</div>
    </div>
    ${rebased ? `
    <svg id="nav-chart" viewBox="0 0 700 200" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#EBEBEC" stroke-width="1">
        <line x1="0" y1="200" x2="700" y2="200"/>
        <line x1="0" y1="150" x2="700" y2="150"/>
        <line x1="0" y1="100" x2="700" y2="100"/>
        <line x1="0" y1="50"  x2="700" y2="50"/>
        <line x1="0" y1="0"   x2="700" y2="0"/>
      </g>
      <path d="${rebased.areaPath}" fill="#00B4BE" fill-opacity="0.14" stroke="none"/>
      <path d="${rebased.path}" fill="none" stroke="#00B4BE" stroke-width="1.4"/>
      <g font-family="Archivo Narrow, Arial Narrow, sans-serif" font-size="9" fill="#838483" font-weight="400">
        <text x="700" y="8"   text-anchor="end">${esc(fmtSgd(rebased.yMax))}</text>
        <text x="700" y="103" text-anchor="end">${esc(fmtSgd((rebased.yMax + rebased.yMin) / 2))}</text>
        <text x="700" y="198" text-anchor="end">${esc(fmtSgd(rebased.yMin))}</text>
      </g>
    </svg>
    <div class="chart-x">
      ${yearTicks.map((y) => `<span>${y}</span>`).join("")}
    </div>` : ""}
  </div>

  <div class="bottom-cols">
    <div>
      <span class="cap-hair">The mandate</span>
      ${MANDATE_LINES.map((line, i) => `<div class="mandate-line"><span class="mandate-num num">${String(i + 1).padStart(2, "0")}</span>${line}</div>`).join("")}
    </div>
    <div>
      <span class="cap-hair">Fund allocation</span>
      ${renderAllocation(holdings, totalBps)}
    </div>
  </div>

  <div class="foot">
    <div class="disc">
      Past performance is no guarantee of future results. This document is issued by ${esc(portfolio.provider_name)} for use with accredited investors in Singapore. Not an offer or solicitation. Returns are look-through composite figures, in SGD, with dividends reinvested; the ${esc(heroWindow.toLowerCase())} figure precedes DPS-level fees. Data source: Morningstar; fund managers.
    </div>
    <div class="pg">Page 1 of 2</div>
  </div>
</section>

<section class="page" aria-label="Fact sheet page 2 of 2">
  <div class="doc-hd">
    <div class="brand">${esc(portfolio.provider_name.toUpperCase())} <span>${esc(categoryLabel.toUpperCase())}</span></div>
    <div class="meta">PORTFOLIO FACT SHEET · ${esc(asOfMonthUpper)}</div>
  </div>

  <div class="back-title">
    <div class="nm">${esc(portfolio.name)}</div>
    <div>
      <div class="cum-cap">Cumulative return since ${rebased ? esc(shortMonth(rebased.startIso)) : "start"}</div>
      <div class="cum num">${cumulativeSinceStart != null ? fmtPct(cumulativeSinceStart, 1) : "—"}</div>
    </div>
  </div>

  <div class="back-cols">
    <div>
      <div class="block">
        <span class="cap-hair">Portfolio details</span>
        <div class="kv-row"><span class="k">Base currency</span><span class="v">SGD</span></div>
        <div class="kv-row"><span class="k">Platform</span><span class="v">${esc(portfolio.provider_name)}</span></div>
        <div class="kv-row"><span class="k">Category</span><span class="v">${esc(categoryLabel)}</span></div>
        <div class="kv-row"><span class="k">Confirmed</span><span class="v">${esc(portfolio.confirmed_at?.slice(0, 10) ?? "—")}</span></div>
        <div class="kv-row"><span class="k">Version</span><span class="v num">v${portfolio.version}</span></div>
        <div class="kv-row"><span class="k">Weighted expense</span><span class="v num">${weightedExpense > 0 ? weightedExpense.toFixed(2) + "% p.a." : "—"}</span></div>
        <div class="kv-row"><span class="k">Rebalance</span><span class="v">Quarterly · ±5%</span></div>
      </div>

      <div class="block">
        <span class="cap-hair">Risk</span>
        <div class="kv-row"><span class="k">SRRI</span><span class="v num">${xray?.risk != null ? xray.risk + " / 5" : "—"}</span></div>
        <div class="kv-row"><span class="k">Volatility (3Y)</span><span class="v num">${weightedStddev3y ? weightedStddev3y.toFixed(1) + "%" : "—"}</span></div>
        <div class="kv-row"><span class="k">Equity coverage</span><span class="v num">${xray?.equityCoverage != null ? (xray.equityCoverage * 100).toFixed(1) + "%" : "—"}</span></div>
        <div class="kv-row"><span class="k">Holdings</span><span class="v num">${holdings.length} funds</span></div>
      </div>

      <div class="block">
        <span class="cap-hair">How the portfolio is run</span>
        <div class="prose">
          <p>${holdings.length} funds, one decision — hold to policy weights and rebalance when drift exceeds five percentage points.</p>
          ${portfolio.notes ? `<p>${esc(portfolio.notes)}</p>` : `<p>Sleeve construction and share-class selection are set at portfolio confirmation and revisited on the same cadence as the mandate itself, not to market moves.</p>`}
        </div>
      </div>
    </div>

    <div>
      <div class="block">
        <span class="cap-hair">Top 10 holdings — look-through</span>
        <div class="holdings-hdr">
          <div>#</div><div>Holding</div><div>Sector</div><div style="text-align:right">Weight</div>
        </div>
        ${renderHoldingsLookThrough(xray?.holdings)}
      </div>

      <div class="block">
        <span class="cap-hair">Sector breakdown</span>
        <div class="grid-rows">${renderBarRows(xray?.sector)}</div>
      </div>

      <div class="block">
        <span class="cap-hair">Geographic breakdown</span>
        <div class="grid-rows">${renderBarRows(xray?.geo)}</div>
      </div>
    </div>
  </div>

  <div class="foot">
    <div class="disc">
      Past performance is no guarantee of future results. Holdings, sector and geographic exposures are look-through, computed from underlying funds' most recent published portfolios weighted by target allocation. Data source: Morningstar; fund managers.
    </div>
    <div class="pg">Page 2 of 2</div>
  </div>
</section>

</body>
</html>`;
}

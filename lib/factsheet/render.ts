import type {
  ConfirmedPortfolio,
  ConfirmedPortfolioHolding,
} from "@/lib/db/queries";
import type { PortfolioXray } from "@/lib/portfolio-derive";
import type { BlendedSeries } from "@/lib/portfolio-performance";
import type { TrailingReturns } from "./build";

/**
 * Owns the Global Alpha fact-sheet template. Matches the exact CSS
 * (spacing, sizes, weights, colours) from the reference "GWM Global Alpha
 * Fact Sheet (standalone)" HTML the user supplied — every portfolio's
 * fact sheet uses this shell; only the injected values differ.
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

// Five mandate lines per the reference template — italic emphasis stripped
// so the plain-serif reading matches the reference (no <em> in the source).
const MANDATE_LINES = [
  "We own proven businesses, anywhere in the world.",
  "We favour smaller, profitable companies bought at sensible prices.",
  "We respect market and credit cycles.",
  "We do not trade to look busy.",
  "Returns come from staying invested.",
];

export type FactsheetInput = {
  portfolio: ConfirmedPortfolio;
  holdings: ConfirmedPortfolioHolding[];
  xray: PortfolioXray | null;
  series: BlendedSeries;
  /** Freshly-computed weighted trailing returns with proxy-fund fallback. */
  returns: TrailingReturns;
  asOfMonth: Date;
};

// ─── Helpers ────────────────────────────────────────────────────
function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtPct(v: number | null | undefined, places = 1, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = signed ? (v >= 0 ? "+" : "−") : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(places)}%`;
}

// Match the reference footer date shape: "30 JUNE 2026".
function fmtLastDayOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const day = last.getDate();
  const month = last.toLocaleString("en-SG", { month: "long" }).toUpperCase();
  return `${day} ${month} ${last.getFullYear()}`;
}

// Same shape but for the hero caption ("TO 30 JUN 2026").
function fmtLastDayShort(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const day = last.getDate();
  const month = last.toLocaleString("en-SG", { month: "short" }).toUpperCase();
  return `${day} ${month} ${last.getFullYear()}`;
}

function firstMonthLabel(iso: string): string {
  const [y, m] = iso.split("-").map((s) => parseInt(s, 10));
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return d.toLocaleString("en-SG", { month: "short" }).toUpperCase() + " " + y;
}

function lastMonthLabel(iso: string): string {
  return firstMonthLabel(iso);
}

function yearsBetween(startIso: string, endIso: string): number[] {
  const s = parseInt(startIso.slice(0, 4), 10);
  const e = parseInt(endIso.slice(0, 4), 10);
  const out: number[] = [];
  for (let y = s + 1; y <= e; y++) out.push(y);
  return out;
}

// ─── Chart geometry ─────────────────────────────────────────────
// Emit a filled polygon in a viewBox 0 0 700 240, rebased to 100 at the
// first point. Matches the reference structure exactly.
function seriesPolygon(series: BlendedSeries): { polygon: string; startIso: string; endIso: string; terminal: number } | null {
  if (!series || series.points.length < 2) return null;
  const base = series.points[0].v;
  const rebased = series.points.map((p) => (p.v / base) * 100);
  const min = Math.min(...rebased) * 0.99;
  const max = Math.max(...rebased) * 1.005;
  const W = 700, H = 240;
  const n = rebased.length;
  let pts = "";
  for (let j = 0; j < n; j++) {
    const x = (j * W) / (n - 1);
    const y = H - ((rebased[j] - min) / (max - min)) * (H - 8) - 4;
    pts += x.toFixed(1) + "," + y.toFixed(1) + " ";
  }
  pts += `${W},${H} 0,${H}`;
  return {
    polygon: pts,
    startIso: series.start,
    endIso: series.end,
    terminal: rebased[rebased.length - 1],
  };
}

// ─── Annual returns from series ─────────────────────────────────
type AnnualReturn = { year: number; return_pct: number; is_partial: boolean };

function computeAnnualReturnsFromSeries(series: BlendedSeries): AnnualReturn[] {
  if (!series || series.points.length < 2) return [];
  const yearEnd = new Map<number, { d: string; v: number }>();
  for (const p of series.points) yearEnd.set(parseInt(p.d.slice(0, 4), 10), p);
  const years = [...yearEnd.keys()].sort((a, b) => a - b);
  const out: AnnualReturn[] = [];
  for (let i = 1; i < years.length; i++) {
    const y = years[i];
    const end = yearEnd.get(y)!;
    const start = yearEnd.get(years[i - 1])!;
    const is_partial = end.d.slice(5, 7) !== "12";
    out.push({ year: y, return_pct: (end.v / start.v - 1) * 100, is_partial });
  }
  return out;
}

// Render one bar row (label · track · value) in the sector/geo grids.
function renderBarRow(label: string, value: number, maxPct: number, colour: string): string {
  const width = maxPct > 0 ? Math.round((value / maxPct) * 100) : 0;
  return `<div class="bar-row"><span>${esc(label)}</span><div class="track"><div class="fill" style="width:${width}%;background:${colour};"></div></div><span>${value.toFixed(1)}</span></div>`;
}

// ─── Main render ────────────────────────────────────────────────
export function renderFactsheetHtml(input: FactsheetInput): string {
  const { portfolio, holdings, xray, series, returns, asOfMonth } = input;
  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;

  const chart = seriesPolygon(series);
  const annual = computeAnnualReturnsFromSeries(series);
  const fullYearAnnual = annual.filter((a) => !a.is_partial);
  const worstFullYear = fullYearAnnual.length
    ? fullYearAnnual.reduce((a, b) => (a.return_pct < b.return_pct ? a : b))
    : null;
  const cumulativeSinceStart = chart ? chart.terminal - 100 : null;

  const heroPct = returns.ann_10y ?? returns.ann_5y ?? returns.ann_3y ?? returns.ann_1y ?? null;
  const heroWindow = returns.ann_10y != null ? "10-YEAR" : returns.ann_5y != null ? "5-YEAR" : returns.ann_3y != null ? "3-YEAR" : "1-YEAR";

  const asOfLong = fmtLastDayOfMonth(asOfMonth);
  const asOfShort = fmtLastDayShort(asOfMonth);
  const categoryLabel = CATEGORY_LABEL[portfolio.category] ?? portfolio.category;

  const weightedExpense = holdings.reduce((s, h) => (h.expense_ratio == null ? s : s + (h.weight_bps / totalBps) * h.expense_ratio), 0);

  const chartYears = chart ? yearsBetween(chart.startIso, chart.endIso) : [];

  // Fund allocation rows.
  const allocRows = holdings.map((h) => {
    const pct = (h.weight_bps / totalBps) * 100;
    const barW = Math.max(2, pct);
    const isinCurrency = `${h.isin ?? "—"}${h.currency ? " · " + h.currency : ""}${(h.name ?? "").toLowerCase().includes("hedg") ? ", Hedged" : ""}`;
    return `
      <div style="padding:5px 0 6px;border-bottom:1px solid #EBEBEC;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
          <span style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(h.name)}</span>
          <span class="serif" style="font-size:13px;color:#00818B;">${Math.round(pct)}%</span>
        </div>
        <div class="cond" style="font-size:9px;letter-spacing:0.05em;color:#838483;margin-top:1px;">${esc(isinCurrency)}</div>
        <div class="track" style="height:6px;margin-top:4px;"><div class="fill" style="height:6px;width:${barW.toFixed(1)}%;"></div></div>
      </div>`;
  }).join("");

  // Annual bars — split positive/negative around a hairline divider.
  const ANNUAL_SLOTS = 10;
  const filledAnnual: (AnnualReturn | null)[] = [];
  for (let i = 0; i < Math.max(ANNUAL_SLOTS - annual.length, 0); i++) filledAnnual.push(null);
  for (const a of annual.slice(-ANNUAL_SLOTS)) filledAnnual.push(a);
  const maxAbs = Math.max(...annual.map((a) => Math.abs(a.return_pct)), 1);
  const posH = 80, negH = 48;
  const valsHtml = filledAnnual.map((a) => a == null ? "<span></span>" : `<span style="color:${a.return_pct < 0 ? "#E20C10" : "#141614"};">${a.return_pct < 0 ? "−" : "+"}${Math.abs(a.return_pct).toFixed(1)}</span>`).join("");
  const posHtml = filledAnnual.map((a) => a == null ? '<div style="width:100%;height:0;"></div>' : `<div style="width:100%;background:#00B4BE;height:${a.return_pct > 0 ? Math.round((a.return_pct / maxAbs) * posH) : 0}px;"></div>`).join("");
  const negHtml = filledAnnual.map((a) => a == null ? '<div style="width:100%;height:0;"></div>' : `<div style="width:100%;background:#E20C10;height:${a.return_pct < 0 ? Math.round((Math.abs(a.return_pct) / maxAbs) * posH) : 0}px;"></div>`).join("");
  const yearsHtml = filledAnnual.map((a) => a == null ? "<span></span>" : `<span>${a.is_partial ? "YTD" : "'" + (a.year % 100).toString().padStart(2, "0")}</span>`).join("");

  // Top-10 look-through — from xray.
  const topHoldings = (xray?.holdings ?? []).slice(0, 10);
  const topHoldingsHtml = topHoldings.length > 0
    ? topHoldings.map((h) => `<div class="kv"><span>${esc(h.label)}</span><span>${h.weight_pct.toFixed(2)}</span></div>`).join("")
    : `<div class="kv"><span style="color:#838483;">Not yet published.</span><span></span></div>`;

  // Sector / geo bar grids — bright teal for sectors, deep teal for geo.
  const sectorMax = xray?.sector?.[0]?.weight_pct ?? 1;
  const geoMax = xray?.geo?.[0]?.weight_pct ?? 1;
  const sectorHtml = (xray?.sector ?? []).slice(0, 11).map((s) => renderBarRow(s.label, s.weight_pct, sectorMax, "#00B4BE")).join("") || `<span style="font-size:10px;color:#838483;">Not yet published.</span>`;
  const geoHtml = (xray?.geo ?? []).slice(0, 11).map((g) => renderBarRow(g.label, g.weight_pct, geoMax, "#00818B")).join("") || `<span style="font-size:10px;color:#838483;">Not yet published.</span>`;

  // Brand label at header — portfolio name in ALL CAPS.
  const brandLabel = portfolio.name.toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(portfolio.name)} — Portfolio Fact Sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Bitter:wght@400;500;600;700&family=Nunito+Sans:wght@400;600;700&display=swap">
<style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box;}
  body{margin:0;font-family:'Nunito Sans',Helvetica,sans-serif;color:#141614;background:#faf9f5;padding:32px 0;}
  .page{width:776px;margin:0 auto 24px;padding:48px 56px;display:flex;flex-direction:column;background:#FFFFFF;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 4px 12px rgba(0,0,0,0.05);}
  .page:last-of-type{margin-bottom:0;}
  .cond{font-family:'Archivo Narrow',Arial,sans-serif;}
  .serif{font-family:'Bitter',Georgia,serif;font-weight:500;}
  .hdr{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #D9DAD9;padding-bottom:13px;}
  .brand{font-family:'Archivo Narrow',Arial,sans-serif;font-weight:600;font-size:16px;letter-spacing:0.14em;}
  .meta{font-family:'Archivo Narrow',Arial,sans-serif;font-size:11px;letter-spacing:0.1em;color:#545553;white-space:nowrap;}
  .lbl{font-family:'Archivo Narrow',Arial,sans-serif;font-size:11px;letter-spacing:0.1em;color:#545553;border-bottom:1px solid #A4A4A3;padding-bottom:6px;}
  .kv{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #EBEBEC;font-size:12px;}
  .kv span:first-child{color:#545553;white-space:nowrap;}
  .kv span:last-child{font-family:'Archivo Narrow',Arial,sans-serif;font-weight:600;white-space:nowrap;}
  .bar-row{display:grid;grid-template-columns:104px 1fr 30px;align-items:center;gap:7px;font-family:'Archivo Narrow',Arial,sans-serif;font-size:10.5px;}
  .bar-row span:first-child{color:#545553;white-space:nowrap;}
  .bar-row span:last-child{text-align:right;font-weight:600;}
  .track{height:9px;background:#EBEBEC;}
  .fill{height:9px;background:#00B4BE;}
  .foot{margin-top:auto;border-top:1px solid #D9DAD9;padding-top:9px;font-size:9px;line-height:1.5;color:#838483;}
  /* Letter with a 20px safety margin — the 776px section sits centred on
     the 776px content column that leaves, so proportions match on-screen
     exactly. Chrome / Safari / Firefox all respect this and drop their
     own default margins. */
  @page{size:letter;margin:20px;}
  @media print{
    body{background:#FFFFFF;padding:0;}
    /* Keep margin:0 auto so the section centres on the printed page.
       Without this override the browser would strip the auto and hard-
       left-align. */
    .page{margin:0 auto;box-shadow:none;page-break-after:always;min-height:auto;}
    .page:last-of-type{page-break-after:auto;}
  }
</style>
</head>
<body>

<section class="page" id="p1">
  <div class="hdr"><div class="brand">${esc(brandLabel)}</div><div class="meta">PORTFOLIO FACT SHEET · ${esc(asOfLong)}</div></div>

  <div style="margin-top:32px;">
    <div style="width:32px;height:3px;background:#E20C10;"></div>
    <div class="cond" style="font-size:11px;letter-spacing:0.12em;color:#E20C10;margin-top:8px;">${esc(portfolio.name.toUpperCase())} · MODEL PORTFOLIO · SINGAPORE</div>
    <h1 class="serif" style="font-size:31px;line-height:1.12;margin:11px 0 0;max-width:540px;">${portfolio.category === "dividend_income" ? "Generating income with a <em>peace of mind</em>." : "Returns come from <em>staying invested</em>."}</h1>
  </div>

  <div style="display:flex;align-items:flex-end;gap:32px;margin-top:30px;">
    <div>
      <div class="serif" style="font-size:72px;line-height:1;color:#00818B;letter-spacing:-0.01em;">${fmtPct(heroPct, 1, false)}</div>
      <div class="cond" style="font-size:11px;letter-spacing:0.1em;color:#545553;margin-top:8px;white-space:nowrap;">${heroWindow} ANNUALISED TOTAL RETURN · TO ${esc(asOfShort)}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);flex:1;border-left:1px solid #D9DAD9;">
      <div style="padding:0 0 4px 18px;"><div class="serif" style="font-size:21px;${returns.ann_1y != null && returns.ann_1y < 0 ? "color:#E20C10;" : ""}">${fmtPct(returns.ann_1y)}</div><div class="cond" style="font-size:10px;letter-spacing:0.08em;color:#838483;margin-top:3px;white-space:nowrap;">1 YEAR</div></div>
      <div style="padding:0 0 4px 18px;"><div class="serif" style="font-size:21px;${returns.ann_3y != null && returns.ann_3y < 0 ? "color:#E20C10;" : ""}">${fmtPct(returns.ann_3y)}</div><div class="cond" style="font-size:10px;letter-spacing:0.08em;color:#838483;margin-top:3px;white-space:nowrap;">3 YR P.A.</div></div>
      <div style="padding:0 0 4px 18px;"><div class="serif" style="font-size:21px;${returns.ann_5y != null && returns.ann_5y < 0 ? "color:#E20C10;" : ""}">${fmtPct(returns.ann_5y)}</div><div class="cond" style="font-size:10px;letter-spacing:0.08em;color:#838483;margin-top:3px;white-space:nowrap;">5 YR P.A.</div></div>
      <div style="padding:0 0 4px 18px;"><div class="serif" style="font-size:21px;${worstFullYear && worstFullYear.return_pct < 0 ? "color:#E20C10;" : ""}">${worstFullYear ? (worstFullYear.return_pct < 0 ? "−" : "+") + Math.abs(worstFullYear.return_pct).toFixed(1) + "%" : "—"}</div><div class="cond" style="font-size:10px;letter-spacing:0.08em;color:#838483;margin-top:3px;white-space:nowrap;">WORST YEAR</div></div>
    </div>
  </div>

  <div style="margin-top:32px;border-top:1px solid #D9DAD9;padding-top:15px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;">
      <div class="cond" style="font-size:11px;letter-spacing:0.1em;color:#545553;white-space:nowrap;">GROWTH OF 100 · MONTHLY CLOSING NAV · NET OF OCF · ${chart ? esc(firstMonthLabel(chart.startIso)) + " – " + esc(lastMonthLabel(chart.endIso)) : "—"}</div>
      <div class="cond" style="font-size:12px;color:#00818B;font-weight:600;">${chart ? chart.terminal.toFixed(1) : "—"}</div>
    </div>
    <svg viewBox="0 0 700 240" style="width:100%;height:200px;display:block;margin-top:12px;" preserveAspectRatio="none">
      <line x1="0" y1="60" x2="700" y2="60" stroke="#EBEBEC" stroke-width="1"></line>
      <line x1="0" y1="120" x2="700" y2="120" stroke="#EBEBEC" stroke-width="1"></line>
      <line x1="0" y1="180" x2="700" y2="180" stroke="#EBEBEC" stroke-width="1"></line>
      ${chart ? `<polygon points="${chart.polygon}" fill="#00B4BE"></polygon>` : ""}
    </svg>
    <div class="cond" style="display:flex;justify-content:space-between;font-size:10px;color:#838483;margin-top:4px;">
      ${chartYears.map((y) => `<span>${y}</span>`).join("")}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 44px;margin-top:32px;">
    <div>
      <div class="lbl">THE MANDATE</div>
      ${MANDATE_LINES.map((m) => `<div class="serif" style="font-size:11.5px;line-height:1.45;padding:7px 0;border-bottom:1px solid #EBEBEC;">${m}</div>`).join("")}
    </div>
    <div>
      <div class="lbl">FUND ALLOCATION</div>
      ${allocRows}
    </div>
  </div>

  <div class="foot">For illustration only. Not reviewed by the Monetary Authority of Singapore; not financial advice or an offer of any investment product. Model portfolio returns in SGD, net of fund-level costs, and do not represent any actual client account. Past performance is not indicative of future results. All investments carry risk, including loss of principal. Consult a licensed financial adviser before investing. Page 1 of 2.</div>
</section>

<section class="page" id="p2">
  <div class="hdr" style="border-bottom:none;padding-bottom:0;"><div class="brand">${esc(brandLabel)}</div><div class="meta">PORTFOLIO FACT SHEET · ${esc(asOfLong)}</div></div>

  <div style="border-top:1px solid #141614;margin-top:12px;padding-top:24px;display:flex;justify-content:space-between;align-items:flex-end;">
    <div>
      <h1 class="serif" style="font-size:28px;color:#00818B;margin:0;line-height:1.1;">${esc(portfolio.name)}</h1>
      <div style="font-size:13px;color:#545553;margin-top:6px;">Model portfolio · SGD · For illustration purposes only</div>
    </div>
    <div style="text-align:right;">
      <div class="serif" style="font-size:34px;color:#00B4BE;line-height:1;">${cumulativeSinceStart != null ? fmtPct(cumulativeSinceStart) : "—"}</div>
      <div class="cond" style="font-size:10px;letter-spacing:0.08em;color:#838483;margin-top:4px;white-space:nowrap;">CUMULATIVE TOTAL RETURN · ${chart ? esc(firstMonthLabel(chart.startIso)) + " – " + esc(lastMonthLabel(chart.endIso)) : "—"}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:290px 1fr;gap:48px 52px;margin-top:44px;flex:1;align-content:start;">
    <div>
      <div class="lbl">PORTFOLIO DETAILS</div>
      <div class="kv"><span>Base currency</span><span>SGD</span></div>
      <div class="kv"><span>Underlying funds</span><span>${holdings.length}</span></div>
      <div class="kv"><span>Dealing</span><span>Daily</span></div>
      <div class="kv"><span>Initial sum</span><span>S$50,000</span></div>
      <div class="kv"><span>Regular subscription</span><span>S$1,000</span></div>
      <div class="kv"><span>Sales charge</span><span>Up to 5%</span></div>
      <div class="kv"><span>Blended OCF</span><span>${weightedExpense > 0 ? weightedExpense.toFixed(3) + "% p.a." : "—"}</span></div>
      <div class="kv"><span>Custody</span><span>Client-named accounts</span></div>
    </div>
    <div>
      <div class="lbl">TOP 10 LOOK-THROUGH HOLDINGS (%) · SLEEVE-WEIGHTED</div>
      ${topHoldingsHtml}
    </div>
    <div>
      <div class="lbl">ANNUAL TOTAL RETURNS (%)</div>
      <div id="ann-vals" class="cond" style="display:grid;grid-template-columns:repeat(10,1fr);text-align:center;font-size:8.5px;font-weight:600;margin-top:12px;">${valsHtml}</div>
      <div id="ann-pos" style="display:grid;grid-template-columns:repeat(10,1fr);gap:5px;align-items:end;margin-top:4px;height:${posH}px;">${posHtml}</div>
      <div id="ann-neg" style="display:grid;grid-template-columns:repeat(10,1fr);gap:5px;align-items:start;border-top:1px solid #A4A4A3;height:${negH}px;">${negHtml}</div>
      <div id="ann-yrs" class="cond" style="display:grid;grid-template-columns:repeat(10,1fr);text-align:center;font-size:8.5px;color:#838483;">${yearsHtml}</div>
      <div style="font-size:8.5px;color:#838483;margin-top:6px;">Total returns per annum, net of OCF, in SGD. YTD to ${esc(asOfShort)}.</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 26px;">
      <div>
        <div class="lbl">SECTOR ALLOCATION (%)</div>
        <div id="sectors" style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">${sectorHtml}</div>
      </div>
      <div>
        <div class="lbl">GEOGRAPHIC ALLOCATION (%)</div>
        <div id="geo" style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">${geoHtml}</div>
      </div>
    </div>
  </div>

  <div class="foot">For illustration only. Not reviewed by the Monetary Authority of Singapore; not financial advice or a recommendation to buy or sell any security. Holdings, sector, and geographic figures are sleeve-weighted look-through weights as of ${esc(asOfShort)}. Past performance is not indicative of future results; all investments carry risk, including loss of principal. Consult a licensed financial adviser before investing. Page 2 of 2.</div>
</section>

</body>
</html>`;
}

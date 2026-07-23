// Shared entry point that turns a portfolioId (+ target month) into the
// finished fact-sheet HTML. Used by both the on-demand route and the
// monthly cron.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { getConfirmedPortfolio, getPortfolioHoldings, type ConfirmedPortfolio, type ConfirmedPortfolioHolding } from "@/lib/db/queries";
import { parseXray } from "@/lib/portfolio-derive";
import { computeLiveXrayExtras } from "@/lib/portfolio-xray-live";
import { blendPortfolioSeries, fetchSnapshot } from "@/lib/portfolio-performance";
import { loadProxies as loadReturnProxies, spliceProxyPrefix, type SeriesPoint as SplicePoint } from "@/lib/return-proxy-splice";
import { renderFactsheetHtml } from "./render";

type SeriesPoint = SplicePoint;

/**
 * Synthesise a monthly growth-of-100 series over the last 120 months from a
 * fund's trailing annualised returns. Used when Morningstar's GrowthOf10K
 * comes back empty (MAS-coded SG funds) so the fund still contributes to the
 * fact-sheet chart at its real weight.
 *
 * Anchors NAV at t=0, -12M, -36M, -60M, -120M and log-linearly interpolates
 * between them. The path is smooth (no fake drawdowns) but hits the published
 * trailing rates exactly at each anchor — honest given the input.
 */
type TrailingBundle = {
  ann_1y: number | null;
  ann_3y: number | null;
  ann_5y: number | null;
  ann_10y: number | null;
};

function synthesiseFromTrailingBundle(t: TrailingBundle, months = 120, asOf: Date = new Date()): SeriesPoint[] {
  const anchors: { m: number; ret: number }[] = [];
  if (t.ann_1y != null) anchors.push({ m: 12, ret: t.ann_1y / 100 });
  if (t.ann_3y != null) anchors.push({ m: 36, ret: t.ann_3y / 100 });
  if (t.ann_5y != null) anchors.push({ m: 60, ret: t.ann_5y / 100 });
  if (t.ann_10y != null) anchors.push({ m: 120, ret: t.ann_10y / 100 });
  if (anchors.length === 0) return [];

  anchors.sort((a, b) => a.m - b.m);
  const knot: { m: number; ln: number }[] = [{ m: 0, ln: 0 }];
  for (const a of anchors) knot.push({ m: a.m, ln: -a.m * Math.log(1 + a.ret) / 12 });

  const maxM = Math.min(months, anchors[anchors.length - 1].m);
  const out: SeriesPoint[] = [];
  const start = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  for (let i = maxM; i >= 0; i--) {
    // Find bracketing anchors
    let hi = knot.length - 1;
    for (let k = 1; k < knot.length; k++) if (knot[k].m >= i) { hi = k; break; }
    const lo = hi - 1 >= 0 ? hi - 1 : hi;
    const a = knot[lo], b = knot[hi];
    const t = a.m === b.m ? 0 : (i - a.m) / (b.m - a.m);
    const ln = a.ln + t * (b.ln - a.ln);
    const v = 100 * Math.exp(ln);
    const d = new Date(start); d.setMonth(d.getMonth() - i);
    out.push({ d: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, v });
  }
  return out;
}

function synthesiseSeriesFromTrailing(holding: ConfirmedPortfolioHolding, months = 120, asOf: Date = new Date()): SeriesPoint[] {
  return synthesiseFromTrailingBundle(
    { ann_1y: holding.ann_1y, ann_3y: holding.ann_3y, ann_5y: holding.ann_5y, ann_10y: holding.ann_10y },
    months,
    asOf,
  );
}

export function previousMonthEnd(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d;
}

export function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export type BuildResult = {
  portfolio: ConfirmedPortfolio;
  asOfMonthKey: string; // YYYY-MM
  html: string;
};

// ─── Return proxy layer ────────────────────────────────────────
// Config + splice helpers moved to lib/return-proxy-splice.ts so the
// /api/performance route (portfolio detail chart) can share the same
// splice math.
const loadProxies = loadReturnProxies;

// Look up the full trailing bundle for a list of proxy ISINs. One trip.
async function fetchProxyReturns(isins: string[]): Promise<Map<string, TrailingBundle & { ann_5y: number | null; ann_10y: number | null }>> {
  const out = new Map<string, TrailingBundle>();
  if (isins.length === 0) return out;
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT f.isin, s.ann_1y, s.ann_3y, s.ann_5y, s.ann_10y
    FROM funds f
    LEFT JOIN LATERAL (SELECT ann_1y, ann_3y, ann_5y, ann_10y FROM fund_snapshots WHERE fund_id = f.id ORDER BY as_of DESC LIMIT 1) s ON true
    WHERE f.isin = ANY(${isins})
  `) as { isin: string; ann_1y: number | null; ann_3y: number | null; ann_5y: number | null; ann_10y: number | null }[];
  for (const r of rows) out.set(r.isin, { ann_1y: r.ann_1y, ann_3y: r.ann_3y, ann_5y: r.ann_5y, ann_10y: r.ann_10y });
  return out;
}

// Per-holding trailing figures with proxy fallback baked in. Also flags which
// funds ended up borrowing from a proxy so the render can annotate honestly.
type ResolvedHolding = {
  weight: number;                 // 0..1 fraction of total
  ann_1y: number | null;
  ann_3y: number | null;
  ann_5y: number | null;          // may come from proxy
  ann_10y: number | null;         // may come from proxy
  usedProxy5y: boolean;
  usedProxy10y: boolean;
};

/**
 * Return the input holdings with ann_5y and ann_10y filled in from the
 * configured proxy fund when the target's own trailing figure is null.
 * Preserves the ConfirmedPortfolioHolding shape so the value is a drop-in
 * substitute for the raw DB output — used by /portfolios/[id] so the
 * Instruments table reads the same numbers the portfolio-level metrics
 * already blend from.
 */
export async function fillHoldingsWithProxies(holdings: ConfirmedPortfolioHolding[]): Promise<ConfirmedPortfolioHolding[]> {
  const proxies = loadProxies();
  const proxyIsins = holdings.filter((h) => h.isin && proxies[h.isin]).map((h) => proxies[h.isin as string].proxy);
  if (proxyIsins.length === 0) return holdings;
  const trailing = await fetchProxyReturns(proxyIsins);
  return holdings.map((h) => {
    if (!h.isin) return h;
    const cfg = proxies[h.isin];
    if (!cfg) return h;
    const p = trailing.get(cfg.proxy);
    if (!p) return h;
    return {
      ...h,
      ann_5y: h.ann_5y ?? p.ann_5y ?? null,
      ann_10y: h.ann_10y ?? p.ann_10y ?? null,
    };
  });
}

async function resolveHoldingsWithProxies(holdings: ConfirmedPortfolioHolding[]): Promise<ResolvedHolding[]> {
  const proxies = loadProxies();
  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;

  const proxyIsins = holdings
    .filter((h) => h.isin && proxies[h.isin])
    .map((h) => proxies[h.isin as string].proxy);
  const proxyData = await fetchProxyReturns(proxyIsins);

  return holdings.map((h) => {
    const weight = h.weight_bps / totalBps;
    const px = h.isin ? proxies[h.isin] : undefined;
    const pxData = px ? proxyData.get(px.proxy) : undefined;
    const ann_5y = h.ann_5y ?? pxData?.ann_5y ?? null;
    const ann_10y = h.ann_10y ?? pxData?.ann_10y ?? null;
    return {
      weight,
      ann_1y: h.ann_1y,
      ann_3y: h.ann_3y,
      ann_5y,
      ann_10y,
      usedProxy5y: h.ann_5y == null && pxData?.ann_5y != null,
      usedProxy10y: h.ann_10y == null && pxData?.ann_10y != null,
    };
  });
}

// Coverage-aware weighted mean. Only sums funds that have a value; renormalises
// across those funds, so a null contributor drops out cleanly.
function weightedMean(resolved: ResolvedHolding[], pick: (r: ResolvedHolding) => number | null): { value: number | null; coverage: number } {
  let sumW = 0;
  let sumWv = 0;
  const totalWeight = resolved.reduce((s, r) => s + r.weight, 0) || 1;
  for (const r of resolved) {
    const v = pick(r);
    if (v == null) continue;
    sumW += r.weight;
    sumWv += r.weight * v;
  }
  if (sumW === 0) return { value: null, coverage: 0 };
  return { value: sumWv / sumW, coverage: sumW / totalWeight };
}

export type TrailingReturns = {
  ytd: number | null;
  ann_1y: number | null;
  ann_3y: number | null;
  ann_5y: number | null;
  ann_10y: number | null;
  stddev_3y: number | null;
  coverage: {
    ytd: number;
    ann_1y: number;
    ann_3y: number;
    ann_5y: number;
    ann_10y: number;
    stddev_3y: number;
    proxied_5y_weight: number;   // fraction of portfolio weight whose 5Y came from proxy
    proxied_10y_weight: number;
  };
};

export async function computeTrailingReturns(holdings: ConfirmedPortfolioHolding[]): Promise<TrailingReturns> {
  const resolved = await resolveHoldingsWithProxies(holdings);
  const totalWeight = resolved.reduce((s, r) => s + r.weight, 0) || 1;

  // YTD and stddev come straight from holdings; no proxy layer for those.
  const ytd = weightedMean(
    holdings.map((h, i) => ({ ...resolved[i], _y: h.ytd })) as ResolvedHolding[] & { _y: number | null }[],
    (r) => (r as ResolvedHolding & { _y: number | null })._y,
  );
  const stddev = weightedMean(
    holdings.map((h, i) => ({ ...resolved[i], _s: h.stddev_3y })) as ResolvedHolding[] & { _s: number | null }[],
    (r) => (r as ResolvedHolding & { _s: number | null })._s,
  );
  const r1y = weightedMean(resolved, (r) => r.ann_1y);
  const r3y = weightedMean(resolved, (r) => r.ann_3y);
  const r5y = weightedMean(resolved, (r) => r.ann_5y);
  const r10y = weightedMean(resolved, (r) => r.ann_10y);

  const proxied_5y_weight = resolved.reduce((s, r) => (r.usedProxy5y ? s + r.weight : s), 0) / totalWeight;
  const proxied_10y_weight = resolved.reduce((s, r) => (r.usedProxy10y ? s + r.weight : s), 0) / totalWeight;

  return {
    ytd: ytd.value,
    ann_1y: r1y.value,
    ann_3y: r3y.value,
    ann_5y: r5y.value,
    ann_10y: r10y.value,
    stddev_3y: stddev.value,
    coverage: {
      ytd: ytd.coverage,
      ann_1y: r1y.coverage,
      ann_3y: r3y.coverage,
      ann_5y: r5y.coverage,
      ann_10y: r10y.coverage,
      stddev_3y: stddev.coverage,
      proxied_5y_weight,
      proxied_10y_weight,
    },
  };
}

export async function buildFactsheetForPortfolio(portfolioId: number, asOfMonth?: Date): Promise<BuildResult | null> {
  const portfolio = await getConfirmedPortfolio(portfolioId);
  if (!portfolio) return null;

  const holdings = await getPortfolioHoldings(portfolioId);
  // The stored xray_json is frozen at confirmation. Recompute every field
  // live so the fact sheet page 2 (risk, expense, geo, sector, look-through
  // top holdings) reflects the current sync — same numbers users see on the
  // portfolio detail page.
  const storedXray = parseXray(portfolio);
  const liveExtras = await computeLiveXrayExtras(holdings);
  const xray = { ...(storedXray ?? {}), ...liveExtras };

  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;
  const components = holdings
    .filter((h) => !!h.isin)
    .map((h) => ({ isin: h.isin as string, weight: h.weight_bps / totalBps }));

  // Pre-build a supplemental series per holding, using this priority:
  //   1. Splice: target's real GrowthOf10K + proxy fund's earlier history
  //      scaled to connect at the target's inception. Used whenever a
  //      return-proxy is configured and the proxy's series reaches further
  //      back than the target's — extends both the chart window and the
  //      annual-return bars.
  //   2. Synth from trailing returns: for MAS-coded SG funds whose
  //      Morningstar payload carries no series at all.
  const proxies = loadProxies();
  const proxyIsins = holdings.map((h) => (h.isin ? proxies[h.isin]?.proxy : null)).filter((x): x is string => !!x);
  const proxyTrailingByIsin = await fetchProxyReturns(proxyIsins);
  const supplementalSeries = new Map<string, SeriesPoint[]>();
  await Promise.all(
    holdings.map(async (h) => {
      if (!h.isin) return;
      const cfg = proxies[h.isin];
      if (cfg) {
        const [targetSnap, proxySnap] = await Promise.all([
          fetchSnapshot(h.isin),
          fetchSnapshot(cfg.proxy),
        ]);
        // If the proxy is itself a MAS-coded fund with no GrowthOf10K
        // (e.g. Infinity Global Stock Index USD), fall back to synthesising
        // the proxy's series from its own trailing returns before splicing.
        let proxySeries = proxySnap.points;
        if (proxySeries.length < 3) {
          const proxyTrailing = proxyTrailingByIsin.get(cfg.proxy);
          if (proxyTrailing) proxySeries = synthesiseFromTrailingBundle(proxyTrailing);
        }
        const spliced = spliceProxyPrefix(targetSnap.points, proxySeries);
        if (spliced.length > targetSnap.points.length) {
          supplementalSeries.set(h.isin, spliced);
          return;
        }
      }
      const synth = synthesiseSeriesFromTrailing(h);
      if (synth.length >= 3) supplementalSeries.set(h.isin, synth);
    }),
  );
  const series = await blendPortfolioSeries(components, 120, supplementalSeries);
  const returns = await computeTrailingReturns(holdings);
  const asOf = asOfMonth ?? previousMonthEnd();

  const html = renderFactsheetHtml({
    portfolio,
    holdings,
    xray,
    series,
    returns,
    asOfMonth: asOf,
  });

  return { portfolio, asOfMonthKey: monthKey(asOf), html };
}

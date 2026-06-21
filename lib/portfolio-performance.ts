// Server-side helpers for the /portfolios index. Each ISIN's Morningstar
// MFsnapshot is fetched once and cached for 6h; from that single response we
// expose both the GrowthOf10K series (for the sparkline) and the trailing
// 12-month yield (for income-portfolio yield aggregation).
//
// Mirrors the math in app/api/performance/route.ts on the series side but adds
// yield extraction. The /api route still has its own copy so the API contract
// is unchanged; this module is dedicated to server-side page rendering.
//
// For ISINs Morningstar's snapshot leaves blank (notably MAS-coded SG funds),
// data/yield-overrides.json supplies a fallback figure scraped from the platform
// fund-centre (see scripts/scrape-platform-yields.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type SeriesPoint = { d: string; v: number };

type YieldOverride = { yieldPct: number | null; source: string; msid?: string; asOf?: string | null; note?: string };
let OVERRIDES_CACHE: Record<string, YieldOverride> | null = null;
function loadYieldOverrides(): Record<string, YieldOverride> {
  if (OVERRIDES_CACHE) return OVERRIDES_CACHE;
  const file = join(process.cwd(), "data", "yield-overrides.json");
  if (!existsSync(file)) {
    OVERRIDES_CACHE = {};
    return OVERRIDES_CACHE;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { overrides?: Record<string, YieldOverride> };
    OVERRIDES_CACHE = parsed.overrides ?? {};
  } catch {
    OVERRIDES_CACHE = {};
  }
  return OVERRIDES_CACHE;
}

type Snapshot = {
  points: SeriesPoint[];       // GrowthOf10K, monthly
  yield12m: number | null;     // YieldHistory.Value where Type == "52"
  distFreq: string | null;     // e.g. "M$" (Monthly), "Q" (Quarterly), "A" (Annual)
};

const CACHE = new Map<string, { ts: number; snap: Snapshot }>();
const TTL_MS = 6 * 60 * 60 * 1000;

async function fetchSnapshot(isin: string): Promise<Snapshot> {
  const cached = CACHE.get(isin);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.snap;
  const empty: Snapshot = { points: [], yield12m: null, distFreq: null };
  const url = `https://tools.morningstar.co.uk/api/rest.svc/klr5zyak8x/security_details/${encodeURIComponent(
    isin,
  )}?idtype=isin&languageId=en-GB&responseViewFormat=json&viewId=MFsnapshot`;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return empty;
    const j = (await r.json()) as unknown;
    const arr = Array.isArray(j) ? j[0] : j;
    if (!arr || typeof arr !== "object") return empty;
    const obj = arr as {
      GrowthOf10K?: Array<{ HistoryDetails?: Array<{ EndDate: string; Value: number }> }>;
      YieldHistory?: { Type?: string; Value?: number } | Array<{ Type?: string; Value?: number }>;
      DividendDistributionFrequency?: string;
    };

    // -------- series --------
    const g = obj.GrowthOf10K;
    let points: SeriesPoint[] = [];
    if (Array.isArray(g) && g.length > 0) {
      const series = g.reduce((a, b) =>
        (b.HistoryDetails?.length ?? 0) > (a.HistoryDetails?.length ?? 0) ? b : a,
      );
      points = (series.HistoryDetails ?? [])
        .map((h) => ({ d: String(h.EndDate).slice(0, 7), v: h.Value }))
        .filter((p) => p.v > 0);
      if (points.length < 2) points = [];
    }

    // -------- yield (trailing 12m, Type code "52") --------
    let yield12m: number | null = null;
    const yh = obj.YieldHistory;
    const yhList = Array.isArray(yh) ? yh : yh ? [yh] : [];
    const t52 = yhList.find((p) => String(p.Type) === "52" && typeof p.Value === "number");
    if (t52?.Value != null) yield12m = t52.Value;
    // Fall back to the override file (platform-scraped) when Morningstar is blank.
    if (yield12m == null) {
      const ov = loadYieldOverrides()[isin];
      if (ov && typeof ov.yieldPct === "number") yield12m = ov.yieldPct;
    }

    const snap: Snapshot = {
      points,
      yield12m,
      distFreq: obj.DividendDistributionFrequency ?? null,
    };
    CACHE.set(isin, { ts: Date.now(), snap });
    return snap;
  } catch {
    return empty;
  }
}

export type Component = { isin: string; weight: number };

export type BlendedSeries = {
  points: SeriesPoint[];
  start: string;
  end: string;
  terminal: number;
} | null;

/**
 * Build the weight-blended 3Y series for the card sparkline. Intersects dates
 * across components, trims to the last `windowMonths`, rebases each to 100
 * at the trimmed start, then weight-blends.
 */
export async function blendPortfolioSeries(
  components: Component[],
  windowMonths = 36,
): Promise<BlendedSeries> {
  const valid = components.filter((c) => c.isin && c.weight > 0);
  if (valid.length === 0) return null;

  const fetched = await Promise.all(
    valid.map(async (c) => {
      const snap = await fetchSnapshot(c.isin);
      return { weight: c.weight, points: snap.points };
    }),
  );
  const usable = fetched.filter((f) => f.points.length >= 3);
  if (usable.length === 0) return null;

  let start = "0000-00";
  let end = "9999-99";
  for (const f of usable) {
    if (f.points[0].d > start) start = f.points[0].d;
    if (f.points[f.points.length - 1].d < end) end = f.points[f.points.length - 1].d;
  }
  const allDates = [...new Set(usable.flatMap((f) => f.points.map((p) => p.d)))].sort();
  let common = allDates.filter((d) => d >= start && d <= end);
  if (common.length < 3) return null;
  if (common.length > windowMonths) common = common.slice(-windowMonths);

  const maps = usable.map((f) => Object.fromEntries(f.points.map((p) => [p.d, p.v])));
  const totalWeight = usable.reduce((s, f) => s + f.weight, 0) || 1;
  const blended: SeriesPoint[] = common.map((d) => {
    let v = 0;
    for (let i = 0; i < usable.length; i++) {
      const base = maps[i][common[0]];
      v += (usable[i].weight / totalWeight) * ((maps[i][d] / base) * 100);
    }
    return { d, v };
  });

  return {
    points: blended,
    start: blended[0].d,
    end: blended[blended.length - 1].d,
    terminal: blended[blended.length - 1].v,
  };
}

export type BlendedYield = {
  yieldPct: number;       // weighted across funds with data, renormalised
  coverageWeight: number; // fraction of original portfolio weight that contributed (0..1)
} | null;

/**
 * Weight-blended trailing 12-month yield for an income portfolio. Morningstar's
 * Type-52 yield is already an annualised TTM figure based on each fund's own
 * cashflow history, so we just weight-average across funds we have data for.
 *
 * Renormalises across covered funds: if 20% of the portfolio is in a fund with
 * no yield datapoint, the remaining 80% drives the blended figure. The caller
 * gets `coverageWeight` so it can warn when coverage is thin.
 */
export async function blendPortfolioYield(components: Component[]): Promise<BlendedYield> {
  const valid = components.filter((c) => c.isin && c.weight > 0);
  if (valid.length === 0) return null;

  const fetched = await Promise.all(
    valid.map(async (c) => {
      const snap = await fetchSnapshot(c.isin);
      return { weight: c.weight, yieldPct: snap.yield12m };
    }),
  );
  const covered = fetched.filter((f): f is { weight: number; yieldPct: number } => f.yieldPct != null);
  const coveredWeight = covered.reduce((s, f) => s + f.weight, 0);
  if (coveredWeight === 0) return null;

  const weightedYield = covered.reduce((s, f) => s + f.weight * f.yieldPct, 0) / coveredWeight;
  const totalWeight = valid.reduce((s, f) => s + f.weight, 0) || 1;
  return {
    yieldPct: weightedYield,
    coverageWeight: coveredWeight / totalWeight,
  };
}

// Server-side blended-performance helper for the /portfolios index. Calls
// Morningstar GrowthOf10K per ISIN, intersects on common dates, rebases each
// component to 100 at the common start, and returns a weight-blended series
// for the model. Mirrors the math in app/api/performance/route.ts but runs
// during the server render so cards ship with their sparklines pre-drawn.
//
// Process-local cache (6h TTL) — same lifetime as the API route. Run on the
// node runtime; no fetch budget guard beyond a per-call timeout.

type SeriesPoint = { d: string; v: number };

const CACHE = new Map<string, { ts: number; points: SeriesPoint[] }>();
const TTL_MS = 6 * 60 * 60 * 1000;

async function fetchSeries(isin: string): Promise<SeriesPoint[]> {
  const cached = CACHE.get(isin);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.points;
  const url = `https://tools.morningstar.co.uk/api/rest.svc/klr5zyak8x/security_details/${encodeURIComponent(
    isin,
  )}?idtype=isin&languageId=en-GB&responseViewFormat=json&viewId=MFsnapshot`;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as unknown;
    const arr = (Array.isArray(j) ? j[0] : j) as {
      GrowthOf10K?: Array<{ HistoryDetails?: Array<{ EndDate: string; Value: number }> }>;
    };
    const g = arr?.GrowthOf10K;
    if (!Array.isArray(g) || g.length === 0) return [];
    const series = g.reduce((a, b) =>
      (b.HistoryDetails?.length ?? 0) > (a.HistoryDetails?.length ?? 0) ? b : a,
    );
    const points: SeriesPoint[] = (series.HistoryDetails ?? [])
      .map((h) => ({ d: String(h.EndDate).slice(0, 7), v: h.Value }))
      .filter((p) => p.v > 0);
    if (points.length < 2) return [];
    CACHE.set(isin, { ts: Date.now(), points });
    return points;
  } catch {
    return [];
  }
}

export type Component = { isin: string; weight: number };
export type BlendedSeries = {
  points: SeriesPoint[]; // model line, rebased to 100 at the trimmed start
  start: string;
  end: string;
  terminal: number;
} | null;

// Trim a date string ("YYYY-MM") to the earliest point >= cutoff.
function trimStart(points: SeriesPoint[], cutoff: string): SeriesPoint[] {
  const idx = points.findIndex((p) => p.d >= cutoff);
  return idx < 0 ? [] : points.slice(idx);
}

/**
 * Build the weight-blended series for a portfolio. `windowMonths` defaults
 * to 36 (3 years) — anything older is trimmed before rebasing so the card
 * sparkline really shows 3Y, not the full available history.
 */
export async function blendPortfolioSeries(
  components: Component[],
  windowMonths = 36,
): Promise<BlendedSeries> {
  const valid = components.filter((c) => c.isin && c.weight > 0);
  if (valid.length === 0) return null;

  const fetched = await Promise.all(
    valid.map(async (c) => ({ isin: c.isin, weight: c.weight, points: await fetchSeries(c.isin) })),
  );
  const usable = fetched.filter((f) => f.points.length >= 3);
  if (usable.length === 0) return null;

  // Intersect dates first, THEN trim to last `windowMonths`.
  let start = "0000-00";
  let end = "9999-99";
  for (const f of usable) {
    if (f.points[0].d > start) start = f.points[0].d;
    if (f.points[f.points.length - 1].d < end) end = f.points[f.points.length - 1].d;
  }
  const allDates = [...new Set(usable.flatMap((f) => f.points.map((p) => p.d)))].sort();
  let common = allDates.filter((d) => d >= start && d <= end);
  if (common.length < 3) return null;

  // Trim to the last N months of the common period.
  if (common.length > windowMonths) common = common.slice(-windowMonths);

  // Rebase each component to 100 at common[0], blend by weight.
  const maps = usable.map((f) => Object.fromEntries(f.points.map((p) => [p.d, p.v])));
  const totalWeight = usable.reduce((s, f) => s + f.weight, 0) || 1;
  const blended: SeriesPoint[] = common.map((d, j) => {
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

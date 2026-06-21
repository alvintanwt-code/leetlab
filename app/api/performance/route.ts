import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { syntheticGrowth10K } from "@/lib/return-overrides";

// Server-side proxy + cache for Morningstar's public security_details endpoint.
// We fetch the GrowthOf10K series per ISIN, rebase to 100, then blend a model line.
// The Morningstar key embedded in the URL is a public client key used by their own
// fund-centre widget — same one the user's HTML prototype calls. No auth needed.

type Body = { components: { isin: string; weight: number; name: string }[] };

const Body = z.object({
  components: z.array(
    z.object({
      isin: z.string().min(8),
      weight: z.number().min(0).max(1),
      name: z.string().max(160),
    }),
  ).min(1).max(20),
});

type SeriesPoint = { d: string; v: number };
type FundSeries = { isin: string; name: string; weight: number; points: SeriesPoint[] };

const CACHE = new Map<string, { ts: number; points: SeriesPoint[] }>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function fetchSeries(isin: string): Promise<SeriesPoint[]> {
  const cached = CACHE.get(isin);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.points;

  const url = `https://tools.morningstar.co.uk/api/rest.svc/klr5zyak8x/security_details/${encodeURIComponent(isin)}?idtype=isin&languageId=en-GB&responseViewFormat=json&viewId=MFsnapshot`;
  let points: SeriesPoint[] = [];
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (r.ok) {
      const j = (await r.json()) as unknown;
      const arr = (Array.isArray(j) ? j[0] : j) as { GrowthOf10K?: Array<{ HistoryDetails?: Array<{ EndDate: string; Value: number }> }> };
      const g = arr?.GrowthOf10K;
      if (Array.isArray(g) && g.length > 0) {
        const series = g.reduce((a, b) => ((b.HistoryDetails?.length ?? 0) > (a.HistoryDetails?.length ?? 0) ? b : a));
        points = (series.HistoryDetails ?? [])
          .map((h) => ({ d: String(h.EndDate).slice(0, 7), v: h.Value }))
          .filter((p) => p.v > 0);
      }
    }
  } catch {
    // fall through to override
  }
  // Fallback for MAS-coded SG funds — Morningstar's MFsnapshot is empty for these,
  // but data/return-overrides.json carries the cumulative-return series scraped
  // from the chart endpoint (see scripts/scrape-mas-returns.ts).
  if (points.length < 2) {
    const synth = syntheticGrowth10K(isin);
    if (synth.length >= 2) points = synth;
  }
  if (points.length < 2) return [];
  CACHE.set(isin, { ts: Date.now(), points });
  return points;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  let parsed: Body;
  try {
    parsed = Body.parse(await req.json()) as Body;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Renormalise weights to sum 1.0 across components with usable data.
  const fetched = await Promise.allSettled(
    parsed.components.map(async (c) => ({
      isin: c.isin,
      name: c.name,
      weight: c.weight,
      points: await fetchSeries(c.isin),
    })),
  );
  const usable: FundSeries[] = fetched
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((s): s is FundSeries => s !== null && s.points.length >= 3);

  if (usable.length === 0) {
    return NextResponse.json({ error: "No fund has a public time series via Morningstar." }, { status: 200 });
  }

  // Build common date period (intersection of dates each fund has).
  const maps = usable.map((f) => Object.fromEntries(f.points.map((p) => [p.d, p.v])));
  let start = "0000-00";
  let end = "9999-99";
  for (const f of usable) {
    if (f.points[0].d > start) start = f.points[0].d;
    if (f.points[f.points.length - 1].d < end) end = f.points[f.points.length - 1].d;
  }
  const allDates = [...new Set(usable.flatMap((f) => f.points.map((p) => p.d)))].sort();
  const common = allDates.filter((d) => d >= start && d <= end && maps.every((m) => m[d] != null));

  if (common.length < 3) {
    return NextResponse.json({ error: "Not enough overlapping history across components to chart." }, { status: 200 });
  }

  // Rebase each component to 100 at common[0].
  const fundsOut = usable.map((f, i) => {
    const base = maps[i][common[0]];
    const points = common.map((d) => ({ d, v: (maps[i][d] / base) * 100 }));
    return {
      isin: f.isin,
      name: f.name,
      weight: f.weight,
      points,
      terminal: points[points.length - 1].v,
    };
  });

  const totalWeight = fundsOut.reduce((s, f) => s + f.weight, 0) || 1;
  const modelPoints = common.map((_, j) => ({
    d: common[j],
    v: fundsOut.reduce((s, f) => s + (f.weight / totalWeight) * f.points[j].v, 0),
  }));

  const skipped = parsed.components.length - usable.length;

  return NextResponse.json({
    funds: fundsOut,
    model: { points: modelPoints, terminal: modelPoints[modelPoints.length - 1].v },
    commonStart: common[0],
    commonEnd: common[common.length - 1],
    skipped,
  });
}

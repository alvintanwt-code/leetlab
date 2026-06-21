"use client";

import { useEffect, useMemo, useState } from "react";
import { BarsRow } from "@/components/PortfolioDetail";
import { TrailingChart } from "@/components/TrailingChart";
import { ReturnText } from "@/components/PortfolioCard";
import type { FundAllocations, FundOption } from "@/components/FundSwitchWorkspace";

// ------------------------------- label maps -------------------------------

// Morningstar's raw sector labels → advisor-friendly. Pass-through anything
// not in the map.
const SECTOR_PRETTY: Record<string, string> = {
  "Information Technology": "Technology",
  Technology: "Technology",
  "Communication Services": "Telecoms & Media",
  "Communication Svs": "Telecoms & Media",
  Comm: "Telecoms & Media",
  "Financial Services": "Financials",
  "Financial Svs": "Financials",
  "Health Care": "Healthcare",
  "Consumer Defensive": "Consumer staples",
  "Con Defensive": "Consumer staples",
  "Consumer Cyclical": "Consumer discretionary",
  "Con Cyclical": "Consumer discretionary",
  "Basic Materials": "Materials",
};

// Bucket raw region labels into a small set of plain-English regions.
const GEO_REGIONS: Record<string, string> = {
  "United States": "US",
  USA: "US",
  US: "US",
  Canada: "Canada",
  "United Kingdom": "UK",
  Eurozone: "Europe (ex-UK)",
  "Europe ex-UK": "Europe (ex-UK)",
  "Europe Emerging": "Emerging Europe",
  Japan: "Japan",
  "Asia - Developed": "Asia ex-Japan",
  "Asia Developed": "Asia ex-Japan",
  "Asia - Emerging": "EM Asia",
  "Asia Emerging": "EM Asia",
  "Africa & Middle East": "Other EM",
  "Africa/Middle East": "Other EM",
  "Latin America": "Other EM",
  Australasia: "Asia ex-Japan",
};

function prettyLabel(map: Record<string, string>, raw: string): string {
  return map[raw] ?? raw;
}

// --------------------------- aggregation helpers ---------------------------

// Weighted aggregation of per-fund label breakdowns into a portfolio-level view.
// Each `byFund` entry contributes its `weight` × per-label percentages.
// Returns top-N entries with the rest lumped into "Other".
function aggregateWeighted(
  byFund: Array<{ weight: number; entries: { label: string; weight_pct: number }[] }>,
  labelMap: Record<string, string>,
  topN: number,
): { label: string; weight_pct: number }[] {
  const merged = new Map<string, number>();
  let totalWeight = 0;
  for (const { weight, entries } of byFund) {
    totalWeight += weight;
    for (const e of entries) {
      const label = prettyLabel(labelMap, e.label);
      const contribution = (e.weight_pct / 100) * weight;
      merged.set(label, (merged.get(label) ?? 0) + contribution);
    }
  }
  if (totalWeight === 0) return [];
  const items = [...merged.entries()].map(([label, w]) => ({
    label,
    weight_pct: (w / totalWeight) * 100,
  }));
  items.sort((a, b) => b.weight_pct - a.weight_pct);
  if (items.length <= topN + 1) return items;
  const top = items.slice(0, topN);
  const rest = items.slice(topN);
  const otherTotal = rest.reduce((s, r) => s + r.weight_pct, 0);
  return [...top, { label: "Other", weight_pct: otherTotal }];
}

// Calendar-year returns from a monthly rebased series. Each year's return is
// (Dec_Y / Dec_(Y-1)) − 1. The latest year is flagged `partial` if the
// latest data point isn't December — caller renders as e.g. "2026 YTD".
function computeCalendarReturns(
  points: { d: string; v: number }[],
): { year: number; returnPct: number | null; partial: boolean }[] {
  if (points.length < 2) return [];
  const yearEnd = new Map<number, number>();
  for (const p of points) {
    const year = parseInt(p.d.slice(0, 4), 10);
    yearEnd.set(year, p.v); // points are sorted ascending — last write wins
  }
  const sortedYears = [...yearEnd.keys()].sort((a, b) => a - b);
  const lastPoint = points[points.length - 1];
  const lastYearPartial = lastPoint.d.slice(5, 7) !== "12";
  const out: { year: number; returnPct: number | null; partial: boolean }[] = [];
  for (let i = 1; i < sortedYears.length; i++) {
    const year = sortedYears[i];
    const prev = yearEnd.get(sortedYears[i - 1])!;
    const curr = yearEnd.get(year)!;
    const partial = year === sortedYears[sortedYears.length - 1] && lastYearPartial;
    out.push({
      year,
      returnPct: prev > 0 ? (curr / prev - 1) * 100 : null,
      partial,
    });
  }
  return out.reverse(); // newest first
}

// Geometric trailing-N-year annualised return from rebased monthly series.
function trailingAnnReturn(
  points: { d: string; v: number }[],
  years: number,
): number | null {
  if (points.length < 2) return null;
  const lastPoint = points[points.length - 1];
  const targetYear = parseInt(lastPoint.d.slice(0, 4), 10) - years;
  const targetMonth = lastPoint.d.slice(5, 7);
  const target = `${targetYear}-${targetMonth}`;
  const startIdx = points.findIndex((p) => p.d >= target);
  if (startIdx < 0 || startIdx === points.length - 1) return null;
  const startV = points[startIdx].v;
  const endV = lastPoint.v;
  if (startV <= 0) return null;
  return (Math.pow(endV / startV, 1 / years) - 1) * 100;
}

// ----------------------------- /api/performance -----------------------------

type SeriesPoint = { d: string; v: number };
type ChartData = {
  funds: Array<{ isin: string; name: string; weight: number; points: SeriesPoint[]; terminal: number }>;
  model: { points: SeriesPoint[]; terminal: number };
  commonStart: string;
  commonEnd: string;
  skipped: number;
};

// --------------------------------- main ------------------------------------

export type ValidHolding = { fundId: number; value: number };

export function ExistingPortfolioSummary({
  validHoldings,
  fundsByPlatform,
  allocationsByPlatform,
  platform,
  totalValue,
}: {
  validHoldings: ValidHolding[];
  fundsByPlatform: Record<string, FundOption[]>;
  allocationsByPlatform: Record<string, Record<number, FundAllocations>>;
  platform: string;
  totalValue: number;
}) {
  const [chart, setChart] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const platformOptions = fundsByPlatform[platform] ?? [];
  const platformAllocs = allocationsByPlatform[platform] ?? {};

  const optionsById = useMemo(() => {
    const m = new Map<number, FundOption>();
    for (const o of platformOptions) m.set(o.id, o);
    return m;
  }, [platformOptions]);

  const enrichedHoldings = useMemo(
    () =>
      validHoldings.map((h) => ({
        ...h,
        option: optionsById.get(h.fundId) ?? null,
        weight: totalValue > 0 ? h.value / totalValue : 0,
      })),
    [validHoldings, optionsById, totalValue],
  );

  const sectorAgg = useMemo(() => {
    const byFund = enrichedHoldings
      .map((h) => ({
        weight: h.weight,
        entries: platformAllocs[h.fundId]?.sector ?? [],
      }))
      .filter((b) => b.entries.length > 0);
    return aggregateWeighted(byFund, SECTOR_PRETTY, 6);
  }, [enrichedHoldings, platformAllocs]);

  const geoAgg = useMemo(() => {
    const byFund = enrichedHoldings
      .map((h) => ({
        weight: h.weight,
        entries: platformAllocs[h.fundId]?.geography ?? [],
      }))
      .filter((b) => b.entries.length > 0);
    return aggregateWeighted(byFund, GEO_REGIONS, 5);
  }, [enrichedHoldings, platformAllocs]);

  // Fetch the blended Morningstar series. Re-runs when the active holdings
  // change. AbortController-style cancel via a flag — the response of a
  // stale fetch is ignored.
  useEffect(() => {
    const components = enrichedHoldings
      .filter((h) => h.option?.isin)
      .map((h) => ({
        isin: h.option!.isin as string,
        weight: h.weight,
        name: h.option!.name,
      }));
    if (components.length === 0) {
      setChart(null);
      setChartError(null);
      return;
    }
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    (async () => {
      try {
        const res = await fetch("/api/performance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ components }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data?.error) throw new Error(data?.error ?? `HTTP ${res.status}`);
        setChart(data as ChartData);
      } catch (e) {
        if (!cancelled) setChartError((e as Error).message);
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enrichedHoldings]);

  // Cap at the 5 most-recent calendar years — earlier years add columns but
  // little decision-relevant signal, and 5 keeps the table within a 13" MacBook
  // viewport without horizontal scroll once 1Y/3Y trailing columns are added.
  const calendarReturns = useMemo(
    () => (chart?.model ? computeCalendarReturns(chart.model.points).slice(0, 5) : []),
    [chart],
  );

  const trailingPortfolio = useMemo(
    () => ({
      ann1y: chart?.model ? trailingAnnReturn(chart.model.points, 1) : null,
      ann3y: chart?.model ? trailingAnnReturn(chart.model.points, 3) : null,
    }),
    [chart],
  );

  const fundLines = useMemo(() => {
    const m = new Map<
      string,
      {
        ann1y: number | null;
        ann3y: number | null;
        calendars: { year: number; returnPct: number | null; partial: boolean }[];
      }
    >();
    if (!chart) return m;
    for (const f of chart.funds) {
      m.set(f.isin, {
        ann1y: trailingAnnReturn(f.points, 1),
        ann3y: trailingAnnReturn(f.points, 3),
        calendars: computeCalendarReturns(f.points),
      });
    }
    return m;
  }, [chart]);

  const description = useMemo(
    () => describePortfolio(enrichedHoldings, sectorAgg, geoAgg),
    [enrichedHoldings, sectorAgg, geoAgg],
  );

  const summary = useMemo(
    () => describeSummary(geoAgg, trailingPortfolio.ann3y, calendarReturns),
    [geoAgg, trailingPortfolio.ann3y, calendarReturns],
  );

  if (validHoldings.length === 0) return null;

  // X-ray-style multi-card layout: each section is its own white card,
  // referencing the PortfolioDetail.tsx pattern (rounded-lg + hairline +
  // canvas + p-5 + title-left/eyebrow-right header). Outer wrapper is just
  // a flex column for spacing — no border or bg of its own.
  return (
    <div className="flex flex-col gap-4">
      {/* Header + Performance — combined into one card with a clear visual
          hierarchy. Identity block (total · holdings · profile) sits on top;
          a hairline + extra spacing separates it from the performance table
          below. Reads as: who this portfolio is, then how it has performed. */}
      <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
        <div className="mb-4 flex items-baseline justify-between border-b border-[var(--color-hairline-2)] pb-3">
          <h2 className="t-body-md font-medium text-[var(--color-ink)]">Existing portfolio</h2>
          <p className="t-micro-cap">Snapshot as parsed</p>
        </div>

        {/* Identity block */}
        <div className="grid grid-cols-1 gap-y-3 gap-x-8 sm:grid-cols-[auto_auto_1fr] sm:items-baseline">
          <Stat label="Total value" value={`SGD ${totalValue.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
          <Stat label="Holdings" value={String(enrichedHoldings.length)} />
          <div>
            <p className="t-micro-cap">Profile</p>
            <p className="t-body-md mt-1.5 text-[var(--color-ink-2)]">{description}</p>
          </div>
        </div>

        {/* Performance block — divided from identity by a hairline + breathing room */}
        <div className="mt-6 border-t border-[var(--color-hairline-2)] pt-5">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="t-body-md font-medium text-[var(--color-ink)]">Performance</p>
            <p className="t-micro-cap">% per year &middot; geometric annualisation</p>
          </div>
          <PerformanceTable
            enrichedHoldings={enrichedHoldings}
            fundLines={fundLines}
            calendarReturns={calendarReturns}
            portfolioTrailing={trailingPortfolio}
            loading={chartLoading}
          />
        </div>
      </section>

      {/* Trailing 3Y chart — already wraps itself in a card */}
      {chart ? (
        <TrailingChart {...chart} />
      ) : chartError ? (
        <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <p className="t-caption text-center text-[var(--color-negative)]">{chartError}</p>
        </section>
      ) : chartLoading ? (
        <section className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <p className="t-caption text-center text-[var(--color-ink-mute)]">Fetching Morningstar series…</p>
        </section>
      ) : null}

      {/* Sector + Geography — each in its own white card, side by side */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <AllocationPanel title="Sector exposure" items={sectorAgg} kind="sector" />
        </section>
        <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <AllocationPanel title="Geographic exposure" items={geoAgg} kind="geo" />
        </section>
      </div>

      {/* Plain-English summary card */}
      <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
        <p className="t-micro-cap mb-2">Summary</p>
        <p className="t-body-md leading-[1.6] text-[var(--color-ink-2)]">{summary}</p>
      </section>
    </div>
  );
}

// ---------------- subcomponents ----------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="t-micro-cap">{label}</p>
      <p className="num mt-1.5 text-[20px] font-medium tabular-nums leading-none text-[var(--color-ink)]">
        {value}
      </p>
    </div>
  );
}

function AllocationPanel({
  title,
  items,
  kind,
}: {
  title: string;
  items: { label: string; weight_pct: number }[];
  kind: "sector" | "geo";
}) {
  const top = items[0];
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="t-body-md font-medium text-[var(--color-ink)]">{title}</p>
        <p className="t-micro-cap">Weighted, look-through</p>
      </div>
      {items.length > 0 ? (
        <>
          <BarsRow items={items} />
          {top && (
            <p className="t-caption mt-3 text-[var(--color-ink-mute)]">
              Most exposed to:{" "}
              <span className="font-medium text-[var(--color-ink-2)]">{top.label}</span>
              <span className="num"> — {top.weight_pct.toFixed(1)}%</span>
            </p>
          )}
        </>
      ) : (
        <p className="t-caption text-[var(--color-ink-mute)]">
          {kind === "sector"
            ? "No sector breakdown available for these funds."
            : "No geographic breakdown available for these funds."}
        </p>
      )}
    </div>
  );
}

function PerformanceTable({
  enrichedHoldings,
  fundLines,
  calendarReturns,
  portfolioTrailing,
  loading,
}: {
  enrichedHoldings: { fundId: number; value: number; option: FundOption | null; weight: number }[];
  fundLines: Map<
    string,
    {
      ann1y: number | null;
      ann3y: number | null;
      calendars: { year: number; returnPct: number | null; partial: boolean }[];
    }
  >;
  calendarReturns: { year: number; returnPct: number | null; partial: boolean }[];
  portfolioTrailing: { ann1y: number | null; ann3y: number | null };
  loading: boolean;
}) {
  const years = calendarReturns.map((c) => c.year);
  return (
    <div className="overflow-x-auto">
      {/* width: auto overrides .table-pro's width:100% so the table shrinks
          to content when fewer calendar years are available. table-pro-xs
          tightens font + padding vs table-pro-sm for the dense numeric grid. */}
      <table
        className="table-pro table-pro-xs"
        style={{ tableLayout: "auto", width: "auto" }}
      >
        <thead>
          <tr>
            <th>Holding</th>
            <th className="right">1Y</th>
            <th className="right">3Y ann.</th>
            {years.map((y) => {
              const partial = calendarReturns.find((c) => c.year === y)?.partial;
              return (
                <th key={y} className="right">
                  {y}
                  {partial ? " YTD" : ""}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="t-body-md font-medium text-[var(--color-ink)]">Portfolio total</span>
            </td>
            <td className="nowrap right">
              <span className="num">
                <ReturnText value={portfolioTrailing.ann1y} />
              </span>
            </td>
            <td className="nowrap right">
              <span className="num">
                <ReturnText value={portfolioTrailing.ann3y} />
              </span>
            </td>
            {calendarReturns.map((c) => (
              <td key={c.year} className="nowrap right">
                <span className="num">
                  <ReturnText value={c.returnPct} />
                </span>
              </td>
            ))}
          </tr>
          {enrichedHoldings.map((h) => {
            const opt = h.option;
            const line = opt?.isin ? fundLines.get(opt.isin) ?? null : null;
            return (
              <tr key={h.fundId}>
                <td className="cell-fund">
                  <span
                    className="name text-[var(--color-ink)]"
                    title={opt?.name ?? ""}
                    style={{
                      whiteSpace: "normal",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      fontSize: "13px",
                    }}
                  >
                    {opt?.name ?? "—"}
                  </span>
                  <span className="meta">{opt?.isin ?? ""}</span>
                </td>
                <td className="nowrap right">
                  <span className="num">
                    <ReturnText value={opt?.ann_1y ?? line?.ann1y ?? null} />
                  </span>
                </td>
                <td className="nowrap right">
                  <span className="num">
                    <ReturnText value={opt?.ann_3y ?? line?.ann3y ?? null} />
                  </span>
                </td>
                {years.map((y) => {
                  const yr = line?.calendars.find((c) => c.year === y);
                  return (
                    <td key={y} className="nowrap right">
                      <span className="num">
                        <ReturnText value={yr?.returnPct ?? null} />
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading && years.length === 0 && (
        <p className="t-caption mt-2 text-[var(--color-ink-mute)]">
          Computing calendar-year returns from Morningstar series…
        </p>
      )}
    </div>
  );
}

// ---------------- rule-based descriptions ----------------

function describePortfolio(
  enriched: { weight: number; option: FundOption | null }[],
  sector: { label: string; weight_pct: number }[],
  geo: { label: string; weight_pct: number }[],
): string {
  if (enriched.length === 0) return "—";
  let equity = 0,
    fixed = 0,
    alloc = 0;
  for (const h of enriched) {
    const cls = (h.option?.asset_class ?? "").toLowerCase();
    if (cls.includes("equity")) equity += h.weight;
    else if (cls.includes("fixed")) fixed += h.weight;
    else if (cls.includes("allocation")) alloc += h.weight;
  }
  const equityPct = equity * 100;
  const fixedPct = fixed * 100;
  const allocPct = alloc * 100;
  let tilt: string;
  if (equityPct + allocPct * 0.6 >= 70) tilt = "Equity-led";
  else if (equityPct + allocPct * 0.6 >= 40) tilt = "Balanced";
  else if (fixedPct >= 50) tilt = "Income-tilted";
  else tilt = "Mixed";
  const top = geo[0];
  const concentration =
    top && top.weight_pct >= 50 ? `${top.label}-concentrated` : "globally diversified";
  const topSector = sector[0];
  const sectorHint =
    topSector && topSector.weight_pct >= 30 ? `, ${topSector.label.toLowerCase()}-heavy` : "";
  return `${tilt}, ${concentration} multi-asset portfolio${sectorHint}.`;
}

function describeSummary(
  geo: { label: string; weight_pct: number }[],
  ann3y: number | null,
  calendarReturns: { year: number; returnPct: number | null }[],
): string {
  const parts: string[] = [];
  const top = geo[0];
  if (top)
    parts.push(`This portfolio is most exposed to ${top.label} (${top.weight_pct.toFixed(0)}%)`);
  if (ann3y != null)
    parts.push(
      `has returned ${ann3y > 0 ? "+" : ""}${ann3y.toFixed(1)}% per year over the past 3 years`,
    );
  const valid = calendarReturns.filter((c) => c.returnPct != null) as {
    year: number;
    returnPct: number;
  }[];
  if (valid.length > 0) {
    const worst = valid.reduce((a, b) => (b.returnPct < a.returnPct ? b : a));
    parts.push(
      `with its weakest year being ${worst.year} at ${worst.returnPct > 0 ? "+" : ""}${worst.returnPct.toFixed(1)}%`,
    );
  }
  if (parts.length === 0) return "Insufficient performance history to summarise.";
  return parts.join(", ") + ".";
}

"use client";

import { useEffect, useState } from "react";
import { TrailingChart } from "./TrailingChart";
import type { ConfirmedPortfolio, ConfirmedPortfolioHolding } from "@/lib/db/queries";

type ChartData = {
  funds: { isin: string; name: string; weight: number; points: { d: string; v: number }[]; terminal: number }[];
  model: { points: { d: string; v: number }[]; terminal: number };
  commonStart: string;
  commonEnd: string;
  skipped: number;
};

type XRay = {
  expense?: number | null;
  risk?: number | null;
  r1y?: number | null;
  r3y?: number | null;
  r5y?: number | null;
  r10y?: number | null;
  equityCoverage?: number | null;
  geo?: { label: string; weight_pct: number }[];
  sector?: { label: string; weight_pct: number }[];
  holdings?: { label: string; weight_pct: number }[];
};

const CATEGORY_LABEL: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
  aggressive: "Aggressive",
  dividend_income: "Income",
};

function fmtPct(v: number | null | undefined, places = 2): { text: string; cls: string } {
  if (v == null) return { text: "—", cls: "text-[var(--color-ink-mute)]" };
  if (v === 0) return { text: "0.00%", cls: "text-[var(--color-ink)]" };
  const sign = v > 0 ? "+" : "−";
  const cls = v > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  return { text: `${sign}${Math.abs(v).toFixed(places)}%`, cls };
}

// Three-line editorial cell for the performance strip above the chart.
// Top eyebrow → big value (medium ink or semantic colour) → bottom eyebrow.
function PerformanceFact({
  label,
  value,
  valueCls,
  sublabel,
}: {
  label: string;
  value: string;
  valueCls?: string;
  sublabel: string;
}) {
  return (
    <div className="px-3 first:pl-0 last:pr-0">
      <p className="t-micro-cap mb-2">{label}</p>
      <p className={`num text-[20px] font-medium leading-none ${valueCls ?? "text-[var(--color-ink)]"}`}>{value}</p>
      <p className="t-micro-cap mt-2">{sublabel}</p>
    </div>
  );
}

function fmtSignedPct(v: number | null | undefined, places = 1): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(places)}%`;
}

function pctCls(v: number | null | undefined): string {
  if (v == null) return "text-[var(--color-ink-mute)]";
  if (v > 0) return "text-[var(--color-positive)]";
  if (v < 0) return "text-[var(--color-negative)]";
  return "text-[var(--color-ink)]";
}

// Year-end / prior-year-end annual returns from the chart's daily/weekly
// model.points series. The first year is always a partial year (anchored to
// the series' very first point), so we drop it — annual bars only show full
// calendar years.
export function computeAnnualReturns(
  points: { d: string; v: number }[],
): { year: number; return_pct: number; is_partial: boolean }[] {
  if (points.length < 2) return [];
  // Keep the last {d, v} per year so we know whether the year ran to December.
  const yearEnd = new Map<number, { d: string; v: number }>();
  for (const p of points) {
    const y = parseInt(p.d.slice(0, 4), 10);
    yearEnd.set(y, p);
  }
  const years = Array.from(yearEnd.keys()).sort((a, b) => a - b);
  const out: { year: number; return_pct: number; is_partial: boolean }[] = [];
  for (let i = 1; i < years.length; i++) {
    const y = years[i];
    const end = yearEnd.get(y)!;
    const start = yearEnd.get(years[i - 1])!;
    // A partial year is one whose last month is not December (or January of
    // the following year). Only affects the trailing bar in the chart.
    const is_partial = end.d.slice(5, 7) !== "12";
    out.push({ year: y, return_pct: (end.v / start.v - 1) * 100, is_partial });
  }
  return out;
}

// Annual-return bar chart — editorial. Central baseline, ink bars up for
// positive, negative-red down for losses. Square ends, value labels outside
// each bar, '15 / '16 / … tick labels on the x-axis.
export function AnnualReturnsBars({ data }: { data: { year: number; return_pct: number; is_partial: boolean }[] }) {
  if (data.length === 0) {
    return <p className="t-caption text-[var(--color-ink-mute)]">Not enough data to compute annual returns yet.</p>;
  }
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.return_pct)), 1);
  return (
    <div className="flex items-stretch gap-2 sm:gap-3">
      {data.map((d) => {
        const isPos = d.return_pct >= 0;
        const heightPct = (Math.abs(d.return_pct) / maxAbs) * 42;
        const yearLabel = d.is_partial ? "YTD" : `'${(d.year % 100).toString().padStart(2, "0")}`;
        const isZero = Math.abs(d.return_pct) < 0.05;
        return (
          <div key={d.year} className="flex min-w-0 flex-1 flex-col items-stretch">
            <div className="relative w-full" style={{ height: "260px" }}>
              {/* Central baseline */}
              <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--color-hairline)]" aria-hidden />
              {/* Bar */}
              {!isZero && (
                <div
                  className={isPos ? "absolute left-0 right-0 bg-[var(--color-ink)]" : "absolute left-0 right-0 bg-[var(--color-negative)]"}
                  style={isPos ? { bottom: "50%", height: `${heightPct}%` } : { top: "50%", height: `${heightPct}%` }}
                />
              )}
              {/* Zero-return marker — short tick at the baseline */}
              {isZero && (
                <div
                  className="absolute bg-[var(--color-ink)]"
                  style={{ left: "18%", right: "18%", top: "calc(50% - 1px)", height: "2px" }}
                  aria-hidden
                />
              )}
              {/* Value label */}
              <p
                className={`absolute left-0 right-0 text-center t-caption num leading-none ${isPos ? "text-[var(--color-ink)]" : "text-[var(--color-negative)]"}`}
                style={
                  isPos
                    ? { bottom: `calc(50% + ${heightPct}% + 6px)` }
                    : { top: `calc(50% + ${heightPct}% + 6px)` }
                }
              >
                {isPos ? (isZero ? "+0.0" : `+${d.return_pct.toFixed(1)}`) : d.return_pct.toFixed(1)}
              </p>
            </div>
            <p className="num t-caption mt-2 text-center text-[var(--color-ink-mute)]">{yearLabel}</p>
          </div>
        );
      })}
    </div>
  );
}

// Editorial bar — 2px hairline-thin, monochrome ink fill on hairline-2 track,
// no rounding. Reads as a sparkline, not a chart. Exported so the /switch
// portfolio summary can reuse it.
export function BarsRow({
  items,
}: {
  items: { label: string; weight_pct: number }[];
}) {
  const max = items.length > 0 ? items[0].weight_pct : 1;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((a) => (
        <li key={a.label} className="flex items-center gap-3">
          <span className="t-body-md w-32 shrink-0 truncate text-[var(--color-ink-2)]" title={a.label}>
            {a.label}
          </span>
          <span className="relative h-[2px] flex-1 bg-[var(--color-hairline-2)]">
            <span
              className="absolute inset-y-0 left-0 bg-[var(--color-ink)]"
              style={{
                width: `${Math.max(1, Math.min(100, (a.weight_pct / max) * 100)).toFixed(1)}%`,
              }}
            />
          </span>
          <span className="num w-14 shrink-0 text-right text-[12px] text-[var(--color-ink)]">
            {a.weight_pct.toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PortfolioDetail({
  portfolio,
  holdings,
}: {
  portfolio: ConfirmedPortfolio;
  holdings: ConfirmedPortfolioHolding[];
}) {
  const xray: XRay = (() => {
    try {
      return portfolio.xray_json ? (JSON.parse(portfolio.xray_json) as XRay) : {};
    } catch {
      return {};
    }
  })();

  const [chart, setChart] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);

  async function fetchChart() {
    setChartLoading(true);
    setChartError(null);
    try {
      const components = holdings
        .map((h) =>
          h.isin
            ? { isin: h.isin, weight: h.weight_bps / 10000, name: h.name }
            : null,
        )
        .filter((c): c is { isin: string; weight: number; name: string } => c !== null);
      if (components.length === 0) throw new Error("No holdings have an ISIN to chart.");
      const res = await fetch("/api/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setChart(data as ChartData);
    } catch (e) {
      setChartError((e as Error).message);
    } finally {
      setChartLoading(false);
    }
  }

  // Auto-fetch the chart on mount so the detail page loads with the analysis ready.
  useEffect(() => {
    fetchChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ending value assumes the 10Y CAGR compounded from S$100. Same conceit as
  // PhillipCapital's "S$348.65 grown from S$100" hero metric.
  const endingFrom100 =
    xray.r10y != null ? (100 * Math.pow(1 + xray.r10y / 100, 10)).toFixed(2) : null;
  const r10yCls =
    xray.r10y != null && xray.r10y > 0
      ? "text-[var(--color-positive)]"
      : xray.r10y != null && xray.r10y < 0
        ? "text-[var(--color-negative)]"
        : "text-[var(--color-ink-mute)]";

  // Performance strip — computed once, reused by the cells above the chart
  // and the Annual Total Returns chart below.
  const annualReturns =
    chart && chart.model.points.length >= 2
      ? computeAnnualReturns(chart.model.points)
      : [];
  // Best / worst only makes sense across full calendar years; a partial
  // (year-to-date) bar would otherwise dominate when it happens to lead
  // or lag the rest of the record.
  const fullYearReturns = annualReturns.filter((r) => !r.is_partial);
  const bestYearReturn = fullYearReturns.length
    ? fullYearReturns.reduce((a, b) => (a.return_pct > b.return_pct ? a : b))
    : null;
  const worstYearReturn = fullYearReturns.length
    ? fullYearReturns.reduce((a, b) => (a.return_pct < b.return_pct ? a : b))
    : null;
  const endYear = chart ? parseInt(chart.commonEnd.slice(0, 4), 10) : null;
  const rangeLabel = (yearsBack: number): string =>
    endYear ? `${endYear - yearsBack} - ${endYear}` : "—";

  return (
    <>
      <header className="mt-5">
        {/* Eyebrow — provider · category · risk */}
        <div className="mb-4 flex items-center gap-2.5">
          <span className="inline-block h-2.5 w-2.5 bg-[var(--color-primary)]" aria-hidden />
          <p className="t-micro-cap">
            {portfolio.provider_name.toUpperCase()} <span className="mx-1.5 text-[var(--color-hairline)]">·</span>{" "}
            {(CATEGORY_LABEL[portfolio.category] ?? portfolio.category).toUpperCase()}
            {xray.risk != null && (
              <>
                {" "}
                <span className="mx-1.5 text-[var(--color-hairline)]">·</span> RISK{" "}
                {Number.isInteger(xray.risk) ? xray.risk.toFixed(0) : xray.risk.toFixed(1)}/5
              </>
            )}
          </p>
        </div>

        {/* Title + hero KPI */}
        <div className="flex flex-wrap-reverse items-end justify-between gap-x-8 gap-y-4">
          <h1
            className="font-medium leading-[0.95] text-[var(--color-ink)] text-[40px] sm:text-[48px]"
            style={{ letterSpacing: "-0.02em" }}
          >
            {portfolio.name}
          </h1>
          {xray.r10y != null && (
            <div className="text-right">
              <p className="font-medium leading-[0.9]">
                <span
                  className="num text-[var(--color-ink)] text-[48px] sm:text-[56px]"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  {Math.round(xray.r10y)}
                </span>
                <span
                  className={`text-[24px] sm:text-[28px] ${r10yCls}`}
                  style={{ letterSpacing: "-0.02em" }}
                >
                  %
                </span>
              </p>
              <p className="t-micro-cap mt-2.5">10-year annualised total return</p>
            </div>
          )}
        </div>

        {portfolio.notes && (
          <p className="mt-5 t-body-md italic text-[var(--color-ink-2)]">&ldquo;{portfolio.notes}&rdquo;</p>
        )}
      </header>

      {/* Performance strip — 7 cells above the chart */}
      <section className="mt-8 mb-4 grid grid-cols-2 gap-y-5 divide-x divide-[var(--color-hairline-2)] border-y border-[var(--color-hairline)] py-5 sm:grid-cols-4 md:grid-cols-7">
        <PerformanceFact
          label="1-Year"
          value={fmtSignedPct(xray.r1y)}
          valueCls={pctCls(xray.r1y)}
          sublabel={endYear ? `Cal. ${endYear}` : "—"}
        />
        <PerformanceFact
          label="3-YR Ann."
          value={fmtSignedPct(xray.r3y)}
          valueCls={pctCls(xray.r3y)}
          sublabel={rangeLabel(2)}
        />
        <PerformanceFact
          label="5-YR Ann."
          value={fmtSignedPct(xray.r5y)}
          valueCls={pctCls(xray.r5y)}
          sublabel={rangeLabel(4)}
        />
        <PerformanceFact
          label="10-YR Ann."
          value={fmtSignedPct(xray.r10y)}
          valueCls={pctCls(xray.r10y)}
          sublabel={rangeLabel(9)}
        />
        <PerformanceFact
          label="Best Year"
          value={bestYearReturn ? fmtSignedPct(bestYearReturn.return_pct) : "—"}
          valueCls={bestYearReturn ? pctCls(bestYearReturn.return_pct) : ""}
          sublabel="Calendar"
        />
        <PerformanceFact
          label="Worst Year"
          value={worstYearReturn ? fmtSignedPct(worstYearReturn.return_pct) : "—"}
          valueCls={worstYearReturn ? pctCls(worstYearReturn.return_pct) : ""}
          sublabel="Calendar"
        />
        <PerformanceFact
          label="OCF"
          value={xray.expense != null ? `${xray.expense.toFixed(3)}%` : "—"}
          sublabel="Blended p.a."
        />
      </section>

      {/* Trailing performance — hero card */}
      <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div>
            <p className="t-body-lg font-medium text-[var(--color-ink)]">
              Price Performance &middot; Growth of 100
            </p>
            <p className="t-micro-cap mt-1">Net of OCF · Fund-currency basis</p>
          </div>
          <div className="flex items-start gap-6">
            {endingFrom100 != null && (
              <div>
                <p className="num text-[20px] font-medium leading-none text-[var(--color-ink)]">
                  {endingFrom100}
                </p>
                <p className="t-micro-cap mt-1.5">Ending value</p>
              </div>
            )}
            {xray.r10y != null && (
              <div>
                <p className={`num text-[20px] font-medium leading-none ${r10yCls}`}>
                  {xray.r10y > 0 ? "+" : ""}
                  {xray.r10y.toFixed(1)}%
                </p>
                <p className="t-micro-cap mt-1.5">CAGR</p>
              </div>
            )}
            <button
              onClick={fetchChart}
              disabled={chartLoading}
              className="btn-pill btn-ghost text-[12px] disabled:opacity-50"
            >
              {chartLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {chart ? (
          <TrailingChart {...chart} />
        ) : chartError ? (
          <div className="rounded-md border border-dashed border-[var(--color-hairline)] p-6 text-center">
            <p className="t-caption text-[var(--color-negative)]">{chartError}</p>
            <button onClick={fetchChart} className="btn-pill btn-ghost mt-3 text-[12px]">
              Retry
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-[var(--color-hairline)] p-8 text-center">
            <p className="t-body-md text-[var(--color-ink-mute)]">
              Pulling live Morningstar look-through for each component…
            </p>
          </div>
        )}
      </section>

      {/* Annual Returns + Instruments — side-by-side, equal-width columns */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="flex flex-col rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <div className="mb-5 flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] pb-3">
            <p className="t-body-lg font-medium text-[var(--color-ink)]">Annual Total Returns</p>
            <p className="t-micro-cap">% per annum</p>
          </div>
          {annualReturns.length >= 2 ? (
            <AnnualReturnsBars data={annualReturns} />
          ) : (
            <div className="flex min-h-[260px] flex-1 items-center justify-center">
              <p className="t-caption text-[var(--color-ink-mute)]">
                {chartLoading ? "Computing annual returns…" : chartError ? "Unavailable" : "—"}
              </p>
            </div>
          )}
        </section>

        <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3 flex-wrap">
            <p className="t-body-lg font-medium text-[var(--color-ink)]">Instruments</p>
            <p className="t-micro-cap">Mandate constituents</p>
          </div>
          <table className="table-pro table-pro-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "36%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Instrument</th>
                <th className="right">Weight</th>
                <th className="right">1Y</th>
                <th className="right">3Y</th>
                <th className="right">5Y</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const r1 = fmtPct(h.ann_1y);
                const r3 = fmtPct(h.ann_3y);
                const r5 = fmtPct(h.ann_5y);
                return (
                  <tr key={h.fund_id}>
                    <td className="cell-fund">
                      <span
                        className="name text-[var(--color-ink)]"
                        title={h.name}
                        style={{
                          whiteSpace: "normal",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          fontSize: "13px",
                        }}
                      >
                        {h.name}
                      </span>
                      <span className="meta">{h.isin ?? h.external_id}</span>
                    </td>
                    <td className="nowrap right">
                      <span className="num text-[var(--color-ink)]">{(h.weight_bps / 100).toFixed(2)}%</span>
                    </td>
                    <td className="nowrap right"><span className={`num ${r1.cls}`}>{r1.text}</span></td>
                    <td className="nowrap right"><span className={`num ${r3.cls}`}>{r3.text}</span></td>
                    <td className="nowrap right"><span className={`num ${r5.cls}`}>{r5.text}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      {/* Sector + Geographic — two-column */}
      {((xray.sector?.length ?? 0) > 0 || (xray.geo?.length ?? 0) > 0) && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {xray.sector && xray.sector.length > 0 && (
            <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <p className="t-body-lg font-medium text-[var(--color-ink)]">Sector allocation</p>
                <p className="t-micro-cap">Equity sleeve</p>
              </div>
              <BarsRow items={xray.sector.slice(0, 11)} />
            </section>
          )}
          {xray.geo && xray.geo.length > 0 && (
            <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <p className="t-body-lg font-medium text-[var(--color-ink)]">Geographic allocation</p>
                <p className="t-micro-cap">Equity sleeve</p>
              </div>
              <BarsRow items={xray.geo.slice(0, 11)} />
            </section>
          )}
        </div>
      )}

      {/* Top 10 look-through holdings */}
      {xray.holdings && xray.holdings.length > 0 && (
        <section className="mt-4 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
            <p className="t-body-lg font-medium text-[var(--color-ink)]">Top 10 look-through holdings</p>
            <p className="t-micro-cap">Sleeve-weighted</p>
          </div>
          <table className="table-pro" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "8%" }} />
              <col style={{ width: "72%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Holding</th>
                <th className="right">Portfolio weight</th>
              </tr>
            </thead>
            <tbody>
              {xray.holdings.map((h, i) => (
                <tr key={h.label}>
                  <td className="nowrap">
                    <span className="num text-[var(--color-ink-mute)]">{i + 1}</span>
                  </td>
                  <td className="cell-fund">
                    <span className="name text-[var(--color-ink)]" title={h.label}>{h.label}</span>
                  </td>
                  <td className="nowrap right">
                    <span className="num text-[var(--color-ink)]">{h.weight_pct.toFixed(2)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

    </>
  );
}

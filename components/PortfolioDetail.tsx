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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="t-micro-cap mb-1.5">{label}</p>
      <p className="num text-[26px] font-medium leading-none text-[var(--color-ink)]">{value}</p>
    </div>
  );
}

// Editorial bar — 2px hairline-thin, monochrome ink fill on hairline-2 track,
// no rounding. Reads as a sparkline, not a chart.
function BarsRow({
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

  // Derived facts for the mandate strip + hero.
  const equityPct = xray.equityCoverage != null ? Math.round(xray.equityCoverage * 100) : null;
  // Fixed Income is an approximation: 100 − equity. Cash/alts get lumped in.
  const fixedIncomeApprox = equityPct != null ? Math.max(0, 100 - equityPct) : null;
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

  return (
    <>
      <header className="mt-6">
        {/* Eyebrow — provider · category · risk */}
        <div className="mb-6 flex items-center gap-2.5">
          <span className="inline-block h-2.5 w-2.5 bg-[var(--color-primary)]" aria-hidden />
          <p className="t-micro-cap">
            {portfolio.provider_name.toUpperCase()} <span className="mx-1.5 text-[var(--color-hairline)]">·</span>{" "}
            {(CATEGORY_LABEL[portfolio.category] ?? portfolio.category).toUpperCase()}
            {xray.risk != null && (
              <>
                {" "}
                <span className="mx-1.5 text-[var(--color-hairline)]">·</span> RISK{" "}
                {Math.round(xray.risk)}/5
              </>
            )}
          </p>
        </div>

        {/* Title + hero KPI */}
        <div className="flex flex-wrap-reverse items-end justify-between gap-x-8 gap-y-4">
          <h1
            className="font-medium leading-[0.95] text-[var(--color-ink)] text-[56px] sm:text-[64px]"
            style={{ letterSpacing: "-0.025em" }}
          >
            {portfolio.name}
          </h1>
          {xray.r10y != null && (
            <div className="text-right">
              <p className="font-medium leading-[0.9]">
                <span
                  className="num text-[var(--color-ink)] text-[60px] sm:text-[72px]"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  {Math.round(xray.r10y)}
                </span>
                <span
                  className={`text-[28px] sm:text-[34px] ${r10yCls}`}
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

      {/* Mandate facts strip */}
      <section className="mt-8 mb-10 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-[var(--color-hairline)] pt-6 sm:grid-cols-4">
        <Fact label="Equity" value={equityPct != null ? `${equityPct}%` : "—"} />
        <Fact label="Fixed Income" value={fixedIncomeApprox != null ? `${fixedIncomeApprox}%` : "—"} />
        <Fact
          label="OCF P.A."
          value={xray.expense != null ? `${xray.expense.toFixed(3)}%` : "—"}
        />
        <Fact label="Funds" value={`${holdings.length}`} />
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

      {/* Instruments — moved to the bottom, the constituent funds */}
      <section className="mt-4 overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3">
          <p className="t-body-lg font-medium text-[var(--color-ink)]">Instruments</p>
          <p className="t-micro-cap">Mandate constituents</p>
        </div>
        <table className="table-pro" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "48%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Instrument</th>
              <th className="right">Weight %</th>
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
                    <span className="name text-[var(--color-ink)]" title={h.name}>{h.name}</span>
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
    </>
  );
}

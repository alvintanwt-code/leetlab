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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function fmtPct(v: number | null | undefined, places = 2): { text: string; cls: string } {
  if (v == null) return { text: "—", cls: "text-[var(--color-ink-mute)]" };
  if (v === 0) return { text: "0.00%", cls: "text-[var(--color-ink)]" };
  const sign = v > 0 ? "+" : "−";
  const cls = v > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  return { text: `${sign}${Math.abs(v).toFixed(places)}%`, cls };
}

function KpiTile({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <p className={`num t-display-md leading-none ${valueCls ?? "text-[var(--color-ink)]"}`}>{value}</p>
      <p className="t-micro-cap mt-2 text-[10px]">{label}</p>
    </div>
  );
}

function BarsRow({
  items,
  color,
}: {
  items: { label: string; weight_pct: number }[];
  color: string;
}) {
  const max = items.length > 0 ? items[0].weight_pct : 1;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((a) => (
        <li key={a.label} className="flex items-center gap-3">
          <span className="t-body-md w-32 shrink-0 truncate text-[var(--color-ink-2)]" title={a.label}>
            {a.label}
          </span>
          <span className="relative h-3.5 flex-1 overflow-hidden rounded-sm bg-[var(--color-canvas-soft)]">
            <span
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{
                width: `${Math.max(1, Math.min(100, (a.weight_pct / max) * 100)).toFixed(1)}%`,
                background: color,
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

  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0);
  const totalPct = totalBps / 100;
  const equityCoveragePct =
    xray.equityCoverage != null ? Math.round(xray.equityCoverage * 100) : null;

  return (
    <>
      <header className="mt-4 mb-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="t-micro-cap mb-2">{CATEGORY_LABEL[portfolio.category] ?? portfolio.category}</p>
            <h1 className="t-display-md text-[var(--color-ink)]">{portfolio.name}</h1>
            <p className="t-body-md mt-2 text-[var(--color-ink-mute)]">
              {portfolio.provider_name} &middot; v<span className="num">{portfolio.version}</span> &middot;{" "}
              {portfolio.holding_count} fund{portfolio.holding_count === 1 ? "" : "s"} &middot;{" "}
              confirmed {fmtDate(portfolio.confirmed_at)} &middot; weights{" "}
              <span className="num">{totalPct.toFixed(2)}%</span>
              {totalBps === 10000 ? " ✓" : ""}
            </p>
          </div>
          <span className="tag tag-primary whitespace-nowrap">Confirmed</span>
        </div>
        {portfolio.notes && (
          <p className="mt-4 t-body-md italic text-[var(--color-ink-2)]">&ldquo;{portfolio.notes}&rdquo;</p>
        )}
      </header>

      {/* Holdings table */}
      <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
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

      {/* X-ray — Weighted trailing returns KPIs */}
      <section className="mt-6 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
          <p className="t-micro-cap">Weighted trailing returns</p>
          <p className="t-caption text-[var(--color-ink-mute)]">
            arithmetic weight-average of component returns, as of confirmation
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-[var(--color-hairline-2)]">
          <KpiTile label="1Y" value={fmtPct(xray.r1y).text} valueCls={fmtPct(xray.r1y).cls} />
          <KpiTile label="3Y pa" value={fmtPct(xray.r3y).text} valueCls={fmtPct(xray.r3y).cls} />
          <KpiTile label="5Y pa" value={fmtPct(xray.r5y).text} valueCls={fmtPct(xray.r5y).cls} />
          <KpiTile label="10Y pa" value={fmtPct(xray.r10y).text} valueCls={fmtPct(xray.r10y).cls} />
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-[var(--color-hairline-2)] border-t border-[var(--color-hairline-2)] pt-4">
          <KpiTile
            label="Expense"
            value={xray.expense != null ? `${xray.expense.toFixed(2)}%` : "—"}
          />
          <KpiTile
            label="Risk score"
            value={xray.risk != null ? `${xray.risk.toFixed(1)} / 5` : "—"}
          />
          <KpiTile
            label="Equity coverage"
            value={equityCoveragePct != null ? `${equityCoveragePct}%` : "—"}
          />
          <KpiTile label="Holdings" value={`${holdings.length}`} />
        </div>
      </section>

      {/* Sector + Geographic — two-column */}
      {((xray.sector?.length ?? 0) > 0 || (xray.geo?.length ?? 0) > 0) && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {xray.sector && xray.sector.length > 0 && (
            <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <p className="t-micro-cap">Sector allocation</p>
                <p className="t-caption text-[var(--color-ink-mute)]">
                  equity sleeve &middot;{" "}
                  <span className="num">{equityCoveragePct ?? 0}%</span> of portfolio is equity
                </p>
              </div>
              <BarsRow items={xray.sector.slice(0, 11)} color="var(--color-primary)" />
            </section>
          )}
          {xray.geo && xray.geo.length > 0 && (
            <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <p className="t-micro-cap">Geographic allocation</p>
                <p className="t-caption text-[var(--color-ink-mute)]">equity sleeve, by domicile region</p>
              </div>
              <BarsRow items={xray.geo.slice(0, 11)} color="#946638" />
            </section>
          )}
        </div>
      )}

      {/* Top 10 look-through holdings */}
      {xray.holdings && xray.holdings.length > 0 && (
        <section className="mt-4 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
            <p className="t-micro-cap">Top 10 look-through holdings</p>
            <p className="t-caption text-[var(--color-ink-mute)]">
              weight &times; position, across all components
            </p>
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

      {/* Trailing performance chart */}
      <section className="mt-4 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
          <p className="t-micro-cap">Trailing performance &middot; growth of 100</p>
          <button
            onClick={fetchChart}
            disabled={chartLoading}
            className="btn-pill btn-ghost text-[12px] disabled:opacity-50"
          >
            {chartLoading ? "Loading…" : "Refresh"}
          </button>
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
    </>
  );
}

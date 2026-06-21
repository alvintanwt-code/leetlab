import Link from "next/link";
import type { ConfirmedPortfolio } from "@/lib/db/queries";
import type { AssetChip, PortfolioXray } from "@/lib/portfolio-derive";
import type { BlendedSeries } from "@/lib/portfolio-performance";
import { CATEGORY_LABELS, PORTFOLIO_MANDATES } from "@/lib/portfolio-mandates";

const PROVIDER_SHORT: Record<string, string> = {
  hsbc: "HSBC Life",
  tmls: "Tokio Marine",
  fwd: "FWD",
  gwm: "GWM",
};

export type PortfolioCardData = {
  portfolio: ConfirmedPortfolio;
  assetMix: AssetChip[];
  xray: PortfolioXray | null;
  risk: number | null;
  series: BlendedSeries;
  yieldPct: number | null;
};

// ---------------- shared subcomponents ----------------

function ReturnText({ value }: { value: number | null | undefined }) {
  if (value == null || Number.isNaN(value)) return <span className="text-[var(--color-ink-mute)]">—</span>;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value).toFixed(1);
  const cls = value > 0 ? "text-[var(--color-positive)]" : value < 0 ? "text-[var(--color-negative)]" : "text-[var(--color-ink)]";
  return (
    <span className={cls}>
      {sign}
      {abs}%
    </span>
  );
}

function PctText({ value, places = 2 }: { value: number | null | undefined; places?: number }) {
  if (value == null || Number.isNaN(value)) return <span className="text-[var(--color-ink-mute)]">—</span>;
  return <span className="text-[var(--color-ink)]">{value.toFixed(places)}%</span>;
}

function RiskText({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[var(--color-ink-mute)]">—/6</span>;
  return (
    <span className="text-[var(--color-ink)]">
      {Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}
      <span className="text-[var(--color-ink-mute)]">/6</span>
    </span>
  );
}

function MiniChart({ series, width, height }: { series: BlendedSeries; width: number; height: number }) {
  if (!series || series.points.length < 3) {
    return (
      <div
        className="flex items-center justify-center border border-dashed border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)]"
        style={{ width, height }}
      >
        <p className="t-micro-cap">No history</p>
      </div>
    );
  }
  const pts = series.points;
  const values = pts.map((p) => p.v);
  let mn = Math.min(...values);
  let mx = Math.max(...values);
  const pad = (mx - mn) * 0.08 || 2;
  mn -= pad;
  mx += pad;
  const PAD_X = 2;
  const PAD_Y = 4;
  const X = (i: number) => PAD_X + ((width - PAD_X * 2) * i) / Math.max(1, pts.length - 1);
  const Y = (v: number) => PAD_Y + (height - PAD_Y * 2) * (1 - (v - mn) / (mx - mn || 1));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const baseY = Y(100);
  const showBaseline = baseY > PAD_Y && baseY < height - PAD_Y;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height }}
      role="img"
      aria-label="3-year blended performance"
    >
      {showBaseline && (
        <line x1={PAD_X} x2={width - PAD_X} y1={baseY} y2={baseY} stroke="var(--color-hairline-2)" strokeDasharray="2 2" />
      )}
      <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="t-micro-cap">{label}</p>
      <p className="num mt-1.5 text-[14px] font-medium leading-none tabular-nums">{children}</p>
    </div>
  );
}

function AssetChips({ chips }: { chips: AssetChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span key={c.label} className="tag">
          <span className="num mr-1 font-medium tabular-nums text-[var(--color-ink)]">{c.pct}</span>
          <span className="uppercase tracking-wide">{c.label}</span>
        </span>
      ))}
    </div>
  );
}

// ---------------- card view (2-up) ----------------

export function PortfolioCard({ data }: { data: PortfolioCardData }) {
  const { portfolio, assetMix, xray, risk, series, yieldPct } = data;
  const mandate = PORTFOLIO_MANDATES[portfolio.category];
  const title = `${PROVIDER_SHORT[portfolio.provider_slug] ?? portfolio.provider_name} ${CATEGORY_LABELS[portfolio.category] ?? portfolio.category}`;
  const isIncome = portfolio.category === "dividend_income";

  return (
    <Link
      href={`/portfolios/${portfolio.id}`}
      className="group block rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-6 transition-colors hover:border-[var(--color-ink)]"
    >
      <AssetChips chips={assetMix} />

      <h2 className="mt-4 text-[20px] font-medium leading-tight tracking-[-0.01em] text-[var(--color-ink)]">
        {title}
      </h2>
      {mandate && (
        <>
          <p className="t-body-md mt-1 text-[var(--color-ink-2)]">{mandate.tagline}</p>
          <p className="t-body-md mt-3 leading-[1.55] text-[var(--color-ink-mute)]">
            {mandate.objective} {mandate.suitability}
          </p>
        </>
      )}

      <p className="t-micro-cap mt-4">
        <span className="num">{portfolio.holding_count}</span> {portfolio.holding_count === 1 ? "fund" : "funds"}
        <span className="mx-1.5 text-[var(--color-hairline)]">·</span>
        Risk <span className="num text-[var(--color-ink)]"><RiskText value={risk} /></span>
      </p>

      <div className="mt-5 grid grid-cols-[1fr_auto] items-center gap-6 border-t border-[var(--color-hairline-2)] pt-5">
        <MiniChart series={series} width={300} height={86} />
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Kpi label="3Y ann."><ReturnText value={xray?.r3y ?? null} /></Kpi>
          <Kpi label="OCF p.a."><PctText value={xray?.expense ?? null} /></Kpi>
          <Kpi label={isIncome ? "Yield p.a." : "Dividends"}>
            {isIncome ? <PctText value={yieldPct} /> : <span className="text-[var(--color-ink-mute)]">—</span>}
          </Kpi>
          <Kpi label="Funds"><span className="text-[var(--color-ink)]">{portfolio.holding_count}</span></Kpi>
        </div>
      </div>
    </Link>
  );
}

// ---------------- row view ----------------

export function PortfolioRow({ data }: { data: PortfolioCardData }) {
  const { portfolio, assetMix, xray, risk, series, yieldPct } = data;
  const mandate = PORTFOLIO_MANDATES[portfolio.category];
  const title = `${PROVIDER_SHORT[portfolio.provider_slug] ?? portfolio.provider_name} ${CATEGORY_LABELS[portfolio.category] ?? portfolio.category}`;
  const isIncome = portfolio.category === "dividend_income";

  return (
    <Link
      href={`/portfolios/${portfolio.id}`}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-8 border-b border-[var(--color-hairline-2)] px-1 py-5 last:border-b-0 transition-colors hover:bg-[var(--color-canvas-soft)]"
    >
      {/* Left — chips + title + mandate */}
      <div className="min-w-0">
        <AssetChips chips={assetMix} />
        <h3 className="mt-2 text-[17px] font-medium leading-tight tracking-[-0.005em] text-[var(--color-ink)]">
          {title}
        </h3>
        {mandate && (
          <p className="t-body-md mt-1 truncate text-[var(--color-ink-mute)]">{mandate.tagline}</p>
        )}
        <p className="t-micro-cap mt-2">
          <span className="num">{portfolio.holding_count}</span> {portfolio.holding_count === 1 ? "fund" : "funds"}
          <span className="mx-1.5 text-[var(--color-hairline)]">·</span>
          Risk <RiskText value={risk} />
        </p>
      </div>

      {/* Middle — sparkline */}
      <MiniChart series={series} width={140} height={48} />

      {/* Right — 4 KPI strip */}
      <div className="grid grid-cols-4 gap-x-6">
        <Kpi label="3Y ann."><ReturnText value={xray?.r3y ?? null} /></Kpi>
        <Kpi label="OCF p.a."><PctText value={xray?.expense ?? null} /></Kpi>
        <Kpi label={isIncome ? "Yield p.a." : "Dividends"}>
          {isIncome ? <PctText value={yieldPct} /> : <span className="text-[var(--color-ink-mute)]">—</span>}
        </Kpi>
        <Kpi label="Funds"><span className="text-[var(--color-ink)]">{portfolio.holding_count}</span></Kpi>
      </div>
    </Link>
  );
}

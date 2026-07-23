"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FundInspectorData, AllocationDetail } from "@/lib/db/queries";
import {
  AnnualReturnsBars,
  BarsRow,
  computeAnnualReturns,
} from "@/components/PortfolioDetail";
import { TrailingChart } from "@/components/TrailingChart";

// Step-2 page after the picker. Renders the same elements as the model
// portfolio detail page, with two key differences at the top: an editable
// "Model Portfolio Builder" instrument table (half-width) and an Asset
// Allocation panel beside it (donut + asset-class % table). The rest of the
// page follows the model portfolio layout — performance strip, trailing
// chart, annual returns, sector + geographic allocation.

type Holding = { fundId: number; weightBps: number };
type ChartData = {
  funds: { isin: string; name: string; weight: number; points: { d: string; v: number }[]; terminal: number }[];
  model: { points: { d: string; v: number }[]; terminal: number };
  commonStart: string;
  commonEnd: string;
  skipped: number;
};

const CATEGORIES = [
  { key: "conservative", label: "Conservative" },
  { key: "balanced", label: "Balanced" },
  { key: "growth", label: "Growth" },
  { key: "aggressive", label: "Aggressive" },
  { key: "dividend_income", label: "Dividend income" },
] as const;
type CategoryKey = (typeof CATEGORIES)[number]["key"];

type ClassKey = "E" | "F" | "A" | "L" | "C" | "M";
const CLASS_LABEL: Record<ClassKey, string> = {
  E: "Equity",
  F: "Fixed income",
  A: "Multi-asset",
  L: "Alternative",
  C: "Commodities",
  M: "Cash",
};
// Same palette as the chip-asset CSS chips so the donut visually agrees with
// the asset chips elsewhere in the workspace.
const CLASS_COLOR: Record<ClassKey, string> = {
  E: "#0e6d44",
  F: "#1b5fb5",
  A: "var(--color-primary-deep)",
  L: "#8a5c2e",
  C: "#b87509",
  M: "#7c8696",
};
function classKey(assetClass: string | null): ClassKey {
  if (!assetClass) return "M";
  const s = assetClass.toLowerCase();
  if (s.includes("equity")) return "E";
  if (s.includes("fixed") || s.includes("bond")) return "F";
  if (s.includes("allocation") || s.includes("multi")) return "A";
  if (s.includes("alt")) return "L";
  if (s.includes("commod")) return "C";
  if (s.includes("money") || s.includes("cash")) return "M";
  return "M";
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

// ---------------- main component ----------------

export function BuildReview({
  providerSlug,
  providerName,
  funds,
  allocations,
}: {
  providerSlug: string;
  providerName: string;
  funds: FundInspectorData[];
  allocations: AllocationDetail[];
}) {
  const router = useRouter();
  const fundsById = useMemo(() => new Map(funds.map((f) => [f.id, f])), [funds]);
  const allocsByFund = useMemo(() => {
    const m = new Map<number, AllocationDetail[]>();
    for (const a of allocations) {
      if (!m.has(a.fund_id)) m.set(a.fund_id, []);
      m.get(a.fund_id)!.push(a);
    }
    return m;
  }, [allocations]);

  const [basket, setBasket] = useState<Holding[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [focusedWeightId, setFocusedWeightId] = useState<number | null>(null);

  // Save-build modal state — same fields as the StudioShell wizard.
  const [showSave, setShowSave] = useState(false);
  const [saveCategory, setSaveCategory] = useState<CategoryKey>("balanced");
  const [saveName, setSaveName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed from the picker's sessionStorage drop. Equal-weights on mount; we
  // keep the storage key so Edit-inputs preserves the staged selection.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`build-picker:v1:${providerSlug}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { ids?: number[] };
        const ids = (parsed.ids ?? []).filter((id) => fundsById.has(id));
        if (ids.length > 0) {
          const each = Math.floor(10000 / ids.length);
          const remainder = 10000 - each * ids.length;
          setBasket(ids.map((id, i) => ({ fundId: id, weightBps: each + (i === 0 ? remainder : 0) })));
        }
      }
    } catch {
      // bad payload — leave basket empty
    }
    setHydrated(true);
  }, [providerSlug, fundsById]);

  function setWeight(fundId: number, pct: number) {
    const bps = Math.max(0, Math.round(pct * 100));
    setBasket((prev) => prev.map((h) => (h.fundId === fundId ? { ...h, weightBps: bps } : h)));
  }
  function distributeEvenly() {
    if (basket.length === 0) return;
    const each = Math.floor(10000 / basket.length);
    const remainder = 10000 - each * basket.length;
    setBasket((prev) => prev.map((h, i) => ({ ...h, weightBps: each + (i === 0 ? remainder : 0) })));
  }

  // Total weight + asset-class mix.
  const totalBps = basket.reduce((s, h) => s + h.weightBps, 0);
  const totalPct = totalBps / 100;

  const assetMix = useMemo(() => {
    const buckets: Record<ClassKey, number> = { E: 0, F: 0, A: 0, L: 0, C: 0, M: 0 };
    for (const h of basket) {
      const f = fundsById.get(h.fundId);
      if (!f) continue;
      const w = h.weightBps / 100; // percentage points
      buckets[classKey(f.asset_class)] += w;
    }
    return (Object.entries(buckets) as [ClassKey, number][])
      .map(([key, pct]) => ({ key, pct }))
      .filter((b) => b.pct > 0.05)
      .sort((a, b) => b.pct - a.pct);
  }, [basket, fundsById]);

  // Portfolio x-ray — equity coverage, weighted returns, sector + geo + risk
  // + look-through top holdings.
  const xray = useMemo(() => {
    if (basket.length === 0) return null;
    let expense = 0, r1y = 0, r3y = 0, r5y = 0, r10y = 0, risk = 0;
    let covEx = 0, cov1y = 0, cov3y = 0, cov5y = 0, cov10y = 0, covRisk = 0;
    let equityCoverage = 0;
    const aggGeo: Record<string, number> = {};
    const aggSector: Record<string, number> = {};
    const aggHoldings: Record<string, number> = {};

    for (const h of basket) {
      const w = h.weightBps / 10000;
      const f = fundsById.get(h.fundId);
      if (!f) continue;
      if (f.expense_ratio != null) { expense += w * f.expense_ratio; covEx += w; }
      if (f.ann_1y != null) { r1y += w * f.ann_1y; cov1y += w; }
      if (f.ann_3y != null) { r3y += w * f.ann_3y; cov3y += w; }
      if (f.ann_5y != null) { r5y += w * f.ann_5y; cov5y += w; }
      if (f.ann_10y != null) { r10y += w * f.ann_10y; cov10y += w; }
      if (f.risk_rating != null) { risk += w * f.risk_rating; covRisk += w; }
      const allocs = allocsByFund.get(f.id) ?? [];
      const stockAlloc = allocs.find((a) => a.kind === "asset" && /stock/i.test(a.label));
      const equityShare = stockAlloc
        ? stockAlloc.weight_pct / 100
        : f.asset_class?.toLowerCase().includes("equity") ? 1 : 0;
      equityCoverage += w * equityShare;
      for (const a of allocs) {
        if (a.kind === "geography") {
          aggGeo[a.label] = (aggGeo[a.label] ?? 0) + w * equityShare * a.weight_pct;
        } else if (a.kind === "sector") {
          aggSector[a.label] = (aggSector[a.label] ?? 0) + w * equityShare * a.weight_pct;
        } else if (a.kind === "holding") {
          // Filter garbled bond-fund holdings (impossible weight, or label is
          // a date fragment like "11/15/" from a parser split on a coupon %).
          if (
            a.weight_pct > 100 ||
            a.weight_pct < 0 ||
            /^\d+\/\d*\/?$/.test(a.label) ||
            a.label.length < 3
          ) continue;
          aggHoldings[a.label] = (aggHoldings[a.label] ?? 0) + w * a.weight_pct;
        }
      }
    }
    const sSec = Object.values(aggSector).reduce((a, b) => a + b, 0) || 1;
    const sGeo = Object.values(aggGeo).reduce((a, b) => a + b, 0) || 1;
    const sortedNorm = (agg: Record<string, number>, total: number) =>
      Object.entries(agg)
        .map(([label, w]) => ({ label, weight_pct: (w / total) * 100 }))
        .sort((a, b) => b.weight_pct - a.weight_pct);
    return {
      expense: covEx > 0 ? expense / covEx : null,
      risk: covRisk > 0 ? risk / covRisk : null,
      r1y: cov1y > 0 ? r1y / cov1y : null,
      r3y: cov3y > 0 ? r3y / cov3y : null,
      r5y: cov5y > 0 ? r5y / cov5y : null,
      r10y: cov10y > 0 ? r10y / cov10y : null,
      equityCoverage,
      geo: sortedNorm(aggGeo, sGeo),
      sector: sortedNorm(aggSector, sSec),
      holdings: Object.entries(aggHoldings)
        .map(([label, w]) => ({ label, weight_pct: w }))
        .sort((a, b) => b.weight_pct - a.weight_pct)
        .slice(0, 10),
    };
  }, [basket, fundsById, allocsByFund]);

  // Trailing chart — pulled from /api/performance whenever the basket settles.
  const [chart, setChart] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  async function fetchChart() {
    setChartLoading(true);
    setChartError(null);
    try {
      const components = basket
        .map((h) => {
          const f = fundsById.get(h.fundId);
          return f && f.isin ? { isin: f.isin, weight: h.weightBps / 10000, name: f.name } : null;
        })
        .filter((c): c is { isin: string; weight: number; name: string } => c !== null);
      if (components.length === 0) throw new Error("None of the basket components have an ISIN to chart.");
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

  // Auto-fetch once the basket is hydrated; refresh when weights change.
  useEffect(() => {
    if (!hydrated || basket.length === 0) return;
    fetchChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, basket]);

  const annualReturns =
    chart && chart.model.points.length >= 2 ? computeAnnualReturns(chart.model.points) : [];
  const endYear = chart ? parseInt(chart.commonEnd.slice(0, 4), 10) : null;
  const rangeLabel = (yearsBack: number): string =>
    endYear ? `${endYear - yearsBack} - ${endYear}` : "—";
  // Best / worst reflect completed calendar years only — a partial YTD bar
  // would otherwise dominate as best or worst.
  const fullYearReturns = annualReturns.filter((r) => !r.is_partial);
  const bestYearReturn = fullYearReturns.length
    ? fullYearReturns.reduce((a, b) => (a.return_pct > b.return_pct ? a : b))
    : null;
  const worstYearReturn = fullYearReturns.length
    ? fullYearReturns.reduce((a, b) => (a.return_pct < b.return_pct ? a : b))
    : null;
  const endingFrom100 =
    xray?.r10y != null ? (100 * Math.pow(1 + xray.r10y / 100, 10)).toFixed(2) : null;
  const r10yCls = pctCls(xray?.r10y);

  function goEditInputs() {
    router.push(`/construction/${providerSlug}/picker`);
  }

  const canSave = basket.length > 0 && Math.abs(totalPct - 100) < 0.05;

  async function saveBuild() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerSlug,
          category: saveCategory,
          name:
            saveName.trim() ||
            `${providerName} ${saveCategory} ${new Date().toISOString().slice(0, 10)}`,
          notes: saveNotes.trim() || null,
          holdings: basket,
          xray,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string })?.error ?? `HTTP ${res.status}`);
      }
      router.push(`/portfolios`);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-20 pb-16">
      {/* Sticky chrome — anchor + Edit-inputs back link (mirrors /switch result) */}
      <div className="sticky top-0 z-20 -mx-20 mb-6 bg-[var(--color-canvas-soft)] px-20">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline-2)] py-6">
          <div>
            <p className="t-micro-cap mb-1">Advisor workspace</p>
            <h1 className="t-h-md text-[var(--color-ink)]">Build portfolio</h1>
          </div>
          <p className="t-caption text-[var(--color-ink-mute)]">
            {providerName} · {basket.length} {basket.length === 1 ? "fund" : "funds"}
          </p>
        </header>
        <div className="flex items-center justify-between border-b border-[var(--color-hairline-2)] py-2">
          <button
            type="button"
            onClick={goEditInputs}
            className="t-caption text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink)]"
          >
            ← Edit inputs
          </button>
          <button
            type="button"
            onClick={() => setShowSave(true)}
            disabled={!canSave}
            className={`btn-pill ${canSave ? "btn-primary" : "btn-ghost opacity-50"}`}
            title={
              !canSave
                ? "Weights must total 100% before you can save"
                : "Save this basket as a confirmed model portfolio"
            }
          >
            Save build →
          </button>
        </div>
      </div>

      {basket.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-12 text-center">
          <p className="t-micro-cap mb-3">Nothing to review</p>
          <p className="t-body-md text-[var(--color-ink-mute)]">
            No funds carried over from the picker. Go back and stage at least one fund.
          </p>
          <button
            type="button"
            onClick={goEditInputs}
            className="mt-5 t-caption text-[var(--color-primary)] hover:underline"
          >
            ← Back to picker
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Row 1 — Model Portfolio Builder + Asset Allocation, equal-width */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ModelPortfolioBuilder
              basket={basket}
              fundsById={fundsById}
              totalPct={totalPct}
              focusedWeightId={focusedWeightId}
              onFocusWeight={setFocusedWeightId}
              onBlurWeight={() => setFocusedWeightId(null)}
              onSetWeight={setWeight}
              onDistributeEvenly={distributeEvenly}
            />
            <AssetAllocation mix={assetMix} totalPct={totalPct} />
          </div>

          {/* Performance strip — same shape as the portfolio detail page */}
          {xray && (
            <section className="grid grid-cols-2 gap-y-5 divide-x divide-[var(--color-hairline-2)] border-y border-[var(--color-hairline)] py-5 sm:grid-cols-4 md:grid-cols-7">
              <PerformanceFact label="1-Year" value={fmtSignedPct(xray.r1y)} valueCls={pctCls(xray.r1y)} sublabel={endYear ? `Cal. ${endYear}` : "—"} />
              <PerformanceFact label="3-YR Ann." value={fmtSignedPct(xray.r3y)} valueCls={pctCls(xray.r3y)} sublabel={rangeLabel(2)} />
              <PerformanceFact label="5-YR Ann." value={fmtSignedPct(xray.r5y)} valueCls={pctCls(xray.r5y)} sublabel={rangeLabel(4)} />
              <PerformanceFact label="10-YR Ann." value={fmtSignedPct(xray.r10y)} valueCls={pctCls(xray.r10y)} sublabel={rangeLabel(9)} />
              <PerformanceFact label="Best Year" value={bestYearReturn ? fmtSignedPct(bestYearReturn.return_pct) : "—"} valueCls={bestYearReturn ? pctCls(bestYearReturn.return_pct) : ""} sublabel="Calendar" />
              <PerformanceFact label="Worst Year" value={worstYearReturn ? fmtSignedPct(worstYearReturn.return_pct) : "—"} valueCls={worstYearReturn ? pctCls(worstYearReturn.return_pct) : ""} sublabel="Calendar" />
              <PerformanceFact label="OCF" value={xray.expense != null ? `${xray.expense.toFixed(3)}%` : "—"} sublabel="Blended p.a." />
            </section>
          )}

          {/* Trailing performance — Growth of 100 hero card */}
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
                    <p className="num text-[20px] font-medium leading-none text-[var(--color-ink)]">{endingFrom100}</p>
                    <p className="t-micro-cap mt-1.5">Ending value</p>
                  </div>
                )}
                {xray?.r10y != null && (
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
                <button onClick={fetchChart} className="btn-pill btn-ghost mt-3 text-[12px]">Retry</button>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-[var(--color-hairline)] p-8 text-center">
                <p className="t-body-md text-[var(--color-ink-mute)]">
                  Pulling live Morningstar look-through for each component…
                </p>
              </div>
            )}
          </section>

          {/* Annual Total Returns + Top 10 look-through holdings, equal-width */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                <p className="t-body-lg font-medium text-[var(--color-ink)]">Top 10 look-through holdings</p>
                <p className="t-micro-cap">Sleeve-weighted</p>
              </div>
              {xray && xray.holdings.length > 0 ? (
                <table className="table-pro table-pro-sm" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "70%" }} />
                    <col style={{ width: "22%" }} />
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
              ) : (
                <div className="flex min-h-[260px] flex-1 items-center justify-center px-5">
                  <p className="t-caption text-[var(--color-ink-mute)]">
                    No look-through holdings available for this basket.
                  </p>
                </div>
              )}
            </section>
          </div>

          {/* Sector + Geographic allocation */}
          {xray && (xray.sector.length > 0 || xray.geo.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {xray.sector.length > 0 && (
                <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
                  <div className="mb-4 flex items-baseline justify-between gap-3">
                    <p className="t-body-lg font-medium text-[var(--color-ink)]">Sector allocation</p>
                    <p className="t-micro-cap">Equity sleeve</p>
                  </div>
                  <BarsRow items={xray.sector.slice(0, 11)} />
                </section>
              )}
              {xray.geo.length > 0 && (
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
        </div>
      )}

      {/* Save build modal — same wizard as the StudioShell save flow */}
      {showSave && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(13,37,61,0.45)]"
          onClick={() => (saving ? null : setShowSave(false))}
        >
          <div
            className="w-[480px] max-w-[92vw] rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="t-micro-cap mb-2">Save build</p>
            <h2 className="t-h-lg text-[var(--color-ink)]">Save this as a model portfolio.</h2>
            <p className="t-body-md mt-1 text-[var(--color-ink-mute)]">
              {providerName} &middot; {basket.length} funds &middot; weights total 100%.
            </p>
            <div className="mt-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                <span className="t-caption text-[var(--color-ink-mute)]">Category</span>
                <select
                  value={saveCategory}
                  onChange={(e) => setSaveCategory(e.target.value as CategoryKey)}
                  className="t-body-md rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="t-caption text-[var(--color-ink-mute)]">Name (optional)</span>
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder={`${providerName} ${CATEGORIES.find((c) => c.key === saveCategory)?.label} v1`}
                  className="t-body-md rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="t-caption text-[var(--color-ink-mute)]">Notes (optional)</span>
                <textarea
                  value={saveNotes}
                  onChange={(e) => setSaveNotes(e.target.value)}
                  rows={2}
                  placeholder="Rationale for this construction…"
                  className="t-body-md rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                />
              </label>
            </div>
            {saveError && <p className="mt-3 t-caption text-[var(--color-negative)]">{saveError}</p>}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowSave(false)}
                disabled={saving}
                className="btn-pill btn-ghost disabled:opacity-50"
              >
                Cancel
              </button>
              <button onClick={saveBuild} disabled={saving} className="btn-pill btn-primary">
                {saving ? "Saving…" : "Save model portfolio"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Model Portfolio Builder (editable instruments) ----------------

function ModelPortfolioBuilder({
  basket,
  fundsById,
  totalPct,
  focusedWeightId,
  onFocusWeight,
  onBlurWeight,
  onSetWeight,
  onDistributeEvenly,
}: {
  basket: Holding[];
  fundsById: Map<number, FundInspectorData>;
  totalPct: number;
  focusedWeightId: number | null;
  onFocusWeight: (id: number) => void;
  onBlurWeight: () => void;
  onSetWeight: (id: number, pct: number) => void;
  onDistributeEvenly: () => void;
}) {
  const totalCls =
    Math.abs(totalPct - 100) < 0.05
      ? "text-[var(--color-positive)]"
      : "text-[var(--color-negative)]";
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3">
        <p className="t-body-lg font-medium text-[var(--color-ink)]">Model Portfolio Builder</p>
        <button
          type="button"
          onClick={onDistributeEvenly}
          className="t-caption text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink)]"
          title="Distribute weights evenly across all instruments"
        >
          Equal weight
        </button>
      </div>
      <table className="table-pro table-pro-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "72%" }} />
          <col style={{ width: "28%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Instrument</th>
            <th className="right">Weight %</th>
          </tr>
        </thead>
        <tbody>
          {basket.map((h) => {
            const f = fundsById.get(h.fundId);
            if (!f) return null;
            const value =
              focusedWeightId === h.fundId && h.weightBps === 0 ? "" : h.weightBps / 100;
            return (
              <tr key={h.fundId}>
                <td className="cell-fund">
                  <span className="name text-[var(--color-ink)]" title={f.name}>{f.name}</span>
                  <span className="meta">{f.isin ?? f.external_id}</span>
                </td>
                <td className="nowrap right">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="0"
                    value={value}
                    onFocus={(e) => {
                      onFocusWeight(h.fundId);
                      e.target.select();
                    }}
                    onBlur={onBlurWeight}
                    onChange={(e) => onSetWeight(h.fundId, parseFloat(e.target.value || "0"))}
                    className="num w-20 rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-2 py-1 text-right text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-mute)] focus:border-[var(--color-primary)]"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="text-[var(--color-ink-mute)]">Total</td>
            <td className="right">
              <span className={`num font-medium ${totalCls}`}>{totalPct.toFixed(2)}%</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

// ---------------- Asset Allocation (donut + asset class %) ----------------

function AssetAllocation({
  mix,
  totalPct,
}: {
  mix: { key: ClassKey; pct: number }[];
  totalPct: number;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
      <div className="mb-5 flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] pb-3">
        <p className="t-body-lg font-medium text-[var(--color-ink)]">Asset Allocation</p>
        <p className="t-micro-cap">Net %</p>
      </div>
      {mix.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-8">
          <p className="t-caption text-[var(--color-ink-mute)]">Add weights to see allocation</p>
        </div>
      ) : (
        <div className="flex flex-1 items-center gap-6">
          <Donut slices={mix} totalPct={totalPct} />
          <ul className="flex flex-1 flex-col gap-2.5">
            {mix.map((m) => (
              <li key={m.key} className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: CLASS_COLOR[m.key] }} />
                <span className="t-body-md flex-1 text-[var(--color-ink-2)]">{CLASS_LABEL[m.key]}</span>
                <span className="num text-[13px] font-medium text-[var(--color-ink)]">{m.pct.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Donut({
  slices,
  totalPct,
  size = 160,
}: {
  slices: { key: ClassKey; pct: number }[];
  totalPct: number;
  size?: number;
}) {
  const r = size / 2;
  const inner = r * 0.62;
  // Renormalise so the donut visually sums to 360°, even when the basket's
  // total weight is partial (so an under-weighted basket still reads as a
  // distribution, just with a "Total xx%" annotation in the centre).
  const sum = slices.reduce((s, x) => s + x.pct, 0) || 1;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
        {slices.map((s) => {
          const startFrac = acc / sum;
          acc += s.pct;
          const endFrac = acc / sum;
          const a0 = startFrac * Math.PI * 2 - Math.PI / 2;
          const a1 = endFrac * Math.PI * 2 - Math.PI / 2;
          const large = endFrac - startFrac > 0.5 ? 1 : 0;
          const x0 = r + r * Math.cos(a0);
          const y0 = r + r * Math.sin(a0);
          const x1 = r + r * Math.cos(a1);
          const y1 = r + r * Math.sin(a1);
          const ix0 = r + inner * Math.cos(a1);
          const iy0 = r + inner * Math.sin(a1);
          const ix1 = r + inner * Math.cos(a0);
          const iy1 = r + inner * Math.sin(a0);
          // Single-slice case — draw two half-arcs since the start/end points coincide.
          if (slices.length === 1) {
            return (
              <g key={s.key}>
                <circle cx={r} cy={r} r={r} fill={CLASS_COLOR[s.key]} />
                <circle cx={r} cy={r} r={inner} fill="var(--color-canvas)" />
              </g>
            );
          }
          return (
            <path
              key={s.key}
              d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix0} ${iy0} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`}
              fill={CLASS_COLOR[s.key]}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="num text-[18px] font-medium leading-none text-[var(--color-ink)]">
          {totalPct.toFixed(0)}%
        </p>
        <p className="t-micro-cap mt-1">Total</p>
      </div>
    </div>
  );
}

// ---------------- shared little cell ----------------

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

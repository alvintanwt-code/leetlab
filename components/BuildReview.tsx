"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FundInspectorData, AllocationDetail } from "@/lib/db/queries";
import { BarsRow } from "@/components/PortfolioDetail";

// Step-2 page after the picker. Reads the picker's sessionStorage hand-off,
// equal-weights the basket, then renders the same Instruments + Portfolio
// X-ray panels we use in the full StudioShell. An Edit-inputs back link in
// the chrome returns to the picker without losing the selection.

type Holding = { fundId: number; weightBps: number };

function fmtPct(v: number | null | undefined, places = 2): { text: string; cls: string } {
  if (v == null || !Number.isFinite(v)) return { text: "—", cls: "text-[var(--color-ink-mute)]" };
  if (Math.abs(v) < 0.005) return { text: `0.${"0".repeat(places)}%`, cls: "text-[var(--color-ink)]" };
  const sign = v > 0 ? "+" : "−";
  const cls = v > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  return { text: `${sign}${Math.abs(v).toFixed(places)}%`, cls };
}

function KpiTile({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <p className="t-micro-cap mb-1.5">{label}</p>
      <p className={`num text-[22px] font-medium leading-none ${valueCls ?? "text-[var(--color-ink)]"}`}>{value}</p>
    </div>
  );
}

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

  // Seed from the picker's sessionStorage drop. Equal-weights on mount; we do
  // NOT clear the storage key — the user may bounce back to the picker via
  // Edit inputs and we want their selection intact.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`build-picker:v1:${providerSlug}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { ids?: number[] };
      const ids = (parsed.ids ?? []).filter((id) => fundsById.has(id));
      if (ids.length === 0) return;
      const each = Math.floor(10000 / ids.length);
      const remainder = 10000 - each * ids.length;
      setBasket(ids.map((id, i) => ({ fundId: id, weightBps: each + (i === 0 ? remainder : 0) })));
    } catch {
      // bad payload — leave basket empty so the empty-state CTA shows up
    }
  }, [providerSlug, fundsById]);

  const xray = useMemo(() => {
    if (basket.length === 0) return null;
    let expense = 0, r1y = 0, r3y = 0, r5y = 0, r10y = 0, risk = 0;
    let covEx = 0, cov1y = 0, cov3y = 0, cov5y = 0, cov10y = 0, covRisk = 0;
    let equityCoverage = 0;
    const aggGeo: Record<string, number> = {};
    const aggSector: Record<string, number> = {};

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
    };
  }, [basket, fundsById, allocsByFund]);

  function goEditInputs() {
    router.push(`/construction/${providerSlug}/picker`);
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-20 pb-16">
      {/* Sticky chrome — same anchor as the picker, with the platform-tabs
          slot replaced by an Edit-inputs back link (mirrors /switch result). */}
      <div className="sticky top-0 z-20 -mx-20 mb-3 bg-[var(--color-canvas-soft)] px-20">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline-2)] py-6">
          <div>
            <p className="t-micro-cap mb-1">Advisor workspace</p>
            <h1 className="t-h-md text-[var(--color-ink)]">Build portfolio</h1>
          </div>
          <p className="t-caption text-[var(--color-ink-mute)]">
            {providerName} · {basket.length} {basket.length === 1 ? "fund" : "funds"}
          </p>
        </header>
        <div className="flex items-center justify-end border-b border-[var(--color-hairline-2)] py-2">
          <button
            type="button"
            onClick={goEditInputs}
            className="t-caption text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink)]"
          >
            ← Edit inputs
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
          {/* Instruments — basket table */}
          <section className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
            <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3">
              <p className="t-body-md font-medium text-[var(--color-ink)]">Instruments</p>
              <p className="t-micro-cap">Weight-equalised across selection</p>
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
                {basket.map((h) => {
                  const f = fundsById.get(h.fundId);
                  if (!f) return null;
                  const r1 = fmtPct(f.ann_1y);
                  const r3 = fmtPct(f.ann_3y);
                  const r5 = fmtPct(f.ann_5y);
                  return (
                    <tr key={h.fundId}>
                      <td className="cell-fund">
                        <span className="name text-[var(--color-ink)]" title={f.name}>{f.name}</span>
                        <span className="meta">{f.isin ?? f.external_id}</span>
                      </td>
                      <td className="nowrap right">
                        <span className="num text-[var(--color-ink)]">{(h.weightBps / 100).toFixed(2)}%</span>
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

          {/* Portfolio X-ray */}
          {xray && (
            <section className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <p className="t-body-lg font-medium text-[var(--color-ink)]">Portfolio X-ray</p>
                <p className="t-micro-cap">
                  Weighted exposure
                  {xray.risk != null && (
                    <>
                      {" "}&middot;{" "}Risk{" "}
                      {Number.isInteger(xray.risk) ? xray.risk.toFixed(0) : xray.risk.toFixed(1)}/5
                    </>
                  )}
                </p>
              </div>

              {/* Mandate facts strip */}
              <section className="mt-5 mb-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--color-hairline)] pt-5 sm:grid-cols-4">
                <div>
                  <p className="t-micro-cap mb-1.5">Equity</p>
                  <p className="num text-[22px] font-medium leading-none text-[var(--color-ink)]">{`${(xray.equityCoverage * 100).toFixed(0)}%`}</p>
                </div>
                <div>
                  <p className="t-micro-cap mb-1.5">Fixed Income</p>
                  <p className="num text-[22px] font-medium leading-none text-[var(--color-ink)]">{`${Math.max(0, 100 - xray.equityCoverage * 100).toFixed(0)}%`}</p>
                </div>
                <div>
                  <p className="t-micro-cap mb-1.5">OCF P.A.</p>
                  <p className="num text-[22px] font-medium leading-none text-[var(--color-ink)]">{xray.expense != null ? `${xray.expense.toFixed(3)}%` : "—"}</p>
                </div>
                <div>
                  <p className="t-micro-cap mb-1.5">Funds</p>
                  <p className="num text-[22px] font-medium leading-none text-[var(--color-ink)]">{basket.length}</p>
                </div>
              </section>

              {/* Weighted trailing returns */}
              <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
                <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="t-body-lg font-medium text-[var(--color-ink)]">Weighted trailing returns</p>
                  <p className="t-micro-cap">Weight-average</p>
                </div>
                <div className="grid grid-cols-2 gap-0 divide-x divide-[var(--color-hairline-2)] md:grid-cols-4">
                  <KpiTile label="1Y" value={fmtPct(xray.r1y).text} valueCls={fmtPct(xray.r1y).cls} />
                  <KpiTile label="3Y pa" value={fmtPct(xray.r3y).text} valueCls={fmtPct(xray.r3y).cls} />
                  <KpiTile label="5Y pa" value={fmtPct(xray.r5y).text} valueCls={fmtPct(xray.r5y).cls} />
                  <KpiTile label="10Y pa" value={fmtPct(xray.r10y).text} valueCls={fmtPct(xray.r10y).cls} />
                </div>
              </section>

              {(xray.sector.length > 0 || xray.geo.length > 0) && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </section>
          )}
        </div>
      )}
    </div>
  );
}

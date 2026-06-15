"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { FundInspector } from "./FundInspector";
import type { FundInspectorData, AllocationDetail } from "@/lib/db/queries";

type Holding = { fundId: number; weightBps: number };
type DocByFund = Record<number, { type: string; label: string }[]>;

const CATEGORIES = [
  { key: "conservative", label: "Conservative" },
  { key: "balanced", label: "Balanced" },
  { key: "growth", label: "Growth" },
  { key: "aggressive", label: "Aggressive" },
  { key: "dividend_income", label: "Dividend income" },
] as const;
type CategoryKey = (typeof CATEGORIES)[number]["key"];

const ASSET_COLORS: Record<string, string> = {
  E: "var(--color-primary)",
  F: "var(--color-positive)",
  A: "#634dbf",
  L: "#946638",
  C: "#c8810a",
  M: "var(--color-ink-mute)",
};

function classKey(assetClass: string | null): string {
  if (!assetClass) return "M";
  const s = assetClass.toLowerCase();
  if (s.includes("equity")) return "E";
  if (s.includes("fixed")) return "F";
  if (s.includes("allocation")) return "A";
  if (s.includes("alt")) return "L";
  if (s.includes("commod")) return "C";
  if (s.includes("money") || s.includes("cash")) return "M";
  return "M";
}

function fmtPct(v: number | null, places = 2): { text: string; cls: string } {
  if (v == null || isNaN(v)) return { text: "—", cls: "text-[var(--color-ink-mute)]" };
  if (Math.abs(v) < 0.005) return { text: `0.${"0".repeat(places)}%`, cls: "text-[var(--color-ink)]" };
  const sign = v > 0 ? "+" : "−";
  const cls = v > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  return { text: `${sign}${Math.abs(v).toFixed(places)}%`, cls };
}

export function StudioShell({
  providerSlug,
  providerName,
  funds,
  allocations,
  documents,
}: {
  providerSlug: string;
  providerName: string;
  funds: FundInspectorData[];
  allocations: AllocationDetail[];
  documents: DocByFund;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [basket, setBasket] = useState<Holding[]>([]);
  const [inspectFundId, setInspectFundId] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [confirmCategory, setConfirmCategory] = useState<CategoryKey>("balanced");
  const [confirmNotes, setConfirmNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "/" focuses search like the HTML prototype.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setInspectFundId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const fundsById = useMemo(() => new Map(funds.map((f) => [f.id, f])), [funds]);
  const allocsByFund = useMemo(() => {
    const m = new Map<number, AllocationDetail[]>();
    for (const a of allocations) {
      if (!m.has(a.fund_id)) m.set(a.fund_id, []);
      m.get(a.fund_id)!.push(a);
    }
    return m;
  }, [allocations]);

  const filteredFunds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return funds;
    return funds.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.fund_house ?? "").toLowerCase().includes(q) ||
        f.external_id.toLowerCase().includes(q) ||
        (f.isin ?? "").toLowerCase().includes(q),
    );
  }, [funds, search]);

  const totalBps = basket.reduce((s, h) => s + h.weightBps, 0);
  const totalPct = totalBps / 100;
  const canConfirm = totalBps === 10000 && basket.length > 0;

  const xray = useMemo(() => {
    if (basket.length === 0) return null;
    let expense = 0, r1y = 0, r3y = 0, r5y = 0, r10y = 0, risk = 0;
    let covEx = 0, cov1y = 0, cov3y = 0, cov5y = 0, cov10y = 0, covRisk = 0;
    const aggAsset: Record<string, number> = {};
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
      for (const a of allocs) {
        if (a.kind === "asset") aggAsset[a.label] = (aggAsset[a.label] ?? 0) + w * a.weight_pct;
        else if (a.kind === "geography") aggGeo[a.label] = (aggGeo[a.label] ?? 0) + w * a.weight_pct;
        else if (a.kind === "sector") aggSector[a.label] = (aggSector[a.label] ?? 0) + w * a.weight_pct;
      }
    }
    const sorted = (agg: Record<string, number>) =>
      Object.entries(agg).map(([label, w]) => ({ label, weight_pct: w })).sort((a, b) => b.weight_pct - a.weight_pct);
    return {
      expense: covEx > 0 ? expense / covEx : null,
      risk: covRisk > 0 ? risk / covRisk : null,
      r1y: cov1y > 0 ? r1y / cov1y : null,
      r3y: cov3y > 0 ? r3y / cov3y : null,
      r5y: cov5y > 0 ? r5y / cov5y : null,
      r10y: cov10y > 0 ? r10y / cov10y : null,
      asset: sorted(aggAsset),
      geo: sorted(aggGeo),
      sector: sorted(aggSector),
    };
  }, [basket, fundsById, allocsByFund]);

  function toggleAdd(fundId: number) {
    setBasket((prev) =>
      prev.some((h) => h.fundId === fundId)
        ? prev.filter((h) => h.fundId !== fundId)
        : [...prev, { fundId, weightBps: 0 }],
    );
  }
  function setWeight(fundId: number, pct: number) {
    const bps = Math.max(0, Math.min(10000, Math.round(pct * 100)));
    setBasket((prev) => prev.map((h) => (h.fundId === fundId ? { ...h, weightBps: bps } : h)));
  }
  function distributeEvenly() {
    if (basket.length === 0) return;
    const each = Math.floor(10000 / basket.length);
    const remainder = 10000 - each * basket.length;
    setBasket((prev) => prev.map((h, i) => ({ ...h, weightBps: each + (i === 0 ? remainder : 0) })));
  }
  function clearBasket() { setBasket([]); }

  const inspected = inspectFundId != null ? fundsById.get(inspectFundId) ?? null : null;

  async function confirmBuild() {
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerSlug,
          category: confirmCategory,
          name: confirmName.trim() || `${providerName} ${confirmCategory} ${new Date().toISOString().slice(0, 10)}`,
          notes: confirmNotes.trim() || null,
          holdings: basket,
          xray,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      router.push(`/portfolios`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid h-[calc(100vh-104px)] grid-cols-12 gap-0">
      {/* LEFT — fund picker */}
      <section className="col-span-4 flex flex-col border-r border-[var(--color-hairline)] bg-[var(--color-canvas)]">
        <div className="border-b border-[var(--color-hairline)] px-4 py-3">
          <p className="t-micro-cap mb-2">Available on {providerName} · click name to inspect, + to add</p>
          <div className="flex items-center gap-2 rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-1.5">
            <span className="text-[var(--color-ink-mute)]">⌕</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter instruments…  ( / )"
              className="t-body-md w-full bg-transparent outline-none placeholder:text-[var(--color-ink-mute)]"
            />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto py-2">
          {filteredFunds.length === 0 ? (
            <li className="px-4 py-8 text-center t-body-md text-[var(--color-ink-mute)]">No matches.</li>
          ) : (
            filteredFunds.map((f) => {
              const inBasket = basket.some((h) => h.fundId === f.id);
              const k = classKey(f.asset_class);
              return (
                <li
                  key={f.id}
                  className="group flex items-center gap-2 px-4 py-2 hover:bg-[var(--color-canvas-soft)] cursor-pointer"
                  onClick={() => setInspectFundId(f.id)}
                >
                  <span
                    className="block h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: ASSET_COLORS[k] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 t-body-md truncate text-[var(--color-ink)]" title={f.name}>
                    {f.name}
                  </span>
                  <span className="num shrink-0 text-[10px] text-[var(--color-ink-mute)]">{f.isin ?? f.external_id}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleAdd(f.id); }}
                    className={[
                      "ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[13px] font-medium transition-colors",
                      inBasket
                        ? "bg-[var(--color-positive)] text-white"
                        : "bg-[var(--color-canvas-soft)] text-[var(--color-primary)] group-hover:bg-[var(--color-primary)] group-hover:text-white",
                    ].join(" ")}
                    aria-label={inBasket ? `Remove ${f.name}` : `Add ${f.name}`}
                  >
                    {inBasket ? "✓" : "+"}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>

      {/* RIGHT — basket + x-ray */}
      <section className="col-span-8 flex flex-col overflow-hidden bg-[var(--color-canvas-soft)]">
        <div className="flex items-center justify-between border-b border-[var(--color-hairline)] bg-[var(--color-canvas)] px-6 py-3">
          <div>
            <p className="t-micro-cap">Model portfolio</p>
            <p className="t-caption mt-0.5 text-[var(--color-ink-mute)]">
              <span className="num">{basket.length}</span> holdings &middot; weights{" "}
              <span className={`num ${totalBps === 10000 ? "text-[var(--color-positive)]" : "text-[var(--color-ink)]"}`}>
                {totalPct.toFixed(2)}%
              </span>{" "}
              {totalBps === 10000 ? "✓" : totalBps > 0 ? "⚠" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={distributeEvenly} disabled={basket.length === 0} className="btn-pill btn-ghost whitespace-nowrap disabled:opacity-50">
              Equal weight
            </button>
            <button onClick={clearBasket} disabled={basket.length === 0} className="btn-pill btn-ghost whitespace-nowrap disabled:opacity-50">
              Clear
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!canConfirm}
              className={`btn-pill whitespace-nowrap ${canConfirm ? "btn-primary" : "btn-ghost opacity-60"}`}
            >
              Confirm build →
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {basket.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-10 text-center">
              <p className="t-body-lg text-[var(--color-ink-mute)]">
                Add instruments from the left panel, set weights, then confirm.
              </p>
            </div>
          ) : (
            <>
              {/* basket table */}
              <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
                <table className="table-pro" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "42%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "12%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th className="right">Weight %</th>
                      <th className="right">1Y</th>
                      <th className="right">3Y</th>
                      <th className="right">5Y</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {basket.map((h) => {
                      const f = fundsById.get(h.fundId);
                      if (!f) return null;
                      const r1 = fmtPct(f.ann_1y), r3 = fmtPct(f.ann_3y), r5 = fmtPct(f.ann_5y);
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
                              value={h.weightBps / 100}
                              onChange={(e) => setWeight(h.fundId, parseFloat(e.target.value || "0"))}
                              className="num w-20 rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-2 py-1 text-right text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                            />
                          </td>
                          <td className="nowrap right"><span className={`num ${r1.cls}`}>{r1.text}</span></td>
                          <td className="nowrap right"><span className={`num ${r3.cls}`}>{r3.text}</span></td>
                          <td className="nowrap right"><span className={`num ${r5.cls}`}>{r5.text}</span></td>
                          <td className="nowrap right">
                            <button
                              onClick={() => toggleAdd(h.fundId)}
                              className="t-caption text-[var(--color-ink-mute)] hover:text-[var(--color-negative)]"
                              aria-label={`Remove ${f.name}`}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* X-ray */}
              {xray && (
                <section className="mt-6 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
                  <p className="t-micro-cap mb-4">X-ray</p>
                  <div className="grid grid-cols-4 gap-4">
                    <Metric label="Expense" value={xray.expense != null ? `${xray.expense.toFixed(2)}%` : "—"} />
                    <Metric label="Risk" value={xray.risk != null ? `${xray.risk.toFixed(1)} / 5` : "—"} />
                    <Metric label="3Y return" {...fmtPctMetric(xray.r3y)} />
                    <Metric label="5Y return" {...fmtPctMetric(xray.r5y)} />
                  </div>

                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    {xray.asset.length > 0 && (
                      <div>
                        <p className="t-caption mb-3 text-[var(--color-ink-mute)]">Asset allocation</p>
                        <BarsLite items={xray.asset.slice(0, 8)} />
                      </div>
                    )}
                    {xray.geo.length > 0 && (
                      <div>
                        <p className="t-caption mb-3 text-[var(--color-ink-mute)]">Geographies</p>
                        <BarsLite items={xray.geo.slice(0, 8)} />
                      </div>
                    )}
                    {xray.sector.length > 0 && (
                      <div>
                        <p className="t-caption mb-3 text-[var(--color-ink-mute)]">Sectors</p>
                        <BarsLite items={xray.sector.slice(0, 8)} />
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </section>

      {/* Inspector drawer */}
      {inspected && (
        <FundInspector
          fund={inspected}
          allocations={allocsByFund.get(inspected.id) ?? []}
          documents={documents[inspected.id] ?? []}
          onClose={() => setInspectFundId(null)}
          onAdd={() => { toggleAdd(inspected.id); }}
          alreadyInBasket={basket.some((h) => h.fundId === inspected.id)}
        />
      )}

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(13,37,61,0.45)]" onClick={() => setShowConfirm(false)}>
          <div className="w-[480px] max-w-[92vw] rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-6" onClick={(e) => e.stopPropagation()}>
            <p className="t-micro-cap mb-2">Confirm build</p>
            <h2 className="t-h-lg text-[var(--color-ink)]">Save this as a model portfolio.</h2>
            <p className="t-body-md mt-1 text-[var(--color-ink-mute)]">{providerName} &middot; {basket.length} funds &middot; weights total 100%.</p>
            <div className="mt-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                <span className="t-caption text-[var(--color-ink-mute)]">Category</span>
                <select
                  value={confirmCategory}
                  onChange={(e) => setConfirmCategory(e.target.value as CategoryKey)}
                  className="t-body-md rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                >
                  {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="t-caption text-[var(--color-ink-mute)]">Name (optional)</span>
                <input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={`${providerName} ${CATEGORIES.find((c) => c.key === confirmCategory)?.label} v1`}
                  className="t-body-md rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="t-caption text-[var(--color-ink-mute)]">Notes (optional)</span>
                <textarea
                  value={confirmNotes}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                  rows={2}
                  placeholder="Rationale for this construction…"
                  className="t-body-md rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                />
              </label>
            </div>
            {error && <p className="mt-3 t-caption text-[var(--color-negative)]">{error}</p>}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="btn-pill btn-ghost">Cancel</button>
              <button onClick={confirmBuild} disabled={saving} className="btn-pill btn-primary">
                {saving ? "Saving…" : "Save model portfolio"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div>
      <p className="t-caption text-[var(--color-ink-mute)]">{label}</p>
      <p className={`t-h-md num mt-1 ${valueCls ?? "text-[var(--color-ink)]"}`}>{value}</p>
    </div>
  );
}

function fmtPctMetric(v: number | null): { value: string; valueCls: string } {
  const f = fmtPct(v);
  return { value: f.text, valueCls: f.cls };
}

function BarsLite({ items }: { items: { label: string; weight_pct: number }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((a) => (
        <li key={a.label} className="flex items-center gap-3">
          <span className="t-body-md w-28 shrink-0 truncate text-[var(--color-ink-2)]" title={a.label}>{a.label}</span>
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-hairline-2)]">
            <span
              className="absolute inset-y-0 left-0 bg-[var(--color-primary)]"
              style={{ width: `${Math.min(100, a.weight_pct).toFixed(2)}%` }}
            />
          </span>
          <span className="num w-12 shrink-0 text-right text-[11px] text-[var(--color-ink)]">{a.weight_pct.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

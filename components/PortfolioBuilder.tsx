"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FundPickerRow, AllocationByFund } from "@/lib/db/queries";

type Holding = { fundId: number; weightBps: number };

type Props = {
  providerSlug: string;
  providerName: string;
  funds: FundPickerRow[];
  allocations: AllocationByFund;
};

const CATEGORIES = [
  { key: "conservative", label: "Conservative" },
  { key: "balanced", label: "Balanced" },
  { key: "growth", label: "Growth" },
  { key: "aggressive", label: "Aggressive" },
  { key: "dividend_income", label: "Dividend income" },
] as const;
type CategoryKey = (typeof CATEGORIES)[number]["key"];

function fmtPct(value: number | null, places = 2): { text: string; cls: string } {
  if (value == null || isNaN(value)) return { text: "—", cls: "text-[var(--color-ink-mute)]" };
  if (Math.abs(value) < 0.005) return { text: `0.${"0".repeat(places)}%`, cls: "text-[var(--color-ink)]" };
  const sign = value > 0 ? "+" : "−";
  const cls = value > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  return { text: `${sign}${Math.abs(value).toFixed(places)}%`, cls };
}

export default function PortfolioBuilder({ providerSlug, providerName, funds, allocations }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [confirmCategory, setConfirmCategory] = useState<CategoryKey>("balanced");
  const [confirmNotes, setConfirmNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fundsById = useMemo(() => new Map(funds.map((f) => [f.id, f])), [funds]);

  const filteredFunds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return funds;
    return funds.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.fund_house ?? "").toLowerCase().includes(q) ||
        f.external_id.toLowerCase().includes(q),
    );
  }, [funds, search]);

  const totalBps = holdings.reduce((s, h) => s + h.weightBps, 0);
  const totalPct = totalBps / 100;
  const canConfirm = totalBps === 10000 && holdings.length > 0;

  const xray = useMemo(() => {
    if (holdings.length === 0) return null;
    let expense = 0;
    let r1y = 0, r3y = 0, r5y = 0, r10y = 0;
    let risk = 0;
    let coverageExpense = 0, coverage1y = 0, coverage3y = 0, coverage5y = 0, coverage10y = 0, coverageRisk = 0;
    const assetAgg: Record<string, number> = {};
    const geoAgg: Record<string, number> = {};
    const sectorAgg: Record<string, number> = {};

    for (const h of holdings) {
      const w = h.weightBps / 10000;
      const f = fundsById.get(h.fundId);
      if (!f) continue;
      if (f.expense_ratio != null) { expense += w * f.expense_ratio; coverageExpense += w; }
      if (f.ann_1y != null) { r1y += w * f.ann_1y; coverage1y += w; }
      if (f.ann_3y != null) { r3y += w * f.ann_3y; coverage3y += w; }
      if (f.ann_5y != null) { r5y += w * f.ann_5y; coverage5y += w; }
      if (f.ann_10y != null) { r10y += w * f.ann_10y; coverage10y += w; }
      if (f.risk_rating != null) { risk += w * f.risk_rating; coverageRisk += w; }

      const a = allocations[f.id];
      if (a) {
        for (const x of a.asset) assetAgg[x.label] = (assetAgg[x.label] ?? 0) + w * x.weight_pct;
        for (const x of a.geography) geoAgg[x.label] = (geoAgg[x.label] ?? 0) + w * x.weight_pct;
        for (const x of a.sector) sectorAgg[x.label] = (sectorAgg[x.label] ?? 0) + w * x.weight_pct;
      }
    }

    const normalize = (label: string, value: number) => ({ label, weight_pct: value });
    const toSorted = (agg: Record<string, number>) =>
      Object.entries(agg)
        .map(([k, v]) => normalize(k, v))
        .sort((a, b) => b.weight_pct - a.weight_pct);

    return {
      expense: coverageExpense > 0 ? expense / coverageExpense : null,
      r1y: coverage1y > 0 ? r1y / coverage1y : null,
      r3y: coverage3y > 0 ? r3y / coverage3y : null,
      r5y: coverage5y > 0 ? r5y / coverage5y : null,
      r10y: coverage10y > 0 ? r10y / coverage10y : null,
      risk: coverageRisk > 0 ? risk / coverageRisk : null,
      asset: toSorted(assetAgg),
      geography: toSorted(geoAgg),
      sector: toSorted(sectorAgg),
    };
  }, [holdings, fundsById, allocations]);

  function addFund(fundId: number) {
    if (holdings.some((h) => h.fundId === fundId)) return;
    setHoldings((prev) => [...prev, { fundId, weightBps: 0 }]);
  }

  function removeFund(fundId: number) {
    setHoldings((prev) => prev.filter((h) => h.fundId !== fundId));
  }

  function setWeight(fundId: number, pct: number) {
    const bps = Math.max(0, Math.min(10000, Math.round(pct * 100)));
    setHoldings((prev) => prev.map((h) => (h.fundId === fundId ? { ...h, weightBps: bps } : h)));
  }

  function distributeEvenly() {
    if (holdings.length === 0) return;
    const each = Math.floor(10000 / holdings.length);
    const remainder = 10000 - each * holdings.length;
    setHoldings((prev) => prev.map((h, i) => ({ ...h, weightBps: each + (i === 0 ? remainder : 0) })));
  }

  function clearWeights() {
    setHoldings((prev) => prev.map((h) => ({ ...h, weightBps: 0 })));
  }

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
          holdings,
          xray,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      router.push(`/portfolio?confirmed=${data.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-8">
      {/* LEFT: Library */}
      <section className="col-span-12 lg:col-span-7 min-w-0">
        <p className="t-micro-cap mb-3">Library &middot; {providerName}</p>
        <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2">
          <span className="text-[var(--color-ink-mute)]">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by fund name, ISIN, fund house"
            className="t-body-md w-full bg-transparent outline-none placeholder:text-[var(--color-ink-mute)]"
          />
        </div>
        <div className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
          <table className="table-pro" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "44%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fund</th>
                <th>Ccy</th>
                <th>Asset class</th>
                <th>Risk</th>
                <th className="right">3Y</th>
                <th className="right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredFunds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-[var(--color-ink-mute)]">No funds match.</td>
                </tr>
              ) : (
                filteredFunds.map((f) => {
                  const inBasket = holdings.some((h) => h.fundId === f.id);
                  const r3y = fmtPct(f.ann_3y);
                  return (
                    <tr key={f.id}>
                      <td className="cell-fund">
                        <span className="name text-[var(--color-ink)]" title={f.name}>{f.name}</span>
                        <span className="meta">{f.fund_house ?? "—"} &middot; {f.external_id}</span>
                      </td>
                      <td className="nowrap"><span className="num text-[var(--color-ink-2)]">{f.currency ?? "—"}</span></td>
                      <td className="nowrap text-[var(--color-ink-2)]">{f.asset_class ?? "—"}</td>
                      <td className="nowrap text-[var(--color-ink-mute)]">{f.risk_rating ?? "—"}</td>
                      <td className="nowrap right"><span className={`num ${r3y.cls}`}>{r3y.text}</span></td>
                      <td className="nowrap right">
                        {inBasket ? (
                          <button onClick={() => removeFund(f.id)} className="t-body-md text-[var(--color-ink-mute)] hover:text-[var(--color-negative)]">
                            Remove
                          </button>
                        ) : (
                          <button onClick={() => addFund(f.id)} className="t-body-md text-[var(--color-primary)] hover:text-[var(--color-primary-deep)]">
                            + Add
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* RIGHT: Basket + X-ray */}
      <aside className="col-span-12 lg:col-span-5 min-w-0">
        <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <div className="flex items-baseline justify-between">
            <p className="t-micro-cap">Basket</p>
            <span className="num t-caption text-[var(--color-ink-mute)]">{holdings.length} fund{holdings.length === 1 ? "" : "s"}</span>
          </div>
          {holdings.length === 0 ? (
            <p className="t-body-md mt-4 text-[var(--color-ink-mute)]">Tap + Add on any fund to build a basket.</p>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-[var(--color-hairline-2)]">
                {holdings.map((h) => {
                  const f = fundsById.get(h.fundId);
                  if (!f) return null;
                  return (
                    <li key={h.fundId} className="flex items-center gap-3 py-3">
                      <span className="t-body-md min-w-0 flex-1 truncate text-[var(--color-ink)]" title={f.name}>
                        {f.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={h.weightBps / 100}
                          onChange={(e) => setWeight(h.fundId, parseFloat(e.target.value || "0"))}
                          className="num w-20 rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-2 py-1 text-right text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                        />
                        <span className="t-caption text-[var(--color-ink-mute)]">%</span>
                      </div>
                      <button
                        onClick={() => removeFund(h.fundId)}
                        className="t-caption text-[var(--color-ink-mute)] hover:text-[var(--color-negative)]"
                        aria-label={`Remove ${f.name}`}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex items-center justify-between border-t border-[var(--color-hairline)] pt-4">
                <div>
                  <p className="t-caption text-[var(--color-ink-mute)]">Total weight</p>
                  <p className={`t-h-md num ${totalBps === 10000 ? "text-[var(--color-positive)]" : "text-[var(--color-ink)]"}`}>
                    {totalPct.toFixed(2)}%
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={distributeEvenly} className="btn-pill btn-ghost whitespace-nowrap">Distribute evenly</button>
                  <button onClick={clearWeights} className="btn-pill btn-ghost whitespace-nowrap">Reset</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* X-ray */}
        <div className="mt-5 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <p className="t-micro-cap mb-4">X-ray</p>
          {!xray ? (
            <p className="t-body-md text-[var(--color-ink-mute)]">Pick funds and assign weights to see aggregate stats.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Metric label="Weighted expense" value={xray.expense != null ? `${xray.expense.toFixed(2)}%` : "—"} />
                <Metric label="Risk score" value={xray.risk != null ? xray.risk.toFixed(1) : "—"} suffix={xray.risk != null ? "/ 5" : ""} />
                <Metric label="3Y return" value={fmtPct(xray.r3y).text} valueCls={fmtPct(xray.r3y).cls} />
                <Metric label="5Y return" value={fmtPct(xray.r5y).text} valueCls={fmtPct(xray.r5y).cls} />
              </div>

              {xray.asset.length > 0 && (
                <div className="mt-6">
                  <p className="t-caption mb-2 text-[var(--color-ink-mute)]">Asset allocation</p>
                  <AggBar items={xray.asset.slice(0, 6)} />
                </div>
              )}
              {xray.geography.length > 0 && (
                <div className="mt-5">
                  <p className="t-caption mb-2 text-[var(--color-ink-mute)]">Top geographies</p>
                  <AggBar items={xray.geography.slice(0, 6)} />
                </div>
              )}
              {xray.sector.length > 0 && (
                <div className="mt-5">
                  <p className="t-caption mb-2 text-[var(--color-ink-mute)]">Top sectors</p>
                  <AggBar items={xray.sector.slice(0, 6)} />
                </div>
              )}
            </>
          )}
        </div>

        <button
          onClick={() => setShowConfirm(true)}
          disabled={!canConfirm}
          className={`mt-5 w-full btn-pill ${canConfirm ? "btn-primary" : "btn-ghost cursor-not-allowed opacity-60"}`}
        >
          {canConfirm ? "Confirm build →" : totalBps === 10000 ? "Add at least one fund" : `Weights total ${totalPct.toFixed(2)}% — must equal 100%`}
        </button>

        {/* Confirm dialog */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(13,37,61,0.45)]" onClick={() => setShowConfirm(false)}>
            <div className="w-[480px] max-w-[92vw] rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-6" onClick={(e) => e.stopPropagation()}>
              <p className="t-micro-cap mb-2">Confirm build</p>
              <h2 className="t-h-lg text-[var(--color-ink)]">Save this as a model portfolio.</h2>
              <p className="t-body-md mt-1 text-[var(--color-ink-mute)]">{providerName} &middot; {holdings.length} funds &middot; weights total 100%.</p>

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
      </aside>
    </div>
  );
}

function Metric({ label, value, valueCls, suffix }: { label: string; value: string; valueCls?: string; suffix?: string }) {
  return (
    <div>
      <p className="t-caption text-[var(--color-ink-mute)]">{label}</p>
      <p className="t-h-md mt-1">
        <span className={`num ${valueCls ?? "text-[var(--color-ink)]"}`}>{value}</span>
        {suffix ? <span className="ml-1 t-caption text-[var(--color-ink-mute)]">{suffix}</span> : null}
      </p>
    </div>
  );
}

function AggBar({ items }: { items: { label: string; weight_pct: number }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((a) => (
        <li key={a.label} className="flex items-center gap-3">
          <span className="t-body-md w-32 shrink-0 truncate text-[var(--color-ink-2)]" title={a.label}>{a.label}</span>
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-hairline-2)]">
            <span
              className="absolute inset-y-0 left-0 bg-[var(--color-primary)]"
              style={{ width: `${Math.min(100, a.weight_pct).toFixed(2)}%` }}
            />
          </span>
          <span className="num w-14 shrink-0 text-right text-[12px] text-[var(--color-ink)]">{a.weight_pct.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

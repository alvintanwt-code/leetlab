"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { FundInspector } from "./FundInspector";
import { TrailingChart } from "./TrailingChart";
import type { FundInspectorData, AllocationDetail } from "@/lib/db/queries";

// Synonyms that expand a user query token to plausible variants present in
// fund metadata. Lets "equities US" find Equity / USD / USA funds, etc.
const SEARCH_SYNONYMS: Record<string, string[]> = {
  equities: ["equity"],
  equity: ["equities"],
  stocks: ["stock", "equity"],
  bonds: ["bond", "fixed income"],
  bond: ["bonds", "fixed income"],
  "fixed-income": ["bond", "fixed income"],
  us: ["united states", "usd", "american", "u.s."],
  usa: ["us", "united states", "usd"],
  america: ["american", "us", "usd"],
  global: ["world", "international"],
  world: ["global", "international"],
  asia: ["asian"],
  asian: ["asia"],
  europe: ["european", "euro", "eur"],
  european: ["europe", "euro", "eur"],
  china: ["chinese", "mainland"],
  japan: ["japanese", "jpy"],
  india: ["indian"],
  emerging: ["em"],
  income: ["dividend", "yield", "distributing", "dist"],
  dividend: ["income", "yield", "distributing", "dist"],
  growth: ["accumulating", "acc"],
  tech: ["technology"],
  technology: ["tech"],
  healthcare: ["health"],
};

function expandToken(t: string): string[] {
  const lower = t.toLowerCase();
  const set = new Set<string>([lower]);
  // Light stemming for plural → singular ("equities" → "equity", "bonds" → "bond")
  if (lower.length > 4 && lower.endsWith("ies")) set.add(lower.slice(0, -3) + "y");
  else if (lower.length > 3 && lower.endsWith("s")) set.add(lower.slice(0, -1));
  const explicit = SEARCH_SYNONYMS[lower];
  if (explicit) explicit.forEach((s) => set.add(s));
  return Array.from(set);
}

function fundHaystack(f: FundInspectorData): string {
  return [
    f.name,
    f.fund_house,
    f.external_id,
    f.isin,
    f.asset_class,
    f.currency,
    f.benchmark,
    f.investment_objective,
    f.distribution_type === "Acc"
      ? "accumulating"
      : f.distribution_type === "Dist"
      ? "distributing"
      : f.distribution_type ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

type ChartData = {
  funds: { isin: string; name: string; weight: number; points: { d: string; v: number }[]; terminal: number }[];
  model: { points: { d: string; v: number }[]; terminal: number };
  commonStart: string;
  commonEnd: string;
  skipped: number;
};

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

export type ProviderTab = { slug: string; short: string; count: number; disabled: boolean };

export type SavedPortfolioRef = {
  id: number;
  name: string;
  category: string;
  version: number;
  confirmed_at: string | null;
  holding_count: number;
};

export function StudioShell({
  providerSlug,
  providerName,
  providerTabs,
  funds,
  allocations,
  documents,
  savedPortfolios,
}: {
  providerSlug: string;
  providerName: string;
  providerTabs: ProviderTab[];
  funds: FundInspectorData[];
  allocations: AllocationDetail[];
  documents: DocByFund;
  savedPortfolios: SavedPortfolioRef[];
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
  // Manage saved portfolios modal — hidden surface for delete.
  const [showManage, setShowManage] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedPortfolioRef | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  // Track which weight input is focused so we can show the placeholder
  // (empty field) instead of a literal "0" while the user is typing.
  const [focusedWeightId, setFocusedWeightId] = useState<number | null>(null);

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
    const q = search.trim();
    if (!q) return funds;
    const tokens = q.split(/\s+/).filter(Boolean);
    return funds.filter((f) => {
      const h = fundHaystack(f);
      // Each token (with its synonyms/stems) must match somewhere in the haystack.
      return tokens.every((t) => expandToken(t).some((v) => h.includes(v)));
    });
  }, [funds, search]);

  const totalBps = basket.reduce((s, h) => s + h.weightBps, 0);
  const totalPct = totalBps / 100;
  const canConfirm = totalBps === 10000 && basket.length > 0;

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

      // Compute this fund's equity proportion from its asset allocation, so sector/geo
      // (which are equity-sleeve breakdowns) can be scaled by the equity weight.
      const stockAlloc = allocs.find((a) => a.kind === "asset" && /stock/i.test(a.label));
      const equityShare = stockAlloc ? stockAlloc.weight_pct / 100 : (f.asset_class?.toLowerCase().includes("equity") ? 1 : 0);
      equityCoverage += w * equityShare;

      for (const a of allocs) {
        if (a.kind === "geography") {
          aggGeo[a.label] = (aggGeo[a.label] ?? 0) + w * equityShare * a.weight_pct;
        } else if (a.kind === "sector") {
          aggSector[a.label] = (aggSector[a.label] ?? 0) + w * equityShare * a.weight_pct;
        } else if (a.kind === "holding") {
          // Filter garbled bond-fund holdings (weight > 100% impossible, or
          // label is just a date fragment like "11/15/" from a parser split
          // on an embedded coupon %).
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

    // Normalise sector/geo (each is a breakdown of the equity sleeve, so divide by the
    // total equity exposure to sum to ~100%).
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

  const [chart, setChart] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  // Stale the chart whenever basket changes — user must re-analyse to refresh.
  useEffect(() => { setChart(null); setChartError(null); }, [basket]);

  async function analysePerformance() {
    setChartLoading(true); setChartError(null);
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

  async function deleteSavedPortfolio() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/portfolios/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      setDeleteTarget(null);
      setDeleteInput("");
      router.refresh();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  async function loadSavedIntoBasket(p: SavedPortfolioRef) {
    setLoadingEditId(p.id);
    setEditError(null);
    try {
      const res = await fetch(`/api/portfolios/${p.id}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        holdings: Array<{ fundId: number; weightBps: number }>;
        category: string;
      };
      // Replace the basket with this portfolio's holdings. Also pre-fill the
      // mandate selector so the advisor keeps continuity on save.
      setBasket(data.holdings);
      if (data.category && CATEGORIES.some((c) => c.key === data.category)) {
        setConfirmCategory(data.category as CategoryKey);
      }
      setShowManage(false);
      setDeleteTarget(null);
    } catch (e) {
      setEditError(`Couldn't load ${p.name}: ${(e as Error).message}`);
    } finally {
      setLoadingEditId(null);
    }
  }

  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* LEFT — fund picker (provider tabs + search + list as one panel) */}
      <section className="flex w-[20vw] min-w-[240px] shrink-0 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <nav
        aria-label="Provider"
        className="flex h-[52px] shrink-0 items-center justify-center gap-1.5 overflow-x-auto border-b border-[var(--color-hairline)] bg-[var(--color-canvas)] px-4"
      >
        {providerTabs.map((t) => {
          const active = t.slug === providerSlug;
          const base =
            "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 t-caption transition-colors";
          if (t.disabled) {
            return (
              <span
                key={t.slug}
                aria-disabled="true"
                className={`${base} text-[var(--color-ink-mute)] opacity-55`}
                title={`${t.short} · not yet scraped`}
              >
                {t.short}
                <span className="num text-[10px]">—</span>
              </span>
            );
          }
          return (
            <Link
              key={t.slug}
              href={`/construction/${t.slug}`}
              className={`${base} ${
                active
                  ? "bg-[var(--color-canvas-soft)] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              {t.short}
              <span className="num text-[10px] text-[var(--color-ink-mute)]">{t.count}</span>
            </Link>
          );
        })}
      </nav>
        <div className="border-b border-[var(--color-hairline)] px-4 py-2.5">
          <p className="t-micro-cap mb-1.5">Click name to inspect · + to add</p>
          <div className="flex items-center gap-2 rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-1.5">
            <span className="text-[var(--color-ink-mute)]">⌕</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Try: equities, US, global, income…  ( / )"
              className="t-body-md w-full bg-transparent outline-none placeholder:text-[var(--color-ink-mute)]"
            />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {filteredFunds.length === 0 ? (
            <li className="px-4 py-8 text-center t-body-md text-[var(--color-ink-mute)]">No matches.</li>
          ) : (
            filteredFunds.map((f) => {
              const inBasket = basket.some((h) => h.fundId === f.id);
              const k = classKey(f.asset_class);
              return (
                <li
                  key={f.id}
                  className="group flex items-center gap-2 px-4 py-1 hover:bg-[var(--color-canvas-soft)] cursor-pointer"
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
      <section className="flex flex-1 min-w-0 flex-col overflow-hidden bg-[var(--color-canvas-soft)]">
        <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--color-hairline)] bg-[var(--color-canvas)] px-6">
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
            <button
              onClick={() => { setShowManage(true); setDeleteTarget(null); setDeleteInput(""); setDeleteError(null); }}
              className="t-caption whitespace-nowrap px-2 py-1.5 text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
              title="Manage saved portfolios on this platform"
            >
              Saved &middot; <span className="num">{savedPortfolios.length}</span>
            </button>
            <span className="mx-1 h-4 w-px bg-[var(--color-hairline)]" aria-hidden />
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
              <div className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
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
                              placeholder="0"
                              value={
                                focusedWeightId === h.fundId && h.weightBps === 0
                                  ? ""
                                  : h.weightBps / 100
                              }
                              onFocus={(e) => {
                                setFocusedWeightId(h.fundId);
                                e.target.select();
                              }}
                              onBlur={() => setFocusedWeightId(null)}
                              onChange={(e) => setWeight(h.fundId, parseFloat(e.target.value || "0"))}
                              className="num w-20 rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-2 py-1 text-right text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-mute)] focus:border-[var(--color-primary)]"
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

              {/* Portfolio X-ray — analysis panel with editorial mandate strip */}
              {xray && (
                <section className="mt-6 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
                  {/* Editorial header */}
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <p className="t-body-lg font-medium text-[var(--color-ink)]">Portfolio X-ray</p>
                    <p className="t-micro-cap">
                      Weighted exposure
                      {xray.risk != null && (
                        <> &nbsp;&middot;&nbsp; Risk{" "}
                          {Number.isInteger(xray.risk) ? xray.risk.toFixed(0) : xray.risk.toFixed(1)}/5
                        </>
                      )}
                    </p>
                  </div>

                  {/* Mandate facts strip — Equity / Fixed Income / OCF / Funds */}
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

                  {/* Weighted trailing returns — 4 return tiles, fundamentals row dropped (now in mandate strip) */}
                  <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
                    <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
                      <p className="t-body-lg font-medium text-[var(--color-ink)]">Weighted trailing returns</p>
                      <p className="t-micro-cap">Weight-average</p>
                    </div>
                    <div className="grid grid-cols-2 gap-0 divide-x divide-[var(--color-hairline-2)] md:grid-cols-4">
                      <KpiTile label="1Y" {...fmtPctMetric(xray.r1y)} />
                      <KpiTile label="3Y pa" {...fmtPctMetric(xray.r3y)} />
                      <KpiTile label="5Y pa" {...fmtPctMetric(xray.r5y)} />
                      <KpiTile label="10Y pa" {...fmtPctMetric(xray.r10y)} />
                    </div>
                  </section>

                  {/* Sector + Geographic allocation — two-column */}
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

                  {/* Top 10 look-through holdings */}
                  {xray.holdings.length > 0 && (
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

                  {/* Trailing performance chart */}
                  <section className="mt-4">
                    {chart ? (
                      <TrailingChart {...chart} />
                    ) : (
                      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-8 text-center">
                        <p className="t-body-lg mb-2 font-medium text-[var(--color-ink)]">Trailing performance</p>
                        <p className="t-micro-cap mb-3">Growth of 100</p>
                        <p className="t-body-md mx-auto max-w-md text-[var(--color-ink-mute)]">
                          Pull a live Morningstar look-through for each component and chart the weight-blended model line against its components, rebased to 100.
                        </p>
                        {chartError && <p className="mt-3 t-caption text-[var(--color-negative)]">{chartError}</p>}
                        <button
                          onClick={analysePerformance}
                          disabled={chartLoading || basket.length === 0}
                          className={`mt-5 btn-pill ${chartLoading || basket.length === 0 ? "btn-ghost opacity-60" : "btn-primary"}`}
                        >
                          {chartLoading ? "Fetching from Morningstar…" : "Analyse trailing performance"}
                        </button>
                      </div>
                    )}
                  </section>
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

      {/* Manage saved portfolios modal — admin surface for delete */}
      {showManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(13,37,61,0.45)]"
          onClick={() => { if (!deleting) { setShowManage(false); setDeleteTarget(null); } }}
        >
          <div
            className="flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="border-b border-[var(--color-hairline)] px-6 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="t-body-lg font-medium text-[var(--color-ink)]">Saved portfolios</p>
                <p className="t-micro-cap">{providerName}</p>
              </div>
              <p className="t-caption mt-1 text-[var(--color-ink-mute)]">
                <span className="num">{savedPortfolios.length}</span>{" "}
                {savedPortfolios.length === 1 ? "portfolio" : "portfolios"} confirmed on this platform.
              </p>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-3">
              {editError && (
                <div className="mb-3 rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] px-3 py-2">
                  <p className="t-caption text-[var(--color-negative)]">{editError}</p>
                </div>
              )}
              {savedPortfolios.length === 0 ? (
                <p className="t-body-md py-8 text-center text-[var(--color-ink-mute)]">
                  No portfolios saved on {providerName} yet.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {savedPortfolios.map((p) => {
                    const isTarget = deleteTarget?.id === p.id;
                    const categoryLabel = CATEGORIES.find((c) => c.key === p.category)?.label ?? p.category;
                    return (
                      <li
                        key={p.id}
                        className="border-b border-[var(--color-hairline-2)] py-3 last:border-0"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="t-body-md truncate text-[var(--color-ink)]" title={p.name}>
                              {p.name}
                            </p>
                            <p className="t-caption mt-0.5 text-[var(--color-ink-mute)]">
                              {categoryLabel} &middot; v<span className="num">{p.version}</span> &middot;{" "}
                              <span className="num">{p.holding_count}</span> {p.holding_count === 1 ? "fund" : "funds"}
                            </p>
                          </div>
                          {!isTarget && (
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={() => loadSavedIntoBasket(p)}
                                disabled={loadingEditId != null}
                                className="t-caption px-2 py-1 text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                              >
                                {loadingEditId === p.id ? "Loading…" : "Edit"}
                              </button>
                              <button
                                onClick={() => { setDeleteTarget(p); setDeleteInput(""); setDeleteError(null); }}
                                disabled={loadingEditId != null}
                                className="t-caption px-2 py-1 text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-negative)] disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                        {isTarget && (
                          <div className="mt-3 rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] p-3">
                            <p className="t-caption text-[var(--color-ink-2)]">
                              Type <span className="num text-[var(--color-ink)]">{p.name}</span> to confirm permanent deletion.
                            </p>
                            <input
                              type="text"
                              value={deleteInput}
                              onChange={(e) => setDeleteInput(e.target.value)}
                              placeholder={p.name}
                              disabled={deleting}
                              autoFocus
                              className="t-body-md mt-2 w-full rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2 outline-none focus:border-[var(--color-negative)]"
                            />
                            {deleteError && (
                              <p className="mt-2 t-caption text-[var(--color-negative)]">{deleteError}</p>
                            )}
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button
                                onClick={() => { setDeleteTarget(null); setDeleteInput(""); setDeleteError(null); }}
                                disabled={deleting}
                                className="btn-pill btn-ghost"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={deleteSavedPortfolio}
                                disabled={deleteInput !== p.name || deleting}
                                className="btn-pill text-white"
                                style={{
                                  background: "var(--color-negative)",
                                  opacity: deleteInput === p.name && !deleting ? 1 : 0.55,
                                  cursor: deleteInput === p.name && !deleting ? "pointer" : "not-allowed",
                                }}
                              >
                                {deleting ? "Deleting…" : "Delete permanently"}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer className="border-t border-[var(--color-hairline)] px-6 py-3">
              <div className="flex justify-end">
                <button
                  onClick={() => { setShowManage(false); setDeleteTarget(null); }}
                  disabled={deleting}
                  className="btn-pill btn-ghost"
                >
                  Close
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// Editorial KPI: small-caps label on top, 22px medium-ink value below.
// Matches PortfolioDetail's Fact pattern.
function KpiTile({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <p className="t-micro-cap mb-1.5">{label}</p>
      <p className={`num text-[22px] font-medium leading-none ${valueCls ?? "text-[var(--color-ink)]"}`}>{value}</p>
    </div>
  );
}

function fmtPctMetric(v: number | null): { value: string; valueCls: string } {
  const f = fmtPct(v);
  return { value: f.text, valueCls: f.cls };
}

// Editorial bar — 2px hairline-thin, monochrome ink fill on hairline-2 track.
// `color` prop kept for back-compat but ignored; callers should drop it.
function BarsRow({ items }: { items: { label: string; weight_pct: number }[]; color?: string }) {
  const max = items.length > 0 ? items[0].weight_pct : 1;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((a) => (
        <li key={a.label} className="flex items-center gap-3">
          <span className="t-body-md w-32 shrink-0 truncate text-[var(--color-ink-2)]" title={a.label}>{a.label}</span>
          <span className="relative h-[2px] flex-1 bg-[var(--color-hairline-2)]">
            <span
              className="absolute inset-y-0 left-0 bg-[var(--color-ink)]"
              style={{ width: `${Math.max(1, Math.min(100, (a.weight_pct / max) * 100)).toFixed(1)}%` }}
            />
          </span>
          <span className="num w-14 shrink-0 text-right text-[12px] text-[var(--color-ink)]">{a.weight_pct.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

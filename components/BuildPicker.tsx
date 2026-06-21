"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FundInspectorData, AllocationDetail } from "@/lib/db/queries";

// Step-1 picker for the build flow. Users browse the in-scope universe, filter
// by asset class / region / dividend payers, and pick funds into a right-side
// cart. "Confirm build" stores selected IDs in sessionStorage and hands off to
// /construction/[provider] (StudioShell) for weighting + confirmation.

// ---------------- helpers ----------------

type ClassKey = "E" | "F" | "A" | "L" | "C" | "M";

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

const CLASS_LABEL: Record<ClassKey, string> = {
  E: "Equity",
  F: "Fixed income",
  A: "Multi-asset",
  L: "Alternative",
  C: "Commodities",
  M: "Cash",
};

const CLASS_CHIP: Record<ClassKey, string> = {
  E: "chip-asset-equity",
  F: "chip-asset-fi",
  A: "chip-asset-multi",
  L: "chip-asset-alt",
  C: "chip-asset-commod",
  M: "chip-asset-cash",
};

// Collapse Morningstar's fine-grained geography labels into a small set of
// regions the advisor can scan. "Global" is the catch-all when no single region
// dominates (top region < 50% weight) or the data is missing.
type RegionKey = "US" | "Europe" | "Asia" | "EM" | "Global" | "Commodities" | "Cash" | "Unknown";

const REGION_LABEL: Record<RegionKey, string> = {
  US: "US",
  Europe: "Europe",
  Asia: "Asia",
  EM: "EM",
  Global: "Global",
  Commodities: "Commodities",
  Cash: "Cash",
  Unknown: "—",
};

function regionFor(label: string): RegionKey | null {
  const s = label.toLowerCase();
  if (s.includes("united states") || s.includes("north america")) return "US";
  if (s.includes("emerg") || s.includes("latin") || s.includes("africa") || s.includes("middle east")) return "EM";
  if (s.includes("japan") || s.includes("asia") || s.includes("pacific") || s.includes("china") || s.includes("india")) return "Asia";
  if (s.includes("europe") || s.includes("uk") || s.includes("eurozone") || s.includes("united kingdom")) return "Europe";
  if (s.includes("global") || s.includes("world")) return "Global";
  return null;
}

function deriveRegion(geo: { label: string; weight_pct: number }[], cls: ClassKey): RegionKey {
  if (cls === "C") return "Commodities";
  if (cls === "M") return "Cash";
  if (geo.length === 0) return "Global";
  const buckets = new Map<RegionKey, number>();
  for (const g of geo) {
    const k = regionFor(g.label);
    if (!k) continue;
    buckets.set(k, (buckets.get(k) ?? 0) + g.weight_pct);
  }
  if (buckets.size === 0) return "Global";
  let topKey: RegionKey = "Global";
  let topPct = 0;
  for (const [k, v] of buckets) {
    if (v > topPct) { topKey = k; topPct = v; }
  }
  if (topPct < 50) return "Global";
  return topKey;
}

function fmtPct(v: number | null | undefined, places = 1): { text: string; cls: string } {
  if (v == null || !Number.isFinite(v)) return { text: "—", cls: "text-[var(--color-ink-mute)]" };
  if (Math.abs(v) < 0.05) return { text: `0.${"0".repeat(places)}%`, cls: "text-[var(--color-ink)]" };
  const sign = v > 0 ? "+" : "−";
  const cls = v > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  return { text: `${sign}${Math.abs(v).toFixed(places)}%`, cls };
}

// ---------------- types ----------------

type ProviderTab = { slug: string; short: string; count: number; disabled: boolean };

type RichFund = FundInspectorData & {
  cls: ClassKey;
  region: RegionKey;
  geoTop: string | null;
};

// ---------------- component ----------------

export function BuildPicker({
  providerSlug,
  providerName,
  providerTabs,
  funds,
  allocations,
}: {
  providerSlug: string;
  providerName: string;
  providerTabs: ProviderTab[];
  funds: FundInspectorData[];
  allocations: AllocationDetail[];
}) {
  const router = useRouter();

  // Index allocations by fundId so we can compute the region per fund.
  const geoByFund = useMemo(() => {
    const m = new Map<number, { label: string; weight_pct: number }[]>();
    for (const a of allocations) {
      if (a.kind !== "geography") continue;
      const arr = m.get(a.fund_id) ?? [];
      arr.push({ label: a.label, weight_pct: a.weight_pct });
      m.set(a.fund_id, arr);
    }
    return m;
  }, [allocations]);

  // Enrich each fund with derived asset-class + region tags.
  const rich: RichFund[] = useMemo(
    () =>
      funds.map((f) => {
        const cls = classKey(f.asset_class);
        const geo = geoByFund.get(f.id) ?? [];
        const region = deriveRegion(geo, cls);
        return { ...f, cls, region, geoTop: geo[0]?.label ?? null };
      }),
    [funds, geoByFund],
  );

  // Filter state — defaults to "All on". Sets keep filter logic uniform.
  const [classOn, setClassOn] = useState<Set<ClassKey>>(new Set(["E", "F", "A", "L", "C", "M"]));
  const [regionOn, setRegionOn] = useState<Set<RegionKey>>(
    new Set(["US", "Europe", "Asia", "EM", "Global", "Commodities", "Cash", "Unknown"]),
  );
  const [dividendOnly, setDividendOnly] = useState(false);
  const [search, setSearch] = useState("");

  // Selected funds (the "cart") — kept as ID set for cheap membership checks.
  // Hydrated from sessionStorage on mount + mirrored back on every change so
  // bouncing between /picker and /review preserves the staged selection.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`build-picker:v1:${providerSlug}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { ids?: number[] };
        setSelectedIds(new Set(parsed.ids ?? []));
      }
    } catch {
      // ignore — start with empty selection
    }
    setHydrated(true);
  }, [providerSlug]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        `build-picker:v1:${providerSlug}`,
        JSON.stringify({ ids: Array.from(selectedIds) }),
      );
    } catch {
      // storage unavailable — Confirm-build hand-off will no-op
    }
  }, [hydrated, providerSlug, selectedIds]);

  // Sort state. Default = alphabetical by name. Click a numeric header to flip
  // to that column desc (highest first); click the same header again to revert
  // to alphabetical.
  type SortKey = "name" | "ann_1y" | "ann_3y" | "ann_5y";
  const [sortKey, setSortKey] = useState<SortKey>("name");

  function toggleSort(k: Exclude<SortKey, "name">) {
    setSortKey((prev) => (prev === k ? "name" : k));
  }

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = rich.filter((f) => {
      if (selectedIds.has(f.id)) return false;
      if (!classOn.has(f.cls)) return false;
      if (!regionOn.has(f.region)) return false;
      if (dividendOnly && f.distribution_type !== "Dist") return false;
      if (needle && !f.name.toLowerCase().includes(needle) && !(f.fund_house ?? "").toLowerCase().includes(needle))
        return false;
      return true;
    });
    if (sortKey === "name") {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      filtered.sort((a, b) => {
        const av = a[sortKey] as number | null;
        const bv = b[sortKey] as number | null;
        if (av == null && bv == null) return a.name.localeCompare(b.name);
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
    }
    return filtered;
  }, [rich, classOn, regionOn, dividendOnly, search, selectedIds, sortKey]);

  const selectedRows = useMemo(
    () => rich.filter((f) => selectedIds.has(f.id)),
    [rich, selectedIds],
  );

  function toggleClass(k: ClassKey) {
    setClassOn((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function toggleRegion(k: RegionKey) {
    setRegionOn((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function pick(id: number) {
    setSelectedIds((s) => new Set(s).add(id));
  }
  function unpick(id: number) {
    setSelectedIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  function confirmBuild() {
    if (selectedRows.length === 0) return;
    // sessionStorage is already in sync via the hydrate-mirror effect above;
    // /review reads the same key on mount.
    router.push(`/construction/${providerSlug}/review`);
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-20 pb-16">
      {/* Sticky chrome — anchor + platform tabs, same shape as /switch + /portfolios */}
      <div className="sticky top-0 z-20 -mx-20 mb-12 bg-[var(--color-canvas-soft)] px-20">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline-2)] py-6">
          <div>
            <p className="t-micro-cap mb-1">Advisor workspace</p>
            <h1 className="t-h-md text-[var(--color-ink)]">Build portfolio</h1>
          </div>
          <p className="t-caption text-[var(--color-ink-mute)]">
            {providerName} · {rich.length} funds in-scope
          </p>
        </header>
        <div className="flex items-center gap-6 border-b border-[var(--color-hairline-2)]">
          <p className="t-micro-cap w-20 shrink-0 py-2">Platform</p>
          <nav aria-label="Platform" className="flex items-center gap-3 overflow-x-auto">
            {providerTabs.map((t) => {
              const active = !t.disabled && t.slug === providerSlug;
              const cls = "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 pt-2 pb-2 -mb-px t-caption transition-colors";
              if (t.disabled) {
                return (
                  <span
                    key={t.slug}
                    aria-disabled="true"
                    className={`${cls} cursor-not-allowed border-transparent text-[var(--color-ink-mute)] opacity-50`}
                    title={`${t.short} — no funds`}
                  >
                    {t.short}
                  </span>
                );
              }
              return (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => router.push(`/construction/${t.slug}/picker`)}
                  className={`${cls} ${
                    active
                      ? "border-[var(--color-ink)] text-[var(--color-ink)] font-medium"
                      : "border-transparent text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {t.short}
                  <span className="num text-[10px] text-[var(--color-ink-mute)]">{t.count}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* LEFT — search + fund table */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by fund name or fund house…"
              className="t-body-md w-full bg-transparent text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-mute)]"
            />
            <p className="t-micro-cap shrink-0 text-[var(--color-ink-mute)]">
              <span className="num">{filteredRows.length}</span> shown
            </p>
          </div>
          <FundTable rows={filteredRows} onPick={pick} sortKey={sortKey} onToggleSort={toggleSort} />
        </div>

        {/* RIGHT — filter panel + selected cart, both natural-height */}
        <aside className="flex flex-col gap-4">
          <FilterPanel
            classOn={classOn}
            regionOn={regionOn}
            dividendOnly={dividendOnly}
            onToggleClass={toggleClass}
            onToggleRegion={toggleRegion}
            onToggleDividend={() => setDividendOnly((v) => !v)}
            onAllClasses={() => setClassOn(new Set(["E", "F", "A", "L", "C", "M"]))}
            onNoClasses={() => setClassOn(new Set())}
            onAllRegions={() => setRegionOn(new Set(["US", "Europe", "Asia", "EM", "Global", "Commodities", "Cash", "Unknown"]))}
            onNoRegions={() => setRegionOn(new Set())}
          />
          <SelectedCart
            rows={selectedRows}
            onRemove={unpick}
            onConfirm={confirmBuild}
            providerSlug={providerSlug}
          />
        </aside>
      </div>
    </div>
  );
}

// ---------------- fund table ----------------

type SortableKey = "ann_1y" | "ann_3y" | "ann_5y";

function SortHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-ink)]"
    >
      {label}
      <span className={`text-[8px] leading-none ${active ? "text-[var(--color-ink)]" : "text-[var(--color-hairline)]"}`}>
        ▼
      </span>
    </button>
  );
}

function FundTable({
  rows,
  onPick,
  sortKey,
  onToggleSort,
}: {
  rows: RichFund[];
  onPick: (id: number) => void;
  sortKey: "name" | SortableKey;
  onToggleSort: (k: SortableKey) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-10 text-center">
        <p className="t-micro-cap mb-2">No funds match</p>
        <p className="t-body-md text-[var(--color-ink-mute)]">
          Loosen a filter, clear the search, or pick a different platform.
        </p>
      </div>
    );
  }
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <div className="overflow-x-auto">
        <table className="table-pro table-pro-xs" style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: "30%" }} />
            <col style={{ width: 88 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 36 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Fund</th>
              <th>Class</th>
              <th>Region</th>
              <th className="right">YTD</th>
              <th className="right">
                <SortHeader label="1Y" active={sortKey === "ann_1y"} onClick={() => onToggleSort("ann_1y")} />
              </th>
              <th className="right">
                <SortHeader label="3Y" active={sortKey === "ann_3y"} onClick={() => onToggleSort("ann_3y")} />
              </th>
              <th className="right">
                <SortHeader label="5Y" active={sortKey === "ann_5y"} onClick={() => onToggleSort("ann_5y")} />
              </th>
              <th className="right">Vol</th>
              <th className="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const r1 = fmtPct(f.ann_1y);
              const r3 = fmtPct(f.ann_3y);
              const r5 = fmtPct(f.ann_5y);
              return (
                <tr key={f.id}>
                  <td className="cell-fund">
                    <span className="name text-[var(--color-ink)]" title={f.name}>{f.name}</span>
                    {f.fund_house && <span className="meta" title={f.fund_house ?? undefined}>{f.fund_house}</span>}
                  </td>
                  <td>
                    <span className={`chip-asset ${CLASS_CHIP[f.cls]}`} title={CLASS_LABEL[f.cls]}>
                      <span className="lbl">{CLASS_LABEL[f.cls]}</span>
                    </span>
                  </td>
                  <td>
                    <span className="t-caption text-[var(--color-ink-2)]">{REGION_LABEL[f.region]}</span>
                  </td>
                  <td className="nowrap right"><span className="num text-[var(--color-ink-mute)]">—</span></td>
                  <td className="nowrap right"><span className={`num ${r1.cls}`}>{r1.text}</span></td>
                  <td className="nowrap right"><span className={`num ${r3.cls}`}>{r3.text}</span></td>
                  <td className="nowrap right"><span className={`num ${r5.cls}`}>{r5.text}</span></td>
                  <td className="nowrap right"><span className="num text-[var(--color-ink-mute)]">—</span></td>
                  <td className="right">
                    <button
                      type="button"
                      onClick={() => onPick(f.id)}
                      aria-label={`Add ${f.name}`}
                      className="inline-flex h-6 w-6 items-center justify-center border border-[var(--color-hairline)] text-[var(--color-ink-mute)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
                      title="Add to selection"
                    >
                      +
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------- filter panel ----------------

function FilterPanel({
  classOn,
  regionOn,
  dividendOnly,
  onToggleClass,
  onToggleRegion,
  onToggleDividend,
  onAllClasses,
  onNoClasses,
  onAllRegions,
  onNoRegions,
}: {
  classOn: Set<ClassKey>;
  regionOn: Set<RegionKey>;
  dividendOnly: boolean;
  onToggleClass: (k: ClassKey) => void;
  onToggleRegion: (k: RegionKey) => void;
  onToggleDividend: () => void;
  onAllClasses: () => void;
  onNoClasses: () => void;
  onAllRegions: () => void;
  onNoRegions: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3 transition-colors hover:bg-[var(--color-canvas-soft)]"
      >
        <p className="t-body-md font-medium text-[var(--color-ink)]">Filters</p>
        <p className="t-micro-cap">{open ? "Hide" : "Show"}</p>
      </button>
      {open && (
        <div className="flex flex-col gap-4 px-5 py-4">
          {/* Asset class + Region side-by-side so the panel stays short */}
          <div className="grid grid-cols-2 gap-4">
            <FilterGroup
              title="Asset class"
              onAll={onAllClasses}
              onNone={onNoClasses}
              items={(["E", "F", "A", "L", "C", "M"] as ClassKey[]).map((k) => ({
                key: k,
                label: CLASS_LABEL[k],
                checked: classOn.has(k),
                onToggle: () => onToggleClass(k),
              }))}
            />
            <FilterGroup
              title="Region"
              onAll={onAllRegions}
              onNone={onNoRegions}
              items={(["US", "Europe", "Asia", "EM", "Global", "Commodities", "Cash"] as RegionKey[]).map((k) => ({
                key: k,
                label: REGION_LABEL[k],
                checked: regionOn.has(k),
                onToggle: () => onToggleRegion(k),
              }))}
            />
          </div>
          <div className="border-t border-[var(--color-hairline-2)] pt-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={dividendOnly}
                onChange={onToggleDividend}
                className="h-3.5 w-3.5 accent-[var(--color-ink)]"
              />
              <span className="t-caption text-[var(--color-ink)]">Dividend-paying only</span>
            </label>
          </div>
        </div>
      )}
    </section>
  );
}

// Each FilterGroup leads with an "All" checkbox that toggles every item in the
// group on / off, and renders indeterminate when the group is partially on —
// replaces the separate "All · None" button row from the older revision.
function FilterGroup<K extends string>({
  title,
  items,
  onAll,
  onNone,
}: {
  title: string;
  items: { key: K; label: string; checked: boolean; onToggle: () => void }[];
  onAll: () => void;
  onNone: () => void;
}) {
  const allChecked = items.length > 0 && items.every((it) => it.checked);
  const anyChecked = items.some((it) => it.checked);
  const indeterminate = anyChecked && !allChecked;
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <div>
      <p className="t-micro-cap mb-2">{title}</p>
      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            ref={allRef}
            type="checkbox"
            checked={allChecked}
            onChange={() => (anyChecked ? onNone() : onAll())}
            className="h-3.5 w-3.5 accent-[var(--color-ink)]"
          />
          <span className="t-caption font-medium text-[var(--color-ink)]">All</span>
        </label>
        {items.map((it) => (
          <label key={it.key} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={it.checked}
              onChange={it.onToggle}
              className="h-3.5 w-3.5 accent-[var(--color-ink)]"
            />
            <span className="t-caption text-[var(--color-ink)]">{it.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------- selected cart ----------------

function SelectedCart({
  rows,
  onRemove,
  onConfirm,
  providerSlug,
}: {
  rows: RichFund[];
  onRemove: (id: number) => void;
  onConfirm: () => void;
  providerSlug: string;
}) {
  const empty = rows.length === 0;
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3">
        <p className="t-body-md font-medium text-[var(--color-ink)]">Selected</p>
        <p className="t-micro-cap">{rows.length} {rows.length === 1 ? "fund" : "funds"}</p>
      </div>
      {empty ? (
        <div className="px-5 py-8 text-center">
          <p className="t-body-md text-[var(--color-ink-mute)]">
            Use the <span className="num">+</span> button on each row to stage funds for the build.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col pb-3">
          {rows.map((f) => (
            <li
              key={f.id}
              className="flex items-start justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <span className={`chip-asset ${CLASS_CHIP[f.cls]} mb-1`}>
                  <span className="lbl">{CLASS_LABEL[f.cls]}</span>
                </span>
                <p
                  className="t-caption text-[var(--color-ink)]"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                  title={f.name}
                >
                  {f.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                aria-label={`Remove ${f.name}`}
                className="shrink-0 inline-flex h-6 w-6 items-center justify-center border border-[var(--color-hairline)] text-[var(--color-ink-mute)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-[var(--color-hairline-2)] px-5 py-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={empty}
          className="btn-pill btn-primary w-full disabled:opacity-50"
          title={empty ? "Pick at least one fund first" : `Hand off ${rows.length} funds to ${providerSlug.toUpperCase()} builder`}
        >
          Confirm build →
        </button>
      </div>
    </section>
  );
}

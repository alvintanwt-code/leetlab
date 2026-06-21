"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { SwitchMemo } from "@/lib/switch/types";
import {
  generateSwitch,
  parsePastedPortfolio,
  type ParsedHoldingRow,
} from "@/app/(app)/switch/actions";
import { FundSwitchMemo } from "@/components/FundSwitchMemo";
import {
  AssetChips,
  Kpi,
  PctText,
  ReturnText,
  RiskText,
  type PortfolioCardData,
} from "@/components/PortfolioCard";
import { CATEGORY_LABELS, PORTFOLIO_MANDATES } from "@/lib/portfolio-mandates";
import {
  ExistingPortfolioSummary,
  type ValidHolding,
} from "@/components/ExistingPortfolioSummary";

// Editorial provider names for the target-model row title — distinct from
// the compact nav labels in PROVIDER_SHORT above.
const PROVIDER_FULL: Record<string, string> = {
  hsbc: "HSBC Life",
  fwd: "FWD",
  tmls: "Tokio Marine",
  gwm: "GWM",
};

type Provider = { slug: string; name: string };

export type FundOption = {
  id: number;
  name: string;
  isin: string | null;
  fund_house: string | null;
  asset_class: string | null;
  risk_rating: number | null;
  expense_ratio: number | null;
  ann_1y: number | null;
  ann_3y: number | null;
  ann_5y: number | null;
  ann_10y: number | null;
};

// Per-fund sector + geo allocations from fund_allocations table. Keyed by
// fund_id. Used by ExistingPortfolioSummary to compute weighted exposure.
export type FundAllocations = {
  sector: { label: string; weight_pct: number }[];
  geography: { label: string; weight_pct: number }[];
};

export type Holding = {
  id: string;
  fund: string;
  fundId: number | null;
  units: string;
  unitPrice: string;
};

type PerPlatform = {
  holdings: Holding[];
  selectedModelId: number | null;
};

type WorkspaceState = Record<string, PerPlatform>;

const STORAGE_KEY = "fundswitch:v3";

// Canonical order + short labels shared with the build page and /portfolios.
const PROVIDER_ORDER = ["hsbc", "fwd", "tmls", "gwm"];
const PROVIDER_SHORT: Record<string, string> = {
  hsbc: "HSBC",
  fwd: "FWD",
  tmls: "TM",
  gwm: "GWM",
};

function newRow(): Holding {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return { id, fund: "", fundId: null, units: "", unitPrice: "" };
}

function defaultPerPlatform(): PerPlatform {
  return { holdings: [newRow()], selectedModelId: null };
}

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function holdingValue(h: Holding): number {
  const u = parseNum(h.units);
  const p = parseNum(h.unitPrice);
  return Number.isFinite(u) && Number.isFinite(p) && u > 0 && p > 0 ? u * p : 0;
}

function isHoldingValid(h: Holding): boolean {
  return h.fund.trim().length > 0 && holdingValue(h) > 0;
}

function fmtSGD(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  return v.toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  return `${v.toFixed(1)}%`;
}

function numToInputStr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(6)));
}

export function FundSwitchWorkspace({
  portfolios,
  providers,
  fundsByPlatform,
  allocationsByPlatform,
}: {
  portfolios: PortfolioCardData[];
  providers: Provider[];
  fundsByPlatform: Record<string, FundOption[]>;
  allocationsByPlatform: Record<string, Record<number, FundAllocations>>;
}) {
  const providerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of portfolios) {
      const slug = d.portfolio.provider_slug;
      m.set(slug, (m.get(slug) ?? 0) + 1);
    }
    return m;
  }, [portfolios]);

  const providersWithSaved = useMemo(
    () => providers.filter((p) => (providerCounts.get(p.slug) ?? 0) > 0),
    [providers, providerCounts],
  );

  const initialPlatform = providersWithSaved[0]?.slug ?? null;

  const [activePlatform, setActivePlatform] = useState<string | null>(initialPlatform);
  const [state, setState] = useState<WorkspaceState>({});
  const [hydrated, setHydrated] = useState(false);
  const [memo, setMemo] = useState<SwitchMemo | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteLoading, setPasteLoading] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { active?: string | null; state?: WorkspaceState };
        if (parsed.state && typeof parsed.state === "object") setState(parsed.state);
        if (
          parsed.active &&
          providersWithSaved.some((p) => p.slug === parsed.active)
        ) {
          setActivePlatform(parsed.active);
        }
      }
    } catch {
      // ignore corrupted storage
    }
    setHydrated(true);
  }, [providersWithSaved]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ active: activePlatform, state }),
      );
    } catch {
      // storage may be unavailable; surface no error to the advisor
    }
  }, [activePlatform, state, hydrated]);

  if (!initialPlatform) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-10">
        <ChromeTitle />
        <div className="mt-6 rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-12 text-center">
          <p className="t-body-md text-[var(--color-ink-mute)]">
            No confirmed model portfolios yet.{" "}
            <Link href="/portfolios" className="text-[var(--color-primary)]">
              Build one first →
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const platform = activePlatform!;
  const current: PerPlatform = state[platform] ?? defaultPerPlatform();
  const holdings = current.holdings.length > 0 ? current.holdings : [newRow()];

  function updateHolding(idx: number, patch: Partial<Holding>) {
    setState((s) => {
      const prev = s[platform] ?? defaultPerPlatform();
      const rows = (prev.holdings.length > 0 ? prev.holdings : [newRow()]).map((h, i) => {
        if (i !== idx) return h;
        const next = { ...h, ...patch };
        // Typing in the fund field invalidates a previously selected fundId
        // unless the patch explicitly sets a new one.
        if ("fund" in patch && !("fundId" in patch)) {
          next.fundId = null;
        }
        return next;
      });
      return { ...s, [platform]: { ...prev, holdings: rows } };
    });
  }

  function addRow() {
    setState((s) => {
      const prev = s[platform] ?? defaultPerPlatform();
      return { ...s, [platform]: { ...prev, holdings: [...prev.holdings, newRow()] } };
    });
  }

  function removeRow(idx: number) {
    setState((s) => {
      const prev = s[platform] ?? defaultPerPlatform();
      const rows = prev.holdings.filter((_, i) => i !== idx);
      return {
        ...s,
        [platform]: { ...prev, holdings: rows.length > 0 ? rows : [newRow()] },
      };
    });
  }

  function selectModel(id: number) {
    setState((s) => {
      const prev = s[platform] ?? defaultPerPlatform();
      return { ...s, [platform]: { ...prev, selectedModelId: id } };
    });
  }

  function applyParsedRows(rows: ParsedHoldingRow[]) {
    if (rows.length === 0) return;
    const newHoldings: Holding[] = rows.map((r) => ({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2),
      fund: r.fund,
      fundId: r.fundId ?? null,
      units: numToInputStr(r.units),
      unitPrice: numToInputStr(r.unitPrice),
    }));
    setState((s) => {
      const prev = s[platform] ?? defaultPerPlatform();
      const allEmpty = prev.holdings.every(
        (h) => h.fund.trim() === "" && h.units === "" && h.unitPrice === "",
      );
      const base = allEmpty ? [] : prev.holdings;
      return { ...s, [platform]: { ...prev, holdings: [...base, ...newHoldings] } };
    });
  }

  async function onParse() {
    if (pasteText.trim().length < 10) return;
    setPasteLoading(true);
    setPasteError(null);
    try {
      const result = await parsePastedPortfolio({
        text: pasteText,
        platformSlug: platform,
      });
      if (result.ok) {
        applyParsedRows(result.rows);
        setPasting(false);
        setPasteText("");
      } else {
        setPasteError(result.error);
      }
    } catch {
      setPasteError("Parse request failed. Try again.");
    } finally {
      setPasteLoading(false);
    }
  }

  function onCancelPaste() {
    setPasting(false);
    setPasteError(null);
  }

  function onGenerate() {
    if (current.selectedModelId == null) return;
    const payload = {
      modelId: current.selectedModelId,
      holdings: holdings.filter(isHoldingValid).map((h) => ({
        fund: h.fund.trim(),
        fundId: h.fundId ?? undefined,
        units: h.units,
        unitPrice: h.unitPrice,
      })),
    };
    setGenerateError(null);
    startTransition(async () => {
      const res = await generateSwitch(payload);
      if (res.ok) {
        setMemo(res.memo);
      } else {
        setGenerateError(res.error);
      }
    });
  }

  const platformModels = portfolios.filter((d) => d.portfolio.provider_slug === platform);
  const platformFunds = fundsByPlatform[platform] ?? [];
  const portfolioTotal = holdings.reduce((s, h) => s + holdingValue(h), 0);
  const validHoldingsCount = holdings.filter(isHoldingValid).length;
  const canGenerate = validHoldingsCount > 0 && current.selectedModelId != null;

  // Holdings ready for the summary: valid value AND bound to a fundId so the
  // summary can resolve sector/geo/series data from the platform metadata.
  const validSummaryHoldings: ValidHolding[] = holdings
    .filter((h) => isHoldingValid(h) && h.fundId != null)
    .map((h) => ({ fundId: h.fundId as number, value: holdingValue(h) }));

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10">
      <div className="sticky top-0 z-20 -mx-10 mb-6 bg-[var(--color-canvas-soft)] px-10">
        <ChromeTitle />
        <div className="flex items-center gap-6 border-b border-[var(--color-hairline)]">
          <p className="t-micro-cap w-20 shrink-0 py-2">Platform</p>
          <nav aria-label="Platform" className="flex items-center gap-3 overflow-x-auto">
            {[...providers]
              .sort((a, b) => PROVIDER_ORDER.indexOf(a.slug) - PROVIDER_ORDER.indexOf(b.slug))
              .map((p) => {
              const n = providerCounts.get(p.slug) ?? 0;
              const active = platform === p.slug;
              const disabled = n === 0;
              const label = PROVIDER_SHORT[p.slug] ?? p.name;
              if (disabled) {
                return (
                  <span
                    key={p.slug}
                    aria-disabled="true"
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2 pt-2 pb-2 -mb-px t-caption text-[var(--color-ink-mute)] opacity-50"
                    title={`${label} · no confirmed models`}
                  >
                    {label}
                  </span>
                );
              }
              return (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => setActivePlatform(p.slug)}
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 pt-2 pb-2 -mb-px t-caption transition-colors ${
                    active
                      ? "border-[var(--color-ink)] text-[var(--color-ink)] font-medium"
                      : "border-transparent text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {memo ? (
        <FundSwitchMemo memo={memo} onEdit={() => setMemo(null)} />
      ) : (
      <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
        <section className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="t-body-md font-medium text-[var(--color-ink)]">Client portfolio</h2>
            {pasting ? (
              <p className="t-micro-cap">Current holdings</p>
            ) : (
              <button
                type="button"
                onClick={() => setPasting(true)}
                className="t-caption text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink)]"
              >
                Paste portfolio →
              </button>
            )}
          </div>

          {pasting && (
            <div className="mb-4 rounded-md border border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] p-4">
              <p className="t-micro-cap mb-2">PASTE PORTFOLIO</p>
              <p className="t-caption mb-3 text-[var(--color-ink-mute)]">
                Paste a portfolio table from a statement, email, or broker portal. We&rsquo;ll match
                holdings against the {(PROVIDER_SHORT[platform] ?? platform)} fund universe.
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the portfolio text here…"
                rows={6}
                disabled={pasteLoading}
                className="block w-full resize-y rounded-sm border border-[var(--color-hairline-2)] bg-[var(--color-canvas)] p-3 t-body-md text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-mute)] placeholder:opacity-50 focus:border-[var(--color-primary)] disabled:opacity-60"
              />
              {pasteError && (
                <p className="t-caption mt-2 text-[var(--color-negative)]">{pasteError}</p>
              )}
              <div className="mt-3 flex items-center justify-end gap-5">
                <button
                  type="button"
                  onClick={onCancelPaste}
                  disabled={pasteLoading}
                  className="t-caption text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onParse}
                  disabled={pasteLoading || pasteText.trim().length < 10}
                  className={`t-caption font-medium transition-colors ${
                    pasteLoading || pasteText.trim().length < 10
                      ? "cursor-not-allowed text-[var(--color-ink-mute)]"
                      : "text-[var(--color-primary)] hover:text-[var(--color-primary-deep)]"
                  }`}
                >
                  {pasteLoading ? "Parsing…" : "Parse with AI →"}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)]">
            <table className="table-pro table-pro-sm w-full">
              <colgroup>
                <col />
                <col style={{ width: "100px" }} />
                <col style={{ width: "130px" }} />
                <col style={{ width: "140px" }} />
                <col style={{ width: "90px" }} />
                <col style={{ width: "36px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Fund</th>
                  <th className="right">Units</th>
                  <th className="right">Unit price</th>
                  <th className="right">Value</th>
                  <th className="right">Weight</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => {
                  const v = holdingValue(h);
                  const w = portfolioTotal > 0 ? (v / portfolioTotal) * 100 : 0;
                  return (
                    <HoldingInputRow
                      key={h.id}
                      h={h}
                      options={platformFunds}
                      value={v}
                      weightPct={w}
                      canRemove={holdings.length > 1}
                      onChange={(patch) => updateHolding(i, patch)}
                      onRemove={() => removeRow(i)}
                    />
                  );
                })}
              </tbody>
            </table>
            <button
              type="button"
              onClick={addRow}
              className="t-caption block w-full border-t border-dashed border-[var(--color-hairline-2)] px-3.5 py-3 text-left text-[var(--color-ink-mute)] transition-colors hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
            >
              + Add holding
            </button>
          </div>

          <p className="t-micro-cap mt-4 flex items-center justify-between text-[var(--color-ink-mute)]">
            <span>Type units &amp; unit price. Value and weight compute automatically.</span>
            <span>
              Total <span className="num">SGD {fmtSGD(portfolioTotal)}</span>
            </span>
          </p>
        </section>

        {/* Existing Portfolio Summary — appears in the same column as the
            holdings input, immediately below it, once at least one holding
            has parsed to a fundId + value. Width matches the holdings card. */}
        <ExistingPortfolioSummary
          validHoldings={validSummaryHoldings}
          fundsByPlatform={fundsByPlatform}
          allocationsByPlatform={allocationsByPlatform}
          platform={platform}
          totalValue={portfolioTotal}
        />
        </div>

        {/* Target Model — right column. Slim row variant: chips + title +
            mandate + risk + 3-up KPI strip. No chart, no funds count —
            still references the /portfolios design language.
            self-start opts out of grid's default stretch alignment so the
            card sizes to content instead of filling the column height. */}
        <section className="self-start overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="t-body-md font-medium text-[var(--color-ink)]">Target Model</h2>
            <p className="t-micro-cap">
              {(PROVIDER_SHORT[platform] ?? platform).toUpperCase()} · CONFIRMED
            </p>
          </div>

          <div className="-mx-5 -mb-5">
            {platformModels.length === 0 ? (
              <div className="mx-5 mb-5 rounded-md border border-dashed border-[var(--color-hairline-2)] px-4 py-8 text-center">
                <p className="t-micro-cap">No confirmed models on this platform yet</p>
              </div>
            ) : (
              platformModels.map((d) => (
                <SwitchModelRow
                  key={d.portfolio.id}
                  data={d}
                  selected={current.selectedModelId === d.portfolio.id}
                  onSelect={() => selectModel(d.portfolio.id)}
                />
              ))
            )}
          </div>
        </section>
      </div>

      <div className="mt-12 flex items-center justify-between">
        <p className="t-micro-cap text-[var(--color-ink-mute)]">
          {generateError
            ? generateError
            : validHoldingsCount > 0
            ? `${validHoldingsCount} holding${validHoldingsCount === 1 ? "" : "s"} ready · session-only, closing the tab discards it.`
            : "Generated memo is session-only. Closing the tab discards it."}
        </p>
        <button
          type="button"
          disabled={!canGenerate || pending}
          onClick={onGenerate}
          className={`t-caption rounded-full px-5 py-2.5 font-medium transition-colors ${
            canGenerate && !pending
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:bg-[var(--color-primary-deep)]"
              : "cursor-not-allowed bg-[var(--color-canvas-soft)] text-[var(--color-ink-mute)]"
          }`}
        >
          {pending
            ? "Generating…"
            : canGenerate
            ? "Generate switch"
            : "Add holdings and pick a model"}
        </button>
      </div>

      <div className="h-16" />
      </>
      )}
    </div>
  );
}

function ChromeTitle() {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline-2)] py-3">
      <div>
        <p className="t-micro-cap mb-1">Advisor workspace</p>
        <h1 className="t-h-md text-[var(--color-ink)]">Fund Switch</h1>
      </div>
      <p className="t-caption max-w-sm text-right text-[var(--color-ink-mute)]">
        Client portfolio in, switch memo out. Nothing persists.
      </p>
    </div>
  );
}

function HoldingInputRow({
  h,
  options,
  value,
  weightPct,
  canRemove,
  onChange,
  onRemove,
}: {
  h: Holding;
  options: FundOption[];
  value: number;
  weightPct: number;
  canRemove: boolean;
  onChange: (patch: Partial<Holding>) => void;
  onRemove: () => void;
}) {
  const cell =
    "block w-full bg-transparent t-body-md text-[var(--color-ink)] outline-none focus:bg-[var(--color-canvas-soft)] rounded-sm px-1 -mx-1 placeholder:text-[var(--color-ink-mute)] placeholder:opacity-50";
  const numCell = `${cell} num text-right`;
  return (
    <tr className="group">
      <td>
        <FundCombobox
          value={h.fund}
          fundId={h.fundId}
          options={options}
          onChange={(patch) => onChange(patch)}
          cellClassName={cell}
        />
      </td>
      <td className="nowrap right">
        <input
          type="text"
          inputMode="decimal"
          value={h.units}
          onChange={(e) => onChange({ units: e.target.value })}
          placeholder="—"
          className={numCell}
        />
      </td>
      <td className="nowrap right">
        <div className="flex items-baseline justify-end gap-1.5">
          <span className="t-micro-cap text-[var(--color-ink-mute)]">SGD</span>
          <input
            type="text"
            inputMode="decimal"
            value={h.unitPrice}
            onChange={(e) => onChange({ unitPrice: e.target.value })}
            placeholder="—"
            className={`${numCell} max-w-[80px]`}
          />
        </div>
      </td>
      <td className="nowrap right">
        <p className="num t-body-md text-[var(--color-ink-mute)]" title="Computed: units × unit price">
          <span className="t-micro-cap mr-1.5">SGD</span>
          {fmtSGD(value)}
        </p>
      </td>
      <td className="nowrap right">
        <p className="num t-body-md text-[var(--color-ink-mute)]" title="Computed: value ÷ total">
          {fmtPct(weightPct)}
        </p>
      </td>
      <td className="text-right">
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove holding"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[15px] leading-none text-[var(--color-ink-mute)] opacity-0 transition-opacity hover:text-[var(--color-ink)] group-hover:opacity-100"
          >
            ×
          </button>
        )}
      </td>
    </tr>
  );
}

function FundCombobox({
  value,
  fundId,
  options,
  onChange,
  cellClassName,
}: {
  value: string;
  fundId: number | null;
  options: FundOption[];
  onChange: (patch: { fund: string; fundId: number | null }) => void;
  cellClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const query = value.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!query) return [] as FundOption[];
    const exact: FundOption[] = [];
    const starts: FundOption[] = [];
    const subs: FundOption[] = [];
    for (const o of options) {
      const n = o.name.toLowerCase();
      if (n === query) exact.push(o);
      else if (n.startsWith(query)) starts.push(o);
      else if (n.includes(query)) subs.push(o);
    }
    return [...exact, ...starts, ...subs].slice(0, 8);
  }, [query, options]);

  useEffect(() => {
    if (!open) return;
    function measure() {
      if (inputRef.current) setAnchorRect(inputRef.current.getBoundingClientRect());
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      const inRoot = rootRef.current?.contains(t) ?? false;
      const inDropdown = dropdownRef.current?.contains(t) ?? false;
      if (!inRoot && !inDropdown) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function commit(o: FundOption) {
    onChange({ fund: o.name, fundId: o.id });
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      if (matches.length > 0) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(matches.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      const m = matches[highlight];
      if (m) {
        e.preventDefault();
        commit(m);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showCheck = fundId != null && value.trim().length > 0;

  const dropdown =
    open && matches.length > 0 && anchorRect ? (
      <ul
        ref={dropdownRef}
        role="listbox"
        style={{
          position: "fixed",
          left: anchorRect.left,
          top: anchorRect.bottom + 4,
          width: Math.max(anchorRect.width, 260),
          maxHeight: 288,
          zIndex: 50,
        }}
        className="overflow-y-auto rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] py-1 shadow-[0_8px_24px_rgba(0,55,112,0.08),0_2px_6px_rgba(0,55,112,0.04)]"
      >
        {matches.map((o, i) => (
          <li
            key={o.id}
            role="option"
            aria-selected={i === highlight}
            onMouseDown={(e) => {
              e.preventDefault();
              commit(o);
            }}
            onMouseEnter={() => setHighlight(i)}
            className={`cursor-pointer px-3 py-2 ${
              i === highlight ? "bg-[var(--color-canvas-soft)]" : ""
            }`}
          >
            <p className="t-body-md truncate text-[var(--color-ink)]" title={o.name}>
              {o.name}
            </p>
            <p className="t-micro-cap mt-1 truncate text-[var(--color-ink-mute)]">
              {[o.fund_house, o.asset_class].filter(Boolean).join(" · ") || "—"}
            </p>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange({ fund: e.target.value, fundId: null });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Fund name…"
        className={`${cellClassName} ${showCheck ? "pr-5" : ""}`}
        autoComplete="off"
        spellCheck={false}
      />
      {showCheck && (
        <span
          aria-hidden
          title="Matched to platform fund"
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[12px] leading-none text-[var(--color-positive)]"
        >
          ✓
        </span>
      )}
      {mounted && dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

// Flat 2-line row sized for the 360px sidebar column. Line 1: portfolio
// name on the left, 3Y annualised return + tiny label stacked on the right.
// Line 2: asset chips + risk meta. No mandate, no OCF/Dividends, no sparkline.
// Hover + selected chrome — canvas-soft fill + 2px ink accent bar.
function SwitchModelRow({
  data,
  selected,
  onSelect,
}: {
  data: PortfolioCardData;
  selected: boolean;
  onSelect: () => void;
}) {
  const { portfolio, assetMix, xray, risk } = data;
  const title = `${PROVIDER_FULL[portfolio.provider_slug] ?? portfolio.provider_name} ${CATEGORY_LABELS[portfolio.category] ?? portfolio.category}`;
  const r3y = xray?.r3y ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative block w-full border-b border-[var(--color-hairline-2)] px-5 py-2.5 text-left transition-colors last:border-b-0 ${
        selected
          ? "bg-[var(--color-canvas-soft)]"
          : "hover:bg-[var(--color-canvas-soft)]"
      }`}
    >
      {selected && (
        <span
          className="pointer-events-none absolute left-0 top-0 h-full w-[2px] bg-[var(--color-ink)]"
          aria-hidden
        />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <div className="min-w-0">
          <p
            className="truncate text-[13px] font-medium leading-tight tracking-[-0.005em] text-[var(--color-ink)]"
            title={title}
          >
            {title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <AssetChips chips={assetMix} />
            <span className="t-micro-cap">
              <span className="text-[var(--color-ink-mute)]">RISK</span>{" "}
              <RiskText value={risk} />
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="num text-[13px] font-medium leading-none tabular-nums">
            <ReturnText value={r3y} />
          </p>
          <p className="t-micro-cap mt-1">3Y ANN.</p>
        </div>
      </div>
    </button>
  );
}

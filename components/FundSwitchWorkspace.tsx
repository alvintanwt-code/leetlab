"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { ConfirmedPortfolio } from "@/lib/db/queries";
import type { SwitchMemo } from "@/lib/switch/types";
import {
  generateSwitch,
  parsePastedPortfolio,
  type ParsedHoldingRow,
} from "@/app/(app)/switch/actions";
import { FundSwitchMemo } from "@/components/FundSwitchMemo";

type Provider = { slug: string; name: string };

export type FundOption = {
  id: number;
  name: string;
  fund_house: string | null;
  asset_class: string | null;
  risk_rating: number | null;
};

type Holding = {
  id: string;
  fund: string;
  fundId: number | null;
  units: string;
  costBasis: string;
  currentValue: string;
};

type PerPlatform = {
  holdings: Holding[];
  selectedModelId: number | null;
};

type WorkspaceState = Record<string, PerPlatform>;

const STORAGE_KEY = "fundswitch:v2";

const PROVIDER_SHORT: Record<string, string> = {
  hsbc: "HSBC Life",
  tmls: "Tokio Marine",
  fwd: "FWD",
  gwm: "GWM",
};

const CATEGORY_LABEL: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
  aggressive: "Aggressive",
  dividend_income: "Income",
};

function newRow(): Holding {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return { id, fund: "", fundId: null, units: "", costBasis: "", currentValue: "" };
}

function defaultPerPlatform(): PerPlatform {
  return { holdings: [newRow()], selectedModelId: null };
}

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function isHoldingValid(h: Holding): boolean {
  const cv = parseNum(h.currentValue);
  return h.fund.trim().length > 0 && cv > 0;
}

export function FundSwitchWorkspace({
  portfolios,
  providers,
  fundsByPlatform,
}: {
  portfolios: ConfirmedPortfolio[];
  providers: Provider[];
  fundsByPlatform: Record<string, FundOption[]>;
}) {
  const providerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of portfolios) m.set(p.provider_slug, (m.get(p.provider_slug) ?? 0) + 1);
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
      units: r.units != null ? String(r.units) : "",
      costBasis: r.costBasis != null ? String(r.costBasis) : "",
      currentValue: String(r.currentValue),
    }));
    setState((s) => {
      const prev = s[platform] ?? defaultPerPlatform();
      const allEmpty = prev.holdings.every(
        (h) => h.fund.trim() === "" && h.units === "" && h.costBasis === "" && h.currentValue === "",
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
        units: h.units || undefined,
        costBasis: h.costBasis || undefined,
        currentValue: h.currentValue,
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

  const platformModels = portfolios.filter((p) => p.provider_slug === platform);
  const platformFunds = fundsByPlatform[platform] ?? [];
  const validHoldingsCount = holdings.filter(isHoldingValid).length;
  const canGenerate = validHoldingsCount > 0 && current.selectedModelId != null;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10">
      <div className="sticky top-0 z-20 -mx-10 mb-6 bg-[var(--color-canvas-soft)] px-10">
        <ChromeTitle />
        <div className="flex items-center gap-6 border-b border-[var(--color-hairline)]">
          <p className="t-micro-cap w-20 shrink-0 py-2">Platform</p>
          <nav aria-label="Platform" className="flex items-center gap-3 overflow-x-auto">
            {providers.map((p) => {
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
            <table className="table-pro w-full">
              <colgroup>
                <col />
                <col style={{ width: "110px" }} />
                <col style={{ width: "150px" }} />
                <col style={{ width: "150px" }} />
                <col style={{ width: "36px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="text-left">Fund</th>
                  <th className="text-right">Units</th>
                  <th className="text-right">Cost basis</th>
                  <th className="text-right">Current value</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => (
                  <HoldingInputRow
                    key={h.id}
                    h={h}
                    options={platformFunds}
                    canRemove={holdings.length > 1}
                    onChange={(patch) => updateHolding(i, patch)}
                    onRemove={() => removeRow(i)}
                  />
                ))}
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

          <p className="t-micro-cap mt-4 text-[var(--color-ink-mute)]">
            Type or paste holdings. Cost basis and current value in SGD. Units optional.
          </p>
        </section>

        <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="t-body-md font-medium text-[var(--color-ink)]">Target model</h2>
            <p className="t-micro-cap">
              {(PROVIDER_SHORT[platform] ?? platform).toUpperCase()} · CONFIRMED
            </p>
          </div>

          <div className="-mx-2 flex-1">
            {platformModels.length === 0 ? (
              <div className="mx-2 rounded-md border border-dashed border-[var(--color-hairline-2)] px-4 py-8 text-center">
                <p className="t-micro-cap">No confirmed models on this platform yet</p>
              </div>
            ) : (
              platformModels.map((p) => (
                <ModelRow
                  key={p.id}
                  p={p}
                  selected={current.selectedModelId === p.id}
                  onSelect={() => selectModel(p.id)}
                />
              ))
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 flex items-center justify-between">
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
  canRemove,
  onChange,
  onRemove,
}: {
  h: Holding;
  options: FundOption[];
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
            value={h.costBasis}
            onChange={(e) => onChange({ costBasis: e.target.value })}
            placeholder="—"
            className={`${numCell} max-w-[100px]`}
          />
        </div>
      </td>
      <td className="nowrap right">
        <div className="flex items-baseline justify-end gap-1.5">
          <span className="t-micro-cap text-[var(--color-ink-mute)]">SGD</span>
          <input
            type="text"
            inputMode="decimal"
            value={h.currentValue}
            onChange={(e) => onChange({ currentValue: e.target.value })}
            placeholder="—"
            className={`${numCell} max-w-[100px]`}
          />
        </div>
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

function RiskDots({ value }: { value: number | null | undefined }) {
  const v = value ?? 0;
  return (
    <span className="inline-flex items-center gap-[3px] align-middle">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`block h-[5px] w-[5px] rounded-[1px] ${
            i <= v ? "bg-[var(--color-ink)]" : "bg-[var(--color-hairline)]"
          }`}
        />
      ))}
    </span>
  );
}

function ModelRow({
  p,
  selected,
  onSelect,
}: {
  p: ConfirmedPortfolio;
  selected: boolean;
  onSelect: () => void;
}) {
  let xray: { risk?: number | null; r3y?: number | null } = {};
  try {
    xray = p.xray_json ? JSON.parse(p.xray_json) : {};
  } catch {}
  const r3y = xray.r3y;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex w-full items-center justify-between border-b border-[var(--color-hairline-2)] py-3 pl-4 pr-4 text-left transition-colors last:border-0 ${
        selected
          ? "bg-[var(--color-canvas-soft)]"
          : "hover:bg-[var(--color-canvas-soft)]"
      }`}
    >
      {selected && (
        <span
          className="absolute left-0 top-0 h-full w-[2px] bg-[var(--color-ink)]"
          aria-hidden
        />
      )}
      <div className="min-w-0">
        <p className="t-body-md truncate font-medium text-[var(--color-ink)]" title={p.name}>
          {p.name}
        </p>
        <p className="t-micro-cap mt-1 flex items-center gap-2 text-[var(--color-ink-mute)]">
          <span>{CATEGORY_LABEL[p.category] ?? p.category}</span>
          <span className="text-[var(--color-hairline)]">·</span>
          <RiskDots value={xray.risk ?? null} />
          <span className="text-[var(--color-hairline)]">·</span>
          <span className="num">
            {r3y != null ? `${r3y > 0 ? "+" : ""}${r3y.toFixed(1)}% 3Y` : "— 3Y"}
          </span>
        </p>
      </div>
    </button>
  );
}

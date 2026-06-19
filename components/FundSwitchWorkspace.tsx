"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ConfirmedPortfolio } from "@/lib/db/queries";

type Provider = { slug: string; name: string };

type Holding = {
  id: string;
  fund: string;
  units: string;
  costBasis: string;
  currentValue: string;
};

type PerPlatform = {
  holdings: Holding[];
  selectedModelId: number | null;
};

type WorkspaceState = Record<string, PerPlatform>;

const STORAGE_KEY = "fundswitch:v1";

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
  return { id, fund: "", units: "", costBasis: "", currentValue: "" };
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
}: {
  portfolios: ConfirmedPortfolio[];
  providers: Provider[];
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
      const rows = (prev.holdings.length > 0 ? prev.holdings : [newRow()]).map((h, i) =>
        i === idx ? { ...h, ...patch } : h,
      );
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

  const platformModels = portfolios.filter((p) => p.provider_slug === platform);
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <section className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="t-body-md font-medium text-[var(--color-ink)]">Client portfolio</h2>
            <p className="t-micro-cap">Current holdings</p>
          </div>

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
          {validHoldingsCount > 0
            ? `${validHoldingsCount} holding${validHoldingsCount === 1 ? "" : "s"} ready · session-only, closing the tab discards it.`
            : "Generated memo is session-only. Closing the tab discards it."}
        </p>
        <button
          type="button"
          disabled={!canGenerate}
          className={`t-caption rounded-full px-5 py-2.5 font-medium transition-colors ${
            canGenerate
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:bg-[var(--color-primary-deep)]"
              : "cursor-not-allowed bg-[var(--color-canvas-soft)] text-[var(--color-ink-mute)]"
          }`}
        >
          {canGenerate ? "Generate switch" : "Add holdings and pick a model"}
        </button>
      </div>

      <div className="h-16" />
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
  canRemove,
  onChange,
  onRemove,
}: {
  h: Holding;
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
        <input
          type="text"
          value={h.fund}
          onChange={(e) => onChange({ fund: e.target.value })}
          placeholder="Fund name…"
          className={cell}
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

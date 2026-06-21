"use client";

import { useEffect, useState } from "react";
import type {
  ChangeKind,
  SwitchChangeRow,
  SwitchFundRow,
  SwitchMemo,
  SwitchOrder,
} from "@/lib/switch/types";
import { TrailingChart } from "@/components/TrailingChart";
import { BarsRow } from "@/components/PortfolioDetail";

// Result page for a generated switch: side-by-side current vs target tables,
// a unified changes table, and an x-ray of the proposed portfolio. Replaces
// the older FundSwitchMemo for the client-facing presentation flow.

type ChartData = {
  funds: { isin: string; name: string; weight: number; points: { d: string; v: number }[]; terminal: number }[];
  model: { points: { d: string; v: number }[]; terminal: number };
  commonStart: string;
  commonEnd: string;
  skipped: number;
};

function fmtSgd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-SG", { maximumFractionDigits: 0 });
}

function fmtPct(v: number | null | undefined, places = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(places)}%`;
}

function fmtSignedPct(v: number | null | undefined, places = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(places)}%`;
}

function pctCls(v: number | null | undefined): string {
  if (v == null) return "text-[var(--color-ink-mute)]";
  if (v > 0) return "text-[var(--color-positive)]";
  if (v < 0) return "text-[var(--color-negative)]";
  return "text-[var(--color-ink)]";
}

// ---------------- side-by-side fund tables ----------------

function FundTable({ title, rows, totalLabel }: { title: string; rows: SwitchFundRow[]; totalLabel: string }) {
  const total = rows.reduce((s, r) => s + r.valueSgd, 0);
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3">
        <p className="t-body-md font-medium text-[var(--color-ink)]">{title}</p>
        <p className="t-micro-cap">{rows.length} {rows.length === 1 ? "fund" : "funds"}</p>
      </div>
      <table className="table-pro table-pro-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "58%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Fund</th>
            <th className="right">Weight</th>
            <th className="right">SGD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.fundId ?? r.name}-${r.weightPct}`}>
              <td className="cell-fund">
                <span
                  className="name text-[var(--color-ink)]"
                  title={r.name}
                  style={{
                    whiteSpace: "normal",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    fontSize: "13px",
                  }}
                >
                  {r.name}
                </span>
                {r.assetClass && <span className="meta">{r.assetClass}</span>}
              </td>
              <td className="nowrap right">
                <span className="num text-[var(--color-ink)]">{fmtPct(r.weightPct, 1)}</span>
              </td>
              <td className="nowrap right">
                <span className="num text-[var(--color-ink)]">{fmtSgd(r.valueSgd)}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="text-[var(--color-ink-mute)]">{totalLabel}</td>
            <td className="right">
              <span className="num text-[var(--color-ink-mute)]">100.0%</span>
            </td>
            <td className="right">
              <span className="num font-medium text-[var(--color-ink)]">{fmtSgd(total)}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

// ---------------- status badges for the changes table ----------------

const CHANGE_LABEL: Record<ChangeKind, string> = {
  new: "New",
  added: "Added",
  reduced: "Reduced",
  no_change: "No change",
};

function ChangeBadge({ kind }: { kind: ChangeKind }) {
  const cls: Record<ChangeKind, string> = {
    new: "border-[var(--color-primary)] text-[var(--color-primary)]",
    added: "border-[var(--color-positive)] text-[var(--color-positive)]",
    reduced: "border-[var(--color-negative)] text-[var(--color-negative)]",
    no_change: "border-[var(--color-hairline)] text-[var(--color-ink-mute)]",
  };
  return (
    <span className={`inline-flex items-center border px-1.5 py-0.5 t-micro-cap ${cls[kind]}`}>
      {CHANGE_LABEL[kind]}
    </span>
  );
}

function ChangesTable({ rows }: { rows: SwitchChangeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] px-5 py-3">
        <p className="t-body-md font-medium text-[var(--color-ink)]">Summary of changes</p>
        <p className="t-micro-cap">{rows.length} {rows.length === 1 ? "fund" : "funds"}</p>
      </div>
      <table className="table-pro table-pro-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "42%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "14%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Fund</th>
            <th className="right">Current</th>
            <th className="right">Target</th>
            <th className="right">Δ</th>
            <th className="right">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.fundId ?? r.name}`}>
              <td className="cell-fund">
                <span
                  className="name text-[var(--color-ink)]"
                  title={r.name}
                  style={{
                    whiteSpace: "normal",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    fontSize: "13px",
                  }}
                >
                  {r.name}
                </span>
              </td>
              <td className="nowrap right">
                <span className={`num ${r.currentPct === 0 ? "text-[var(--color-ink-mute)]" : "text-[var(--color-ink)]"}`}>
                  {fmtPct(r.currentPct, 1)}
                </span>
              </td>
              <td className="nowrap right">
                <span className={`num ${r.targetPct === 0 ? "text-[var(--color-ink-mute)]" : "text-[var(--color-ink)]"}`}>
                  {fmtPct(r.targetPct, 1)}
                </span>
              </td>
              <td className="nowrap right">
                <span className={`num ${pctCls(r.delta)}`}>{fmtSignedPct(r.delta, 1)}</span>
              </td>
              <td className="nowrap right">
                <ChangeBadge kind={r.kind} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------- new-portfolio xray ----------------

function PerformanceCell({ label, value, valueCls, sublabel }: { label: string; value: string; valueCls?: string; sublabel: string }) {
  return (
    <div className="px-3 first:pl-0 last:pr-0">
      <p className="t-micro-cap mb-2">{label}</p>
      <p className={`num text-[20px] font-medium leading-none ${valueCls ?? "text-[var(--color-ink)]"}`}>{value}</p>
      <p className="t-micro-cap mt-2">{sublabel}</p>
    </div>
  );
}

function PerformanceStrip({ memo }: { memo: SwitchMemo }) {
  const x = memo.proposedXray;
  return (
    <section className="grid grid-cols-2 gap-y-5 divide-x divide-[var(--color-hairline-2)] rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] py-5 px-5 sm:grid-cols-3 md:grid-cols-6">
      <PerformanceCell label="1-Year" value={fmtSignedPct(x.r1y)} valueCls={pctCls(x.r1y)} sublabel="Annualised" />
      <PerformanceCell label="3-YR Ann." value={fmtSignedPct(x.r3y)} valueCls={pctCls(x.r3y)} sublabel="Annualised" />
      <PerformanceCell label="5-YR Ann." value={fmtSignedPct(x.r5y)} valueCls={pctCls(x.r5y)} sublabel="Annualised" />
      <PerformanceCell label="10-YR Ann." value={fmtSignedPct(x.r10y)} valueCls={pctCls(x.r10y)} sublabel="Annualised" />
      <PerformanceCell label="OCF" value={x.expense != null ? `${x.expense.toFixed(3)}%` : "—"} sublabel="Blended p.a." />
      <PerformanceCell
        label="Risk"
        value={x.risk != null ? (Number.isInteger(x.risk) ? x.risk.toFixed(0) : x.risk.toFixed(1)) + "/5" : "—"}
        sublabel="Blended"
      />
    </section>
  );
}

function BreakdownPanel({ title, items, suffix }: { title: string; items: { label: string; weight_pct: number }[]; suffix?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="t-body-lg font-medium text-[var(--color-ink)]">{title}</p>
        {suffix && <p className="t-micro-cap">{suffix}</p>}
      </div>
      <BarsRow items={items.slice(0, 11)} />
    </section>
  );
}

// ---------------- chart: blended growth-of-100 for the target ----------------

function TargetChart({ targetFunds }: { targetFunds: SwitchFundRow[] }) {
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const components = targetFunds
        .filter((f) => f.isin && f.weightPct > 0)
        .map((f) => ({ isin: f.isin as string, weight: f.weightPct / 100, name: f.name }));
      if (components.length === 0) {
        if (!cancelled) {
          setError("Target portfolio has no ISIN-bearing funds to chart.");
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetch("/api/performance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ components }),
        });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || j?.error) throw new Error(j?.error ?? `HTTP ${res.status}`);
        setData(j as ChartData);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [targetFunds]);

  return (
    <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="t-body-lg font-medium text-[var(--color-ink)]">Trailing performance &middot; Growth of 100</p>
        <p className="t-micro-cap">New portfolio · monthly · fund-ccy</p>
      </div>
      {data ? (
        <TrailingChart {...data} />
      ) : error ? (
        <div className="rounded-md border border-dashed border-[var(--color-hairline)] p-6 text-center">
          <p className="t-caption text-[var(--color-negative)]">{error}</p>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--color-hairline)] p-8 text-center">
          <p className="t-body-md text-[var(--color-ink-mute)]">
            {loading ? "Pulling live Morningstar look-through for each component…" : "—"}
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------- switch order — fills the platform's switch form ----------------

function SwitchOrderTables({ order }: { order: SwitchOrder }) {
  const totalIn = order.switchIn.reduce((s, r) => s + r.pct, 0);
  return (
    <section className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="t-body-lg font-medium text-[var(--color-ink)]">Switch order</p>
        <p className="t-micro-cap">Execution form</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* SWITCH OUT */}
        <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)]">
          <div className="border-b border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] px-4 py-2">
            <p className="t-micro-cap">Switch out</p>
          </div>
          <table className="table-pro table-pro-sm w-full" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fund</th>
                <th>Account</th>
                <th className="right">SGD</th>
                <th className="right">% fund</th>
              </tr>
            </thead>
            <tbody>
              {order.switchOut.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center">
                    <p className="t-caption text-[var(--color-ink-mute)]">
                      Nothing to switch out — current allocation already at or below target.
                    </p>
                  </td>
                </tr>
              ) : (
                order.switchOut.map((r, i) => (
                  <tr key={`out-${i}`}>
                    <td className="cell-fund">
                      <span className="name text-[var(--color-ink)]" title={r.fund}>{r.fund}</span>
                    </td>
                    <td>
                      <span className="t-body-md text-[var(--color-ink-mute)]">—</span>
                    </td>
                    <td className="nowrap right">
                      <span className="num text-[var(--color-ink)]">
                        {r.sgdAmount.toLocaleString("en-SG", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    </td>
                    <td className="nowrap right">
                      <span className="num text-[var(--color-ink)]">{r.pctOfFund.toFixed(1)}%</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {order.switchOut.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2} className="text-[var(--color-ink-mute)]">Total</td>
                  <td className="nowrap right">
                    <span className="num font-medium text-[var(--color-ink)]">
                      {order.totalSwitchOutSgd.toLocaleString("en-SG", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* SWITCH IN */}
        <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)]">
          <div className="border-b border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] px-4 py-2">
            <p className="t-micro-cap">Switch in</p>
          </div>
          <table className="table-pro table-pro-sm w-full" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fund</th>
                <th className="right">% new</th>
              </tr>
            </thead>
            <tbody>
              {order.switchIn.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center">
                    <p className="t-caption text-[var(--color-ink-mute)]">No target funds.</p>
                  </td>
                </tr>
              ) : (
                order.switchIn.map((r, i) => (
                  <tr key={`in-${i}`}>
                    <td className="cell-fund">
                      <span className="name text-[var(--color-ink)]" title={r.fund}>{r.fund}</span>
                    </td>
                    <td className="nowrap right">
                      <span className="num text-[var(--color-ink)]">{r.pct}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {order.switchIn.length > 0 && (
              <tfoot>
                <tr>
                  <td className="text-[var(--color-ink-mute)]">Total</td>
                  <td className="nowrap right">
                    <span className="num font-medium text-[var(--color-ink)]">{totalIn}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <p className="t-micro-cap mt-4 text-[var(--color-ink-mute)]">
        Maps to the platform&rsquo;s fund-switch form (e.g. HSBC Life Form A · Section A).
        Account column is left blank — fill per-account splits in the meeting.
      </p>
    </section>
  );
}

// ---------------- main component ----------------

export function SwitchResult({ memo, onEdit }: { memo: SwitchMemo; onEdit: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Eyebrow row — platform · model name on the left, edit-back link on the
          right. Sits inline so the chrome above stays minimal. */}
      <div className="flex items-center justify-between gap-4">
        <p className="t-micro-cap flex items-center gap-2">
          <span className="inline-block h-[8px] w-[8px] bg-[var(--color-primary)]" />
          {memo.platformLabel}
          <span className="text-[var(--color-hairline)]">·</span>
          {memo.modelName}
        </p>
        <button
          type="button"
          onClick={onEdit}
          className="t-caption text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink)]"
        >
          ← Edit inputs
        </button>
      </div>

      {/* Top: side-by-side current vs target with an arrow between */}
      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
        <FundTable title="Existing portfolio" rows={memo.currentFunds} totalLabel="Total" />
        <div className="hidden items-center justify-center md:flex">
          <svg width="36" height="20" viewBox="0 0 36 20" fill="none" aria-hidden>
            <path d="M0 10 H30 M22 4 L30 10 L22 16" stroke="var(--color-ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <FundTable title="Target model" rows={memo.targetFunds} totalLabel="Total" />
      </div>

      {/* Middle: changes table */}
      <ChangesTable rows={memo.changes} />

      {/* Bottom: new-portfolio xray */}
      <div className="mt-2 flex flex-col gap-4">
        <p className="t-micro-cap">New portfolio x-ray</p>
        <PerformanceStrip memo={memo} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BreakdownPanel title="Sector allocation" items={memo.proposedXray.sector} suffix="Equity sleeve" />
          <BreakdownPanel title="Geographic allocation" items={memo.proposedXray.geo} suffix="Equity sleeve" />
        </div>
        <TargetChart targetFunds={memo.targetFunds} />
      </div>

      {/* Switch order — execution form for the platform */}
      <SwitchOrderTables order={memo.switchOrder} />
    </div>
  );
}

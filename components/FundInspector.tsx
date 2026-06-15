"use client";

import type { FundInspectorData, AllocationDetail } from "@/lib/db/queries";
import { NavSparkline } from "./NavSparkline";

type DocInfo = { type: string; label: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function fmtPct(v: number | null): { text: string; cls: string } {
  if (v == null) return { text: "—", cls: "text-[var(--color-ink-mute)]" };
  if (v === 0) return { text: "0.00%", cls: "text-[var(--color-ink)]" };
  const sign = v > 0 ? "+" : "−";
  const cls = v > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  return { text: `${sign}${Math.abs(v).toFixed(2)}%`, cls };
}

function Bars({ items }: { items: { label: string; weight_pct: number }[] }) {
  if (items.length === 0) return <p className="t-caption text-[var(--color-ink-mute)]">Not disclosed.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.slice(0, 10).map((a) => (
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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline-2)] py-2 last:border-0">
      <dt className="t-caption text-[var(--color-ink-mute)]">{label}</dt>
      <dd className="t-body-md text-[var(--color-ink)]">{value ?? "—"}</dd>
    </div>
  );
}

export function FundInspector({
  fund,
  allocations,
  documents,
  onClose,
  onAdd,
  alreadyInBasket,
}: {
  fund: FundInspectorData;
  allocations: AllocationDetail[];
  documents: DocInfo[];
  onClose: () => void;
  onAdd: () => void;
  alreadyInBasket: boolean;
}) {
  const asset = allocations.filter((a) => a.kind === "asset");
  const geo = allocations.filter((a) => a.kind === "geography");
  const sector = allocations.filter((a) => a.kind === "sector");
  const holdings = allocations.filter(
    // Drop garbled bond-fund rows: weight > 100% impossible for a single
    // holding, and date-only labels like "11/15/" mean the parser split on
    // an embedded coupon "%" and the real label is lost.
    (a) =>
      a.kind === "holding" &&
      a.weight_pct <= 100 &&
      a.weight_pct >= 0 &&
      !/^\d+\/\d*\/?$/.test(a.label) &&
      a.label.length >= 3,
  );

  const change = fmtPct(fund.change_pct);

  return (
    <>
      {/* backdrop */}
      <div className="fixed inset-0 z-40 bg-[rgba(13,37,61,0.20)]" onClick={onClose} aria-hidden />
      {/* drawer */}
      <aside
        className="fixed right-0 top-0 z-50 flex h-screen w-[460px] max-w-[95vw] flex-col border-l border-[var(--color-hairline)] bg-[var(--color-canvas)] shadow-[-8px_0_24px_rgba(13,37,61,0.08)]"
        role="dialog"
        aria-label={`Fund inspector — ${fund.name}`}
      >
        <header className="border-b border-[var(--color-hairline)] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="t-micro-cap mb-1">Fund</p>
              <p className="t-h-md text-[var(--color-ink)]" title={fund.name}>{fund.name}</p>
              <p className="t-caption mt-1 truncate text-[var(--color-ink-mute)]">
                {fund.fund_house ?? "—"} &middot; <span className="num">{fund.isin ?? fund.external_id}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-md p-1 text-[var(--color-ink-mute)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
              aria-label="Close inspector"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {fund.currency && <span className="tag">{fund.currency}</span>}
            {fund.asset_class && <span className="tag">{fund.asset_class}</span>}
            {fund.distribution_type && (
              <span className="tag">
                {fund.distribution_type === "Acc" ? "Accumulating" : fund.distribution_type === "Dist" ? "Distributing" : fund.distribution_type}
              </span>
            )}
            {fund.risk_rating != null && (
              <span className="tag">Risk {fund.risk_rating}{fund.risk_label ? ` · ${fund.risk_label}` : ""}</span>
            )}
            {fund.sfdr_classification && <span className="tag">SFDR {fund.sfdr_classification}</span>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* NAV block + live sparkline */}
          {fund.nav != null && (
            <div className="rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="t-micro-cap mb-1">NAV</p>
                  <p className="num t-display-md text-[var(--color-ink)]">
                    {fund.currency} {fund.nav.toFixed(2)}
                  </p>
                </div>
                <p className="t-caption text-right text-[var(--color-ink-mute)]">
                  as of <span className="num">{fmtDate(fund.nav_as_of)}</span>
                  {fund.change_pct != null && (
                    <>
                      <br />
                      1d <span className={change.cls}>{change.text}</span>
                    </>
                  )}
                </p>
              </div>
              {fund.isin && <NavSparkline isin={fund.isin} name={fund.name} currency={fund.currency} />}
            </div>
          )}

          {/* Returns */}
          <section className="mt-6">
            <p className="t-micro-cap mb-2">Annualised returns</p>
            <div className="grid grid-cols-4 gap-3 rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-3">
              {([
                ["1Y", fund.ann_1y],
                ["3Y", fund.ann_3y],
                ["5Y", fund.ann_5y],
                ["10Y", fund.ann_10y],
              ] as const).map(([label, value]) => {
                const f = fmtPct(value);
                return (
                  <div key={label} className="text-center">
                    <p className="t-micro-cap mb-1">{label}</p>
                    <p className={`num t-body-md ${f.cls}`}>{f.text}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {fund.investment_objective && (
            <section className="mt-6">
              <p className="t-micro-cap mb-2">Investment objective</p>
              <p className="t-body-md leading-relaxed text-[var(--color-ink-2)]">{fund.investment_objective}</p>
            </section>
          )}

          {holdings.length > 0 && (
            <section className="mt-6">
              <p className="t-micro-cap mb-3">Top holdings</p>
              <Bars items={holdings} />
            </section>
          )}

          {geo.length > 0 && (
            <section className="mt-6">
              <p className="t-micro-cap mb-3">Geographic allocation</p>
              <Bars items={geo} />
            </section>
          )}

          {sector.length > 0 && (
            <section className="mt-6">
              <p className="t-micro-cap mb-3">Sector allocation</p>
              <Bars items={sector} />
            </section>
          )}

          {asset.length > 0 && (
            <section className="mt-6">
              <p className="t-micro-cap mb-3">Asset allocation</p>
              <Bars items={asset} />
            </section>
          )}

          <section className="mt-6">
            <p className="t-micro-cap mb-2">Fund facts</p>
            <dl className="rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-4 py-2">
              <Fact label="ISIN" value={<span className="num">{fund.isin ?? "—"}</span>} />
              <Fact label="Share class inception" value={fund.share_class_inception} />
              <Fact
                label="Fund size"
                value={
                  fund.fund_size != null
                    ? <span className="num">{fund.fund_size_currency} {fund.fund_size.toLocaleString()} M</span>
                    : null
                }
              />
              <Fact label="Dealing frequency" value={fund.dealing_frequency} />
              <Fact label="Benchmark" value={fund.benchmark} />
              <Fact
                label="Expense ratio"
                value={fund.expense_ratio != null ? <span className="num">{fund.expense_ratio.toFixed(2)}%</span> : null}
              />
              <Fact
                label="Mgmt fee"
                value={fund.management_fee != null ? <span className="num">{fund.management_fee.toFixed(2)}%</span> : null}
              />
              <Fact
                label="Morningstar"
                value={fund.morningstar_rating != null ? "★".repeat(fund.morningstar_rating) + "☆".repeat(5 - fund.morningstar_rating) : null}
              />
            </dl>
          </section>

          {documents.length > 0 && (
            <section className="mt-6 mb-2">
              <p className="t-micro-cap mb-2">Documents</p>
              <ul className="rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] divide-y divide-[var(--color-hairline-2)]">
                {documents.map((d) => (
                  <li key={d.type} className="flex items-center justify-between px-4 py-2.5">
                    <span className="t-body-md text-[var(--color-ink-2)]">{d.label}</span>
                    <a
                      href={`/api/factsheet/${fund.external_id}?type=${d.type}`}
                      className="t-caption text-[var(--color-primary)] hover:text-[var(--color-primary-deep)]"
                    >
                      Download &rarr;
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="border-t border-[var(--color-hairline)] px-5 py-3">
          <button
            onClick={onAdd}
            disabled={alreadyInBasket}
            className={`btn-pill w-full justify-center ${alreadyInBasket ? "btn-ghost cursor-not-allowed opacity-60" : "btn-primary"}`}
          >
            {alreadyInBasket ? "Already in basket" : "+ Add to basket"}
          </button>
        </footer>
      </aside>
    </>
  );
}

import type { SwitchMemo, WhyRow } from "@/lib/switch/types";

const CATEGORY_LABEL: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
  aggressive: "Aggressive",
  dividend_income: "Income",
};

function fmtSignedPct(v: number | null | undefined, places = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05 && places <= 1) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(places)}%`;
}

function fmtPctPlain(v: number | null | undefined, places = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(places)}%`;
}

function fmtSignedNum(v: number | null | undefined, places = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05 && places <= 1) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(places)}`;
}

function signCls(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-[var(--color-ink-mute)]";
  if (v > 0.05) return "text-[var(--color-positive)]";
  if (v < -0.05) return "text-[var(--color-negative)]";
  return "text-[var(--color-ink)]";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function CompositionBar({ pct, max, muted = false }: { pct: number; max: number; muted?: boolean }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (pct / max) * 100)) : 0;
  return (
    <div className="relative h-[2px] w-full bg-[var(--color-hairline-2)]">
      <div
        className={`absolute left-0 top-0 h-full ${muted ? "bg-[var(--color-ink-mute)]" : "bg-[var(--color-ink)]"}`}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

function SectionHeader({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h3 className="t-body-md font-medium text-[var(--color-ink)]">{title}</h3>
      <p className="t-micro-cap">{eyebrow}</p>
    </div>
  );
}

function WhyGroup({ label, rows }: { label: string; rows: WhyRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <tr>
        <td colSpan={5} className="border-t border-[var(--color-hairline-2)] pt-4 pb-2 pl-3.5">
          <p className="t-micro-cap text-[var(--color-ink-mute)]">{label}</p>
        </td>
      </tr>
      {rows.map((r, i) => (
        <tr key={`${label}-${i}`}>
          <td className="align-top">
            {r.kind === "switch" ? (
              <div>
                <p className="t-body-md text-[var(--color-ink)]">{r.fromFund}</p>
                <p className="t-micro-cap mt-1 text-[var(--color-ink-mute)]">↓ {r.toFund}</p>
              </div>
            ) : (
              <p className="t-body-md text-[var(--color-ink)]">{r.fromFund ?? r.toFund}</p>
            )}
          </td>
          <td className="num nowrap right align-top text-[var(--color-ink)]">
            {fmtPctPlain(r.fromPct, 1)}
          </td>
          <td className="num nowrap right align-top text-[var(--color-ink)]">
            {fmtPctPlain(r.toPct, 1)}
          </td>
          <td className={`num nowrap right align-top ${signCls(r.delta)}`}>
            {fmtSignedPct(r.delta, 1)}
          </td>
          <td className="t-body-md align-top text-[var(--color-ink-mute)]">
            {r.rationale || "—"}
          </td>
        </tr>
      ))}
    </>
  );
}

export function FundSwitchMemo({ memo, onEdit }: { memo: SwitchMemo; onEdit: () => void }) {
  const expReturnDelta = memo.delta.expReturn;
  const driftMax = memo.assetClassDrift.reduce(
    (m, r) => Math.max(m, r.currentPct, r.targetPct),
    0,
  );

  const groups = {
    switch: memo.whyRows.filter((r) => r.kind === "switch"),
    reduce: memo.whyRows.filter((r) => r.kind === "reduce"),
    add: memo.whyRows.filter((r) => r.kind === "add"),
  };

  const topProposedHoldings = memo.proposedXray.holdings.slice(0, 10);
  const proposedHoldingsMax = topProposedHoldings.reduce((m, h) => Math.max(m, h.weight_pct), 0);

  return (
    <article className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-8">
      {/* Eyebrow strip */}
      <div className="flex items-center gap-2">
        <span className="inline-block h-[10px] w-[10px] bg-[var(--color-primary)]" aria-hidden />
        <p className="t-micro-cap text-[var(--color-ink-mute)]">
          CLIENT
          <span className="mx-1.5 text-[var(--color-hairline)]">·</span>
          {memo.platformLabel.toUpperCase()}
          <span className="mx-1.5 text-[var(--color-hairline)]">·</span>
          PROPOSED {fmtDate(memo.proposedDate)}
        </p>
      </div>

      {/* Hero header */}
      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <h2 className="t-display-md text-[var(--color-ink)]" style={{ letterSpacing: "-0.025em" }}>
            Current → {memo.modelName}
          </h2>
          <p className="t-micro-cap mt-2 text-[var(--color-ink-mute)]">
            {(CATEGORY_LABEL[memo.modelCategory] ?? memo.modelCategory).toUpperCase()}
          </p>
        </div>
        <div className="text-right">
          <p className={`num text-[40px] leading-none ${signCls(expReturnDelta)}`} style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
            <span className="text-[var(--color-ink)]">
              {expReturnDelta == null ? "—" : `${expReturnDelta > 0 ? "+" : expReturnDelta < 0 ? "−" : ""}${Math.abs(expReturnDelta).toFixed(1)}`}
            </span>
            <span>%</span>
          </p>
          <p className="t-micro-cap mt-2">EXPECTED RETURN DELTA</p>
        </div>
      </div>

      {/* Mandate facts strip */}
      <div className="mt-8 grid grid-cols-2 gap-6 border-t border-[var(--color-hairline)] pt-6 sm:grid-cols-4">
        <Fact label="EXP RETURN" value={fmtSignedPct(memo.delta.expReturn)} cls={signCls(memo.delta.expReturn)} />
        <Fact label="EXP RISK" value={fmtSignedNum(memo.delta.expRisk)} cls={signCls(memo.delta.expRisk == null ? null : -memo.delta.expRisk)} />
        <Fact label="OCF DELTA" value={fmtSignedPct(memo.delta.ocf, 3)} cls={signCls(memo.delta.ocf == null ? null : -memo.delta.ocf)} />
        <Fact label="HOLDINGS" value={`${memo.current.holdingsCount} → ${memo.target.holdingsCount}`} />
      </div>

      {memo.unmatched.length > 0 && (
        <div className="mt-6 rounded-md border border-dashed border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] px-4 py-3">
          <p className="t-micro-cap mb-1 text-[var(--color-ink-mute)]">UNMATCHED</p>
          <p className="t-caption text-[var(--color-ink)]">
            Couldn&rsquo;t match to platform funds: {memo.unmatched.join(" · ")}. These contribute to weights but not to drift / return calcs.
          </p>
        </div>
      )}

      {memo.current.mergedRowCount > 0 && (
        <p className="t-micro-cap mt-3 text-[var(--color-ink-mute)]">
          {memo.current.mergedRowCount} duplicate{memo.current.mergedRowCount === 1 ? " row" : " rows"} combined &mdash;
          same fund held across multiple accounts is treated as one position.
        </p>
      )}

      {/* Asset-class drift */}
      <section className="mt-10">
        <SectionHeader title="Asset-class drift" eyebrow="SLEEVE WEIGHTS" />
        <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)]">
          <table className="w-full">
            <colgroup>
              <col />
              <col style={{ width: "26%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "100px" }} />
            </colgroup>
            <tbody>
              {memo.assetClassDrift.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center">
                    <p className="t-caption text-[var(--color-ink-mute)]">No asset-class data available.</p>
                  </td>
                </tr>
              ) : (
                memo.assetClassDrift.map((r) => (
                  <tr key={r.assetClass} className="border-b border-[var(--color-hairline-2)] last:border-0">
                    <td className="px-4 py-3 align-middle">
                      <p className="t-body-md text-[var(--color-ink)]">{r.assetClass}</p>
                    </td>
                    <td className="px-2 py-3 align-middle">
                      <div className="flex items-center gap-3">
                        <span className="num t-caption w-12 shrink-0 text-right text-[var(--color-ink-mute)]">
                          {fmtPctPlain(r.currentPct, 1)}
                        </span>
                        <div className="flex-1">
                          <CompositionBar pct={r.currentPct} max={driftMax} muted />
                        </div>
                      </div>
                      <p className="t-micro-cap mt-1 pl-[60px] text-[var(--color-ink-mute)]">CURRENT</p>
                    </td>
                    <td className="px-2 py-3 align-middle">
                      <div className="flex items-center gap-3">
                        <span className="num t-caption w-12 shrink-0 text-right text-[var(--color-ink)]">
                          {fmtPctPlain(r.targetPct, 1)}
                        </span>
                        <div className="flex-1">
                          <CompositionBar pct={r.targetPct} max={driftMax} />
                        </div>
                      </div>
                      <p className="t-micro-cap mt-1 pl-[60px] text-[var(--color-ink-mute)]">PROPOSED</p>
                    </td>
                    <td className={`num nowrap right px-4 py-3 align-middle ${signCls(r.delta)}`}>
                      {fmtSignedPct(r.delta, 1)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Why-table */}
      <section className="mt-10">
        <SectionHeader title="Weight changes" eyebrow="WHY THIS SWITCH" />
        <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)]">
          <table className="table-pro table-pro-sm w-full">
            <colgroup>
              <col />
              <col style={{ width: "110px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "70px" }} />
              <col style={{ width: "32%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fund</th>
                <th className="right">Current %</th>
                <th className="right">Proposed %</th>
                <th className="right">&Delta;</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              <WhyGroup label="SWITCH" rows={groups.switch} />
              <WhyGroup label="REDUCE" rows={groups.reduce} />
              <WhyGroup label="ADD" rows={groups.add} />
              {memo.whyRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center">
                    <p className="t-caption text-[var(--color-ink-mute)]">
                      No material weight changes detected.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="t-micro-cap mt-3 text-[var(--color-ink-mute)]">
          Rationale prose is drafted in a follow-up phase.
        </p>
      </section>

      {/* Outlook */}
      <section className="mt-10">
        <SectionHeader title="Outlook" eyebrow="HOUSE VIEW" />
        <div className="rounded-md border border-dashed border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] px-5 py-6">
          <p className="t-body-md text-[var(--color-ink-mute)]">
            House-voice outlook lands in a follow-up phase. This is where the 2–3 paragraph
            commentary on positioning, macro context, and what the client is buying into will sit.
          </p>
        </div>
      </section>

      {/* Proposed x-ray */}
      <section className="mt-10">
        <SectionHeader title={`${memo.modelName} — proposed x-ray`} eyebrow="LOOK-THROUGH" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)] p-4">
            <p className="t-micro-cap mb-3">SECTOR</p>
            <BreakdownList rows={memo.proposedXray.sector.slice(0, 8)} />
          </div>
          <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)] p-4">
            <p className="t-micro-cap mb-3">GEOGRAPHY</p>
            <BreakdownList rows={memo.proposedXray.geo.slice(0, 8)} />
          </div>
        </div>
        {topProposedHoldings.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-md border border-[var(--color-hairline-2)] p-4">
            <p className="t-micro-cap mb-3">TOP 10 LOOK-THROUGH HOLDINGS</p>
            <BreakdownList rows={topProposedHoldings} max={proposedHoldingsMax} numbered />
          </div>
        )}
      </section>

      {/* Switch order — data the advisor copies into the platform's switch form */}
      <section className="mt-10">
        <SectionHeader title="Switch order" eyebrow="EXECUTION FORM" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)]">
            <div className="border-b border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] px-4 py-2">
              <p className="t-micro-cap">SWITCH OUT</p>
            </div>
            <table className="table-pro table-pro-sm w-full">
              <colgroup>
                <col />
                <col style={{ width: "110px" }} />
                <col style={{ width: "120px" }} />
                <col style={{ width: "90px" }} />
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
                {memo.switchOrder.switchOut.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center">
                      <p className="t-caption text-[var(--color-ink-mute)]">
                        Nothing to switch out &mdash; current allocation already at or below target.
                      </p>
                    </td>
                  </tr>
                ) : (
                  memo.switchOrder.switchOut.map((r, i) => (
                    <tr key={`out-${i}`}>
                      <td>
                        <p className="t-body-md text-[var(--color-ink)]">{r.fund}</p>
                      </td>
                      <td>
                        <p className="t-body-md text-[var(--color-ink-mute)]">&mdash;</p>
                      </td>
                      <td className="num nowrap right text-[var(--color-ink)]">
                        {r.sgdAmount.toLocaleString("en-SG", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="num nowrap right text-[var(--color-ink)]">
                        {fmtPctPlain(r.pctOfFund, 1)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {memo.switchOrder.switchOut.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={2} className="border-t border-[var(--color-hairline-2)] px-4 py-2">
                      <p className="t-micro-cap">TOTAL</p>
                    </td>
                    <td className="num nowrap right border-t border-[var(--color-hairline-2)] px-4 py-2 text-[var(--color-ink)]">
                      {memo.switchOrder.totalSwitchOutSgd.toLocaleString("en-SG", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="border-t border-[var(--color-hairline-2)] px-4 py-2"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)]">
            <div className="border-b border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] px-4 py-2">
              <p className="t-micro-cap">SWITCH IN</p>
            </div>
            <table className="table-pro table-pro-sm w-full">
              <colgroup>
                <col />
                <col style={{ width: "90px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Fund</th>
                  <th className="right">% new</th>
                </tr>
              </thead>
              <tbody>
                {memo.switchOrder.switchIn.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center">
                      <p className="t-caption text-[var(--color-ink-mute)]">No target funds.</p>
                    </td>
                  </tr>
                ) : (
                  memo.switchOrder.switchIn.map((r, i) => (
                    <tr key={`in-${i}`}>
                      <td>
                        <p className="t-body-md text-[var(--color-ink)]">{r.fund}</p>
                      </td>
                      <td className="num nowrap right text-[var(--color-ink)]">{r.pct}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {memo.switchOrder.switchIn.length > 0 && (
                <tfoot>
                  <tr>
                    <td className="border-t border-[var(--color-hairline-2)] px-4 py-2">
                      <p className="t-micro-cap">TOTAL</p>
                    </td>
                    <td className="num nowrap right border-t border-[var(--color-hairline-2)] px-4 py-2 text-[var(--color-ink)]">
                      {memo.switchOrder.switchIn.reduce((s, r) => s + r.pct, 0)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
        <p className="t-micro-cap mt-3 text-[var(--color-ink-mute)]">
          Maps to the platform&rsquo;s fund-switch form (e.g. HSBC Life Form A &middot; Section A).
          Account column is left blank &mdash; fill per-account splits in the meeting.
        </p>
      </section>

      {/* Actions */}
      <div className="mt-10 flex items-center justify-between border-t border-[var(--color-hairline)] pt-5">
        <button
          type="button"
          onClick={onEdit}
          className="t-caption text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink)]"
        >
          ← Edit inputs
        </button>
        <button
          type="button"
          disabled
          className="t-caption cursor-not-allowed rounded-full bg-[var(--color-canvas-soft)] px-5 py-2.5 font-medium text-[var(--color-ink-mute)]"
          title="PDF export lands in phase 5"
        >
          Export PDF
        </button>
      </div>
    </article>
  );
}

function Fact({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <p className="t-micro-cap mb-2">{label}</p>
      <p className={`num text-[22px] font-medium leading-none ${cls ?? "text-[var(--color-ink)]"}`}>
        {value}
      </p>
    </div>
  );
}

function BreakdownList({
  rows,
  max,
  numbered = false,
}: {
  rows: { label: string; weight_pct: number }[];
  max?: number;
  numbered?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="t-caption text-[var(--color-ink-mute)]">No data.</p>;
  }
  const m = max ?? rows.reduce((acc, r) => Math.max(acc, r.weight_pct), 0);
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="flex items-center gap-3">
          {numbered && (
            <span className="t-micro-cap w-5 shrink-0 text-right text-[var(--color-ink-mute)]">
              {String(i + 1).padStart(2, "0")}
            </span>
          )}
          <span className="t-body-md min-w-0 flex-1 truncate text-[var(--color-ink)]" title={r.label}>
            {r.label}
          </span>
          <div className="w-24 shrink-0">
            <CompositionBar pct={r.weight_pct} max={m} />
          </div>
          <span className="num t-caption w-12 shrink-0 text-right text-[var(--color-ink)]">
            {fmtPctPlain(r.weight_pct, 1)}
          </span>
        </li>
      ))}
    </ul>
  );
}

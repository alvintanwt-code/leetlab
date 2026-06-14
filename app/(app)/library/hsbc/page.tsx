import Link from "next/link";
import { listFundsForProvider, providerStats, type FundListRow } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

function NumberCell({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="text-[var(--color-ink-mute)]">—</span>;
  if (value === 0) return <span className="num text-[var(--color-ink)]">0.00{suffix}</span>;
  const cls = value > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  const sign = value > 0 ? "+" : "−";
  return <span className={`num ${cls}`}>{sign}{Math.abs(value).toFixed(2)}{suffix}</span>;
}

function RiskDots({ level }: { level: number | null }) {
  const lvl = level ?? 0;
  return (
    <span className="inline-flex items-center gap-[3px]" aria-label={`Risk ${lvl} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-[5px] w-[5px] rounded-full ${i <= lvl ? "bg-[var(--color-ink)]" : "bg-[var(--color-hairline)]"}`}
        />
      ))}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  // Parse YYYY-MM-DD as a local date to avoid TZ rollback ("2026-06-11" → 10 Jun in UTC-X).
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[3]} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

export default async function HsbcLibraryPage() {
  const [funds, stats] = await Promise.all([
    listFundsForProvider("hsbc"),
    providerStats("hsbc"),
  ]);
  const navAsOf = funds.find((f) => f.nav_as_of)?.nav_as_of ?? null;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10 py-10">
      <header className="mb-8 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="t-micro-cap mb-2">Library</p>
          <h1 className="t-display-lg text-[var(--color-ink)]">HSBC Life Singapore</h1>
          <p className="t-body-md mt-2 truncate text-[var(--color-ink-mute)]">
            <span className="num">{stats.fundCount}</span>&nbsp;of&nbsp;<span className="num">232</span>&nbsp;funds &middot;{" "}
            fundprices.insurance.hsbc.com.sg &middot; refreshed&nbsp;<span className="num">{fmtDate(navAsOf)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn-pill btn-ghost whitespace-nowrap">Refresh</button>
          <button className="btn-pill btn-primary whitespace-nowrap">Build portfolio</button>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-hairline-input)] bg-[var(--color-canvas)] px-3 py-2">
          <span className="text-[var(--color-ink-mute)]">⌕</span>
          <input
            placeholder="Search by fund name, ISIN, fund house"
            className="t-body-md w-72 bg-transparent outline-none placeholder:text-[var(--color-ink-mute)]"
          />
        </div>
        <span className="tag">Asset class · all</span>
        <span className="tag">Currency · all</span>
        <span className="tag">Risk · 1–5</span>
        <span className="tag">Fund house · all</span>
        <span className="tag tag-primary">
          <span className="num">{funds.length}</span>&nbsp;of&nbsp;<span className="num">232</span>&nbsp;shown
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
        <table className="table-pro" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "26%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Fund</th>
              <th>Ccy</th>
              <th>Asset class</th>
              <th>Distrib.</th>
              <th>Risk</th>
              <th className="right">NAV</th>
              <th className="right">3Y</th>
              <th className="right">5Y</th>
              <th className="right">10Y</th>
            </tr>
          </thead>
          <tbody>
            {funds.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-[var(--color-ink-mute)]">
                  No funds yet. Run <code className="t-body-tab">npm run scrape:hsbc -- --sample 10</code>.
                </td>
              </tr>
            ) : (
              funds.map((f) => (
                <tr key={f.id}>
                  <td className="cell-fund">
                    <Link href={`/library/hsbc/${f.external_id}`} className="block group">
                      <span className="name text-[var(--color-ink)] group-hover:text-[var(--color-primary)]" title={f.name}>
                        {f.name}
                      </span>
                      <span className="meta">
                        {f.fund_house ?? "—"} &middot; {f.isin ?? f.external_id}
                      </span>
                    </Link>
                  </td>
                  <td className="nowrap">
                    <span className="num text-[var(--color-ink-2)]">{f.currency ?? "—"}</span>
                  </td>
                  <td className="nowrap text-[var(--color-ink-2)]">{f.asset_class ?? "—"}</td>
                  <td className="nowrap text-[var(--color-ink-mute)]">{f.distribution_type ?? "—"}</td>
                  <td className="nowrap">
                    <RiskDots level={f.risk_rating} />
                  </td>
                  <td className="nowrap right">
                    {f.nav != null ? (
                      <span className="num text-[var(--color-ink)]">
                        {f.currency ?? ""}&nbsp;{f.nav.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-ink-mute)]">—</span>
                    )}
                  </td>
                  <td className="nowrap right"><NumberCell value={f.ann_3y} /></td>
                  <td className="nowrap right"><NumberCell value={f.ann_5y} /></td>
                  <td className="nowrap right"><NumberCell value={f.ann_10y} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="mt-5 flex items-center justify-between text-[var(--color-ink-mute)]">
        <p className="t-caption">
          Live from Neon Postgres &middot; sampled <span className="num">{funds.length}</span> of <span className="num">232</span>{" "}
          available. Full scrape pending.
        </p>
        <div className="flex items-center gap-2">
          <button className="btn-pill btn-ghost whitespace-nowrap">&larr; Previous</button>
          <span className="num t-caption px-2">1 of 1</span>
          <button className="btn-pill btn-ghost whitespace-nowrap">Next &rarr;</button>
        </div>
      </footer>
    </div>
  );
}

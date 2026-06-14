import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getFundByExternalId,
  getLatestSnapshot,
  getAllocations,
  getDocuments,
  type FundAllocation,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function fmtPct(value: number | null): { text: string; cls: string } {
  if (value == null) return { text: "—", cls: "text-[var(--color-ink-mute)]" };
  if (value === 0) return { text: "0.00%", cls: "text-[var(--color-ink)]" };
  const sign = value > 0 ? "+" : "−";
  const cls = value > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
  return { text: `${sign}${Math.abs(value).toFixed(2)}%`, cls };
}

type TabKey = "overview" | "performance" | "documents";
const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "performance", label: "Performance" },
  { key: "documents", label: "Documents" },
];

function groupAllocations(allocs: FundAllocation[]) {
  const buckets: Record<FundAllocation["kind"], FundAllocation[]> = {
    asset: [],
    geography: [],
    sector: [],
    holding: [],
  };
  for (const a of allocs) buckets[a.kind].push(a);
  return buckets;
}

function AllocationBar({ items, max = 10 }: { items: FundAllocation[]; max?: number }) {
  const top = items.slice(0, max);
  return (
    <ul className="flex flex-col gap-3">
      {top.map((a) => (
        <li key={`${a.kind}-${a.label}`} className="flex items-center gap-3">
          <span className="t-body-md w-44 shrink-0 truncate text-[var(--color-ink-2)]" title={a.label}>
            {a.label}
          </span>
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-hairline-2)]">
            <span
              className="absolute inset-y-0 left-0 bg-[var(--color-primary)]"
              style={{ width: `${Math.min(100, a.weight_pct).toFixed(2)}%` }}
            />
          </span>
          <span className="num w-16 shrink-0 text-right text-[13px] text-[var(--color-ink)]">
            {a.weight_pct.toFixed(2)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-baseline gap-4 py-3 border-b border-[var(--color-hairline-2)] last:border-b-0">
      <dt className="t-caption text-[var(--color-ink-mute)]">{label}</dt>
      <dd className="t-body-md text-[var(--color-ink)]">{value ?? "—"}</dd>
    </div>
  );
}

export default async function FundDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === tabParam)?.key ?? "overview");

  const fund = await getFundByExternalId("hsbc", id);
  if (!fund) notFound();

  const [snapshot, allocsRaw, docs] = await Promise.all([
    getLatestSnapshot(fund.id),
    getAllocations(fund.id),
    getDocuments(fund.id),
  ]);
  const allocs = groupAllocations(allocsRaw);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10 py-10">
      {/* Top: breadcrumb */}
      <div className="mb-6 flex items-center gap-2 t-caption">
        <Link href="/library/hsbc" className="text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]">
          HSBC Life Singapore
        </Link>
        <span className="text-[var(--color-ink-mute)]">/</span>
        <span className="text-[var(--color-ink-2)]">{fund.external_id}</span>
      </div>

      {/* Header: name + tags + NAV */}
      <header className="mb-8 grid grid-cols-12 gap-8">
        <div className="col-span-12 md:col-span-8 min-w-0">
          <p className="t-micro-cap mb-2">Fund</p>
          <h1 className="t-display-md text-[var(--color-ink)]">{fund.name}</h1>
          <p className="t-body-md mt-2 text-[var(--color-ink-mute)]">{fund.fund_house ?? "—"} &middot; <span className="num">{fund.isin ?? fund.external_id}</span></p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {fund.currency && <span className="tag">{fund.currency}</span>}
            {fund.asset_class && <span className="tag">{fund.asset_class}</span>}
            {fund.distribution_type && <span className="tag">{fund.distribution_type === "Acc" ? "Accumulating" : fund.distribution_type === "Dist" ? "Distributing" : fund.distribution_type}</span>}
            {fund.risk_rating != null && (
              <span className="tag">Risk {fund.risk_rating}{fund.risk_label ? ` · ${fund.risk_label}` : ""}</span>
            )}
            {fund.sfdr_classification && <span className="tag">SFDR {fund.sfdr_classification}</span>}
          </div>
        </div>
        <aside className="col-span-12 md:col-span-4 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
          <p className="t-micro-cap mb-2">NAV</p>
          {snapshot ? (
            <>
              <p className="t-display-md num text-[var(--color-ink)]">
                {snapshot.currency} {snapshot.nav?.toFixed(2)}
              </p>
              <p className="t-caption mt-2 text-[var(--color-ink-mute)]">
                as of <span className="num">{fmtDate(snapshot.as_of)}</span>
                {snapshot.change_pct != null && (
                  <>
                    {" · "}
                    <span className={fmtPct(snapshot.change_pct).cls}>{fmtPct(snapshot.change_pct).text}</span>
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="t-body-md text-[var(--color-ink-mute)]">No price data yet.</p>
          )}
        </aside>
      </header>

      {/* Tabs */}
      <div className="border-b border-[var(--color-hairline)]">
        <nav className="flex items-center gap-1">
          {TABS.map((t) => {
            const active = t.key === tab;
            const href = `/library/hsbc/${fund.external_id}?tab=${t.key}`;
            return (
              <Link
                key={t.key}
                href={href}
                className={`relative -mb-px px-4 py-3 t-body-md transition-colors ${
                  active
                    ? "text-[var(--color-ink)]"
                    : "text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
                }`}
              >
                {t.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-px h-[2px] bg-[var(--color-primary)]" aria-hidden />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <section className="py-8">
        {tab === "overview" && (
          <div className="grid grid-cols-12 gap-10">
            <div className="col-span-12 md:col-span-7">
              <p className="t-micro-cap mb-3">Investment objective</p>
              <p className="t-body-lg leading-relaxed text-[var(--color-ink-2)]">
                {fund.investment_objective ?? "—"}
              </p>

              {allocs.holding.length > 0 && (
                <div className="mt-10">
                  <p className="t-micro-cap mb-4">Top holdings</p>
                  <AllocationBar items={allocs.holding} max={10} />
                </div>
              )}

              {allocs.geography.length > 0 && (
                <div className="mt-10">
                  <p className="t-micro-cap mb-4">Geographical allocation</p>
                  <AllocationBar items={allocs.geography} max={8} />
                </div>
              )}

              {allocs.sector.length > 0 && (
                <div className="mt-10">
                  <p className="t-micro-cap mb-4">Sector allocation</p>
                  <AllocationBar items={allocs.sector} max={10} />
                </div>
              )}
            </div>

            <div className="col-span-12 md:col-span-5">
              <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-6">
                <p className="t-micro-cap mb-3">Fund facts</p>
                <dl>
                  <FactRow label="ISIN" value={<span className="num">{fund.isin ?? "—"}</span>} />
                  <FactRow label="Fund house" value={fund.fund_house} />
                  <FactRow label="Share class inception" value={fund.share_class_inception} />
                  <FactRow
                    label="Fund size"
                    value={
                      fund.fund_size != null ? (
                        <span className="num">
                          {fund.fund_size_currency} {fund.fund_size.toLocaleString()} M
                          {fund.fund_size_as_of ? (
                            <span className="t-caption ml-2 text-[var(--color-ink-mute)]">
                              ({fund.fund_size_as_of})
                            </span>
                          ) : null}
                        </span>
                      ) : null
                    }
                  />
                  <FactRow label="Dealing frequency" value={fund.dealing_frequency} />
                  <FactRow label="Benchmark" value={fund.benchmark} />
                  <FactRow
                    label="Morningstar rating"
                    value={
                      fund.morningstar_rating != null
                        ? "★".repeat(fund.morningstar_rating) + "☆".repeat(5 - fund.morningstar_rating)
                        : null
                    }
                  />
                </dl>
              </div>

              <div className="mt-5 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-6">
                <p className="t-micro-cap mb-3">Fees</p>
                <dl>
                  <FactRow
                    label="Expense ratio"
                    value={fund.expense_ratio != null ? <span className="num">{fund.expense_ratio.toFixed(2)}%</span> : null}
                  />
                  <FactRow
                    label="Annual management fee"
                    value={fund.management_fee != null ? <span className="num">{fund.management_fee.toFixed(2)}%</span> : null}
                  />
                </dl>
              </div>
            </div>
          </div>
        )}

        {tab === "performance" && (
          <div className="grid grid-cols-12 gap-10">
            <div className="col-span-12 md:col-span-8">
              <p className="t-micro-cap mb-4">Annualised returns</p>
              <div className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
                <table className="table-pro" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "25%" }} />
                    <col style={{ width: "25%" }} />
                    <col style={{ width: "25%" }} />
                    <col style={{ width: "25%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="right">1Y</th>
                      <th className="right">3Y</th>
                      <th className="right">5Y</th>
                      <th className="right">10Y</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {[snapshot?.ann_1y, snapshot?.ann_3y, snapshot?.ann_5y, snapshot?.ann_10y].map((v, i) => {
                        const f = fmtPct(v ?? null);
                        return (
                          <td key={i} className="nowrap right">
                            <span className={`num ${f.cls}`}>{f.text}</span>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="t-caption mt-3 text-[var(--color-ink-mute)]">
                Figures shown are annualised. Past performance is not an indicator of future returns.
              </p>

              <div className="mt-10 rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-10 text-center">
                <p className="t-micro-cap mb-2">NAV history</p>
                <p className="t-body-md text-[var(--color-ink-mute)]">
                  Time-series chart populates as the scraper accumulates daily snapshots. Today is day 1.
                </p>
              </div>
            </div>
            <aside className="col-span-12 md:col-span-4">
              <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-6">
                <p className="t-micro-cap mb-3">Risk &amp; volatility (3Y)</p>
                <dl>
                  <FactRow label="Alpha" value={<span className="num text-[var(--color-ink-mute)]">— pending</span>} />
                  <FactRow label="Beta" value={<span className="num text-[var(--color-ink-mute)]">— pending</span>} />
                  <FactRow label="Sharpe ratio" value={<span className="num text-[var(--color-ink-mute)]">— pending</span>} />
                  <FactRow label="Std deviation" value={<span className="num text-[var(--color-ink-mute)]">— pending</span>} />
                </dl>
                <p className="t-caption mt-3 text-[var(--color-ink-mute)]">
                  Risk metrics scrape on the next parser pass.
                </p>
              </div>
            </aside>
          </div>
        )}

        {tab === "documents" && (
          <div className="grid grid-cols-12 gap-10">
            <div className="col-span-12 md:col-span-8">
              <p className="t-micro-cap mb-4">Documents</p>
              <div className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
                <table className="table-pro" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "55%" }} />
                    <col style={{ width: "25%" }} />
                    <col style={{ width: "20%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Type</th>
                      <th className="right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.length === 0 ? (
                      <tr><td colSpan={3} className="text-center text-[var(--color-ink-mute)]">No documents recorded.</td></tr>
                    ) : (
                      docs.map((d) => (
                        <tr key={d.type}>
                          <td className="cell-fund">
                            <span className="name text-[var(--color-ink)]">{d.label}</span>
                            <span className="meta">PDF · provided by HSBC Life</span>
                          </td>
                          <td className="nowrap text-[var(--color-ink-2)]">{d.type}</td>
                          <td className="nowrap right">
                            <a
                              href={`/api/factsheet/${fund.external_id}?type=${d.type}`}
                              className="t-body-md text-[var(--color-primary)] hover:text-[var(--color-primary-deep)]"
                            >
                              Download
                            </a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="t-caption mt-3 text-[var(--color-ink-mute)]">
                Downloads proxy through the leetlab server (no third-party tracking). Factsheet endpoint is stub until the HSBC PDF URL resolver lands.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

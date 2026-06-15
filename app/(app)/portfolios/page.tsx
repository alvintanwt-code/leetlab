import Link from "next/link";
import { listConfirmedPortfolios, type ConfirmedPortfolio } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "conservative", label: "Conservative" },
  { key: "balanced", label: "Balanced" },
  { key: "growth", label: "Growth" },
  { key: "aggressive", label: "Aggressive" },
  { key: "dividend_income", label: "Dividend income" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function PortfolioCard({ p }: { p: ConfirmedPortfolio }) {
  let xray: { expense?: number | null; risk?: number | null; r3y?: number | null } = {};
  try { xray = p.xray_json ? JSON.parse(p.xray_json) : {}; } catch {}
  return (
    <article className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-h-md truncate text-[var(--color-ink)]" title={p.name}>{p.name}</p>
          <p className="t-caption mt-1 text-[var(--color-ink-mute)]">
            {p.provider_name} &middot; v<span className="num">{p.version}</span> &middot; {p.holding_count} fund{p.holding_count === 1 ? "" : "s"}
          </p>
        </div>
        <span className="tag tag-primary whitespace-nowrap">Confirmed</span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <dt className="t-caption text-[var(--color-ink-mute)]">Expense</dt>
          <dd className="num t-body-md text-[var(--color-ink)]">{xray.expense != null ? `${xray.expense.toFixed(2)}%` : "—"}</dd>
        </div>
        <div>
          <dt className="t-caption text-[var(--color-ink-mute)]">Risk</dt>
          <dd className="num t-body-md text-[var(--color-ink)]">{xray.risk != null ? `${xray.risk.toFixed(1)} / 5` : "—"}</dd>
        </div>
        <div>
          <dt className="t-caption text-[var(--color-ink-mute)]">3Y return</dt>
          <dd className="num t-body-md text-[var(--color-ink)]">{xray.r3y != null ? `${xray.r3y > 0 ? "+" : ""}${xray.r3y.toFixed(2)}%` : "—"}</dd>
        </div>
      </dl>
      {p.notes && <p className="mt-4 t-body-md italic text-[var(--color-ink-2)]">&ldquo;{p.notes}&rdquo;</p>}
      <p className="mt-4 t-caption text-[var(--color-ink-mute)]">Confirmed {fmtDate(p.confirmed_at)}</p>
    </article>
  );
}

export default async function PortfolioAnalysisPage({ searchParams }: { searchParams: Promise<{ confirmed?: string }> }) {
  const { confirmed } = await searchParams;
  const portfolios = await listConfirmedPortfolios();
  const byCategory = new Map<string, ConfirmedPortfolio[]>();
  for (const p of portfolios) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push(p);
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10 py-10">
      <header className="mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="t-micro-cap mb-2">Analysis</p>
          <h1 className="t-display-md text-[var(--color-ink)]">Confirmed portfolios</h1>
          <p className="t-body-md mt-2 text-[var(--color-ink-mute)]">
            <span className="num">{portfolios.length}</span> model portfolio{portfolios.length === 1 ? "" : "s"}, grouped by category.
          </p>
        </div>
        <Link href="/portfolio/build" className="btn-pill btn-primary whitespace-nowrap">+ Build new</Link>
      </header>

      {confirmed && (
        <div className="mb-6 flex items-center justify-between rounded-md border border-[#cfd7e1] bg-[#eef3fb] px-4 py-3">
          <p className="t-body-md text-[var(--color-ink)]">
            Model portfolio saved. <Link href={`/portfolio#${confirmed}`} className="text-[var(--color-primary)]">View &rarr;</Link>
          </p>
        </div>
      )}

      {portfolios.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-16 text-center">
          <p className="t-micro-cap mb-4">No portfolios yet</p>
          <h2 className="t-h-lg mx-auto max-w-md text-[var(--color-ink)]">Start by picking funds from a provider library.</h2>
          <p className="t-body-md mx-auto mt-3 max-w-md text-[var(--color-ink-mute)]">
            Confirmed portfolios will appear here, grouped by category — conservative, balanced, growth, aggressive, and dividend income.
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <Link href="/library/hsbc" className="btn-pill btn-primary">Open HSBC library</Link>
            <Link href="/portfolio/build" className="btn-pill btn-ghost">Open builder</Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {CATEGORIES.map((c) => {
            const list = byCategory.get(c.key) ?? [];
            return (
              <section key={c.key} id={c.key}>
                <div className="mb-4 flex items-baseline justify-between border-b border-[var(--color-hairline)] pb-3">
                  <h2 className="t-h-md text-[var(--color-ink)]">{c.label}</h2>
                  <span className="num t-caption text-[var(--color-ink-mute)]">{list.length}</span>
                </div>
                {list.length === 0 ? (
                  <p className="t-body-md text-[var(--color-ink-mute)]">
                    None yet. <Link href="/portfolio/build" className="text-[var(--color-primary)]">Build one</Link>.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {list.map((p) => <PortfolioCard key={p.id} p={p} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

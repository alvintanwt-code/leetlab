import Link from "next/link";
import {
  listConfirmedPortfolios,
  listProvidersWithCounts,
  type ConfirmedPortfolio,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "conservative", label: "Conservative" },
  { key: "balanced", label: "Balanced" },
  { key: "growth", label: "Growth" },
  { key: "aggressive", label: "Aggressive" },
  { key: "dividend_income", label: "Income" },
];

const PROVIDER_SHORT: Record<string, string> = {
  hsbc: "HSBC Life",
  tmls: "Tokio Marine",
  fwd: "FWD",
  gwm: "GWM",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function buildHref(provider: string | null, category: string | null): string {
  const params = new URLSearchParams();
  if (provider) params.set("provider", provider);
  if (category) params.set("category", category);
  const q = params.toString();
  return q ? `/portfolios?${q}` : "/portfolios";
}

function PortfolioCard({ p }: { p: ConfirmedPortfolio }) {
  let xray: { expense?: number | null; risk?: number | null; r3y?: number | null } = {};
  try {
    xray = p.xray_json ? JSON.parse(p.xray_json) : {};
  } catch {}
  return (
    <Link
      href={`/portfolios/${p.id}`}
      className="block rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5 transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-canvas-soft)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-h-md truncate text-[var(--color-ink)]" title={p.name}>
            {p.name}
          </p>
          <p className="t-caption mt-1 text-[var(--color-ink-mute)]">
            {p.provider_name} &middot; v<span className="num">{p.version}</span> &middot; {p.holding_count} fund
            {p.holding_count === 1 ? "" : "s"}
          </p>
        </div>
        <span className="tag tag-primary whitespace-nowrap">Confirmed</span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <dt className="t-caption text-[var(--color-ink-mute)]">Expense</dt>
          <dd className="num t-body-md text-[var(--color-ink)]">
            {xray.expense != null ? `${xray.expense.toFixed(2)}%` : "—"}
          </dd>
        </div>
        <div>
          <dt className="t-caption text-[var(--color-ink-mute)]">Risk</dt>
          <dd className="num t-body-md text-[var(--color-ink)]">
            {xray.risk != null ? `${xray.risk.toFixed(1)} / 5` : "—"}
          </dd>
        </div>
        <div>
          <dt className="t-caption text-[var(--color-ink-mute)]">3Y return</dt>
          <dd className="num t-body-md text-[var(--color-ink)]">
            {xray.r3y != null ? `${xray.r3y > 0 ? "+" : ""}${xray.r3y.toFixed(2)}%` : "—"}
          </dd>
        </div>
      </dl>
      {p.notes && <p className="mt-4 t-body-md italic text-[var(--color-ink-2)]">&ldquo;{p.notes}&rdquo;</p>}
      <p className="mt-4 t-caption text-[var(--color-ink-mute)]">Confirmed {fmtDate(p.confirmed_at)}</p>
    </Link>
  );
}

function TabLink({
  href,
  label,
  count,
  active,
  disabled,
}: {
  href: string;
  label: string;
  count?: number | null;
  active: boolean;
  disabled?: boolean;
}) {
  const base =
    "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 t-caption transition-colors";
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} text-[var(--color-ink-mute)] opacity-55`}
        title={`${label} · none yet`}
      >
        {label}
        <span className="num text-[10px]">—</span>
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${base} ${
        active
          ? "bg-[var(--color-canvas-soft)] text-[var(--color-ink)]"
          : "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
      }`}
    >
      {label}
      {count != null && (
        <span className="num text-[10px] text-[var(--color-ink-mute)]">{count}</span>
      )}
    </Link>
  );
}

export default async function ModelPortfoliosIndex({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; category?: string; confirmed?: string }>;
}) {
  const { provider: providerFilter, category: categoryFilter, confirmed } = await searchParams;

  const [portfolios, providers] = await Promise.all([
    listConfirmedPortfolios(),
    listProvidersWithCounts(),
  ]);

  // Counts for tab badges, computed from the unfiltered list.
  const providerCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const p of portfolios) {
    providerCounts.set(p.provider_slug, (providerCounts.get(p.provider_slug) ?? 0) + 1);
    categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
  }

  const filtered = portfolios.filter(
    (p) =>
      (!providerFilter || p.provider_slug === providerFilter) &&
      (!categoryFilter || p.category === categoryFilter),
  );

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10 py-10">
      <header className="mb-8">
        <p className="t-micro-cap mb-2">Analysis</p>
        <h1 className="t-display-md text-[var(--color-ink)]">Model Portfolios</h1>
        <p className="t-body-md mt-2 text-[var(--color-ink-mute)]">
          <span className="num">{portfolios.length}</span> confirmed{" "}
          {portfolios.length === 1 ? "portfolio" : "portfolios"} across{" "}
          <span className="num">{providerCounts.size}</span>{" "}
          {providerCounts.size === 1 ? "provider" : "providers"}. Click any card for the full
          analysis, including the trailing-return chart.
        </p>
      </header>

      {confirmed && (
        <div className="mb-6 flex items-center justify-between rounded-md border border-[#cfd7e1] bg-[#eef3fb] px-4 py-3">
          <p className="t-body-md text-[var(--color-ink)]">
            Model portfolio saved.{" "}
            <Link href={`/portfolios/${confirmed}`} className="text-[var(--color-primary)]">
              View &rarr;
            </Link>
          </p>
        </div>
      )}

      {/* Provider filter row */}
      <nav
        aria-label="Provider filter"
        className="mb-3 flex items-center gap-1 overflow-x-auto border-b border-[var(--color-hairline)] pb-2"
      >
        <TabLink
          href={buildHref(null, categoryFilter ?? null)}
          label="All providers"
          count={portfolios.length}
          active={!providerFilter}
        />
        {providers.map((p) => {
          const n = providerCounts.get(p.slug) ?? 0;
          return (
            <TabLink
              key={p.slug}
              href={buildHref(p.slug, categoryFilter ?? null)}
              label={PROVIDER_SHORT[p.slug] ?? p.name}
              count={n}
              active={providerFilter === p.slug}
              disabled={n === 0}
            />
          );
        })}
      </nav>

      {/* Category filter row */}
      <nav
        aria-label="Category filter"
        className="mb-8 flex items-center gap-1 overflow-x-auto"
      >
        <TabLink
          href={buildHref(providerFilter ?? null, null)}
          label="All categories"
          count={portfolios.length}
          active={!categoryFilter}
        />
        {CATEGORIES.map((c) => {
          const n = categoryCounts.get(c.key) ?? 0;
          return (
            <TabLink
              key={c.key}
              href={buildHref(providerFilter ?? null, c.key)}
              label={c.label}
              count={n}
              active={categoryFilter === c.key}
              disabled={n === 0}
            />
          );
        })}
      </nav>

      {portfolios.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-16 text-center">
          <p className="t-micro-cap mb-4">No portfolios yet</p>
          <h2 className="t-h-lg mx-auto max-w-md text-[var(--color-ink)]">
            Build one in the Portfolio Builder to see it here.
          </h2>
          <p className="t-body-md mx-auto mt-3 max-w-md text-[var(--color-ink-mute)]">
            Confirmed portfolios appear here, sortable by provider and category — conservative,
            balanced, growth, aggressive, and income.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-12 text-center">
          <p className="t-body-md text-[var(--color-ink-mute)]">
            No portfolios match this filter combination.{" "}
            <Link href="/portfolios" className="text-[var(--color-primary)]">
              Clear filters
            </Link>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <PortfolioCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

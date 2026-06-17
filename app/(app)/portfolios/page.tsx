import Link from "next/link";
import { PortfolioDetail } from "@/components/PortfolioDetail";
import {
  listConfirmedPortfolios,
  listProvidersWithCounts,
  getPortfolioHoldings,
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

function buildHref(params: { provider?: string | null; category?: string | null; view?: string | null }): string {
  const sp = new URLSearchParams();
  if (params.view) sp.set("view", params.view);
  if (params.provider) sp.set("provider", params.provider);
  if (params.category) sp.set("category", params.category);
  const q = sp.toString();
  return q ? `/portfolios?${q}` : "/portfolios";
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
  // Underline-style: active = ink + 2px ink underline aligned with row border; inactive = ink-mute.
  const base =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 pt-2 pb-2 -mb-px t-caption transition-colors";
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} border-transparent text-[var(--color-ink-mute)] opacity-50`}
        title={`${label} · none saved`}
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${base} ${
        active
          ? "border-[var(--color-ink)] text-[var(--color-ink)] font-medium"
          : "border-transparent text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
      }`}
    >
      {label}
      {count != null && (
        <span className="num text-[10px] text-[var(--color-ink-mute)]">{count}</span>
      )}
    </Link>
  );
}

function GridCell({ p }: { p: ConfirmedPortfolio | null }) {
  if (!p) {
    return (
      <div className="flex h-full flex-col items-start justify-center rounded-md border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-3.5">
        <p className="num text-[18px] font-medium leading-none text-[var(--color-ink-mute)]">—</p>
        <p className="t-micro-cap mt-1.5">Not built</p>
      </div>
    );
  }
  let xray: { expense?: number | null; risk?: number | null; r3y?: number | null } = {};
  try {
    xray = p.xray_json ? JSON.parse(p.xray_json) : {};
  } catch {}
  const r3y = xray.r3y;
  const r3yCls =
    r3y == null
      ? "text-[var(--color-ink-mute)]"
      : r3y > 0
        ? "text-[var(--color-positive)]"
        : r3y < 0
          ? "text-[var(--color-negative)]"
          : "text-[var(--color-ink)]";
  return (
    <Link
      href={buildHref({ provider: p.provider_slug, category: p.category })}
      className="block h-full rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-3.5 transition-colors hover:border-[var(--color-ink)]"
    >
      <p className="t-body-md truncate font-medium text-[var(--color-ink)]" title={p.name}>{p.name}</p>
      <p className="t-micro-cap mt-1">
        v<span className="num">{p.version}</span> &middot; <span className="num">{p.holding_count}</span>{" "}
        {p.holding_count === 1 ? "fund" : "funds"}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--color-hairline-2)] pt-3">
        <div>
          <p className={`num text-[15px] font-medium leading-none ${r3yCls}`}>
            {r3y != null ? `${r3y > 0 ? "+" : ""}${r3y.toFixed(1)}%` : "—"}
          </p>
          <p className="t-micro-cap mt-1.5">3Y CAGR</p>
        </div>
        <div>
          <p className="num text-[15px] font-medium leading-none text-[var(--color-ink)]">
            {xray.risk != null ? xray.risk.toFixed(1) : "—"}
          </p>
          <p className="t-micro-cap mt-1.5">Risk</p>
        </div>
      </div>
    </Link>
  );
}

export default async function ModelPortfoliosIndex({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; provider?: string; category?: string; confirmed?: string }>;
}) {
  const sp = await searchParams;
  const isShowAll = sp.view === "all";

  const [portfolios, providers] = await Promise.all([
    listConfirmedPortfolios(),
    listProvidersWithCounts(),
  ]);

  // Latest version per (provider, category) — the list is ordered by confirmed_at DESC
  // so the first occurrence wins.
  const latestByKey = new Map<string, ConfirmedPortfolio>();
  const providerCounts = new Map<string, number>();
  for (const p of portfolios) {
    const key = `${p.provider_slug}::${p.category}`;
    if (!latestByKey.has(key)) latestByKey.set(key, p);
    providerCounts.set(p.provider_slug, (providerCounts.get(p.provider_slug) ?? 0) + 1);
  }

  // Resolve the active provider — explicit param wins, else first provider that has any saved portfolio.
  const providersWithSaved = providers.filter((p) => (providerCounts.get(p.slug) ?? 0) > 0);
  const activeProvider =
    sp.provider && providersWithSaved.some((p) => p.slug === sp.provider)
      ? sp.provider
      : providersWithSaved[0]?.slug ?? null;

  // Categories saved on the active provider.
  const savedCategoriesForProvider = activeProvider
    ? new Set(portfolios.filter((p) => p.provider_slug === activeProvider).map((p) => p.category))
    : new Set<string>();

  // Resolve the active category — explicit param if saved on this provider, else first saved category.
  const activeCategory =
    !isShowAll && sp.category && savedCategoriesForProvider.has(sp.category)
      ? sp.category
      : !isShowAll && activeProvider
      ? CATEGORIES.find((c) => savedCategoriesForProvider.has(c.key))?.key ?? null
      : null;

  const activePortfolio =
    !isShowAll && activeProvider && activeCategory
      ? latestByKey.get(`${activeProvider}::${activeCategory}`) ?? null
      : null;

  const holdings = activePortfolio ? await getPortfolioHoldings(activePortfolio.id) : [];

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10">
      {sp.confirmed && (
        <div className="mt-4 flex items-center justify-between rounded-md border border-[#cfd7e1] bg-[#eef3fb] px-4 py-2.5">
          <p className="t-caption text-[var(--color-ink)]">
            Saved.{" "}
            <Link href={`/portfolios/${sp.confirmed}`} className="text-[var(--color-primary)]">
              View full detail →
            </Link>
          </p>
        </div>
      )}

      {portfolios.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-16 text-center">
          <p className="t-micro-cap mb-4">No portfolios yet</p>
          <h2 className="t-h-lg mx-auto max-w-md text-[var(--color-ink)]">
            Build one in the Portfolio Builder to see it here.
          </h2>
          <p className="t-body-md mx-auto mt-3 max-w-md text-[var(--color-ink-mute)]">
            Confirmed portfolios appear here, sortable by provider and risk profile.
          </p>
        </div>
      ) : (
        <>
          {/* Sticky chrome — title + platform + mandate, in eyebrow-aligned rows */}
          <div className="sticky top-0 z-20 -mx-10 mb-6 bg-[var(--color-canvas-soft)] px-10">
            {/* Row 1: title + show-all toggle */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline-2)] py-3">
              <h1 className="t-h-md text-[var(--color-ink)]">Model Portfolio</h1>
              <Link
                href={buildHref({ view: "all" })}
                className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 t-caption transition-colors ${
                  isShowAll
                    ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                    : "border-[var(--color-hairline)] text-[var(--color-ink-2)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
                }`}
              >
                Show all
              </Link>
            </div>

            {/* Row 2: PLATFORM */}
            <div className="flex items-center gap-6 border-b border-[var(--color-hairline-2)]">
              <p className="t-micro-cap w-20 shrink-0 py-2">Platform</p>
              <nav aria-label="Platform" className="flex items-center gap-3 overflow-x-auto">
                {providers.map((p) => {
                  const n = providerCounts.get(p.slug) ?? 0;
                  return (
                    <TabLink
                      key={p.slug}
                      href={buildHref({ provider: p.slug })}
                      label={PROVIDER_SHORT[p.slug] ?? p.name}
                      active={!isShowAll && activeProvider === p.slug}
                      disabled={n === 0}
                    />
                  );
                })}
              </nav>
            </div>

            {/* Row 3: MANDATE — hidden in show-all */}
            {!isShowAll && activeProvider && (
              <div className="flex items-center gap-6 border-b border-[var(--color-hairline)]">
                <p className="t-micro-cap w-20 shrink-0 py-2">Mandate</p>
                <nav aria-label="Mandate" className="flex items-center gap-3 overflow-x-auto">
                  {CATEGORIES.map((c) => {
                    const has = savedCategoriesForProvider.has(c.key);
                    return (
                      <TabLink
                        key={c.key}
                        href={buildHref({ provider: activeProvider, category: c.key })}
                        label={c.label}
                        active={activeCategory === c.key}
                        disabled={!has}
                      />
                    );
                  })}
                </nav>
              </div>
            )}
          </div>

          {/* Expanded portfolio detail OR show-all grid */}
          {isShowAll ? (
            <section className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)]">
              {/* Header row */}
              <div className="grid border-b border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] px-4 py-2.5" style={{ gridTemplateColumns: "160px repeat(5, 1fr)" }}>
                <p className="t-micro-cap">Platform</p>
                {CATEGORIES.map((c) => (
                  <p key={c.key} className="t-micro-cap pl-3">{c.label}</p>
                ))}
              </div>
              {providersWithSaved.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="t-body-md text-[var(--color-ink-mute)]">No saved portfolios yet.</p>
                </div>
              ) : (
                providersWithSaved.map((prov) => (
                  <div
                    key={prov.slug}
                    className="grid items-stretch border-b border-[var(--color-hairline-2)] px-4 py-3 last:border-0"
                    style={{ gridTemplateColumns: "160px repeat(5, 1fr)" }}
                  >
                    <div className="flex flex-col justify-center pr-3">
                      <p className="t-body-md font-medium text-[var(--color-ink)]">{PROVIDER_SHORT[prov.slug] ?? prov.name}</p>
                      <p className="t-micro-cap mt-1">
                        <span className="num">{providerCounts.get(prov.slug) ?? 0}</span> saved
                      </p>
                    </div>
                    {CATEGORIES.map((c) => (
                      <div key={c.key} className="pl-3">
                        <GridCell p={latestByKey.get(`${prov.slug}::${c.key}`) ?? null} />
                      </div>
                    ))}
                  </div>
                ))
              )}
            </section>
          ) : activePortfolio ? (
            <div className="pb-10">
              <PortfolioDetail portfolio={activePortfolio} holdings={holdings} />
            </div>
          ) : activeProvider ? (
            <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-12 text-center">
              <p className="t-body-md text-[var(--color-ink-mute)]">
                No risk profile saved for this platform yet.{" "}
                <Link href={`/construction/${activeProvider}`} className="text-[var(--color-primary)]">
                  Build one →
                </Link>
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-12 text-center">
              <p className="t-body-md text-[var(--color-ink-mute)]">
                Select a platform above, or{" "}
                <Link href={buildHref({ view: "all" })} className="text-[var(--color-primary)]">
                  show all
                </Link>
                .
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

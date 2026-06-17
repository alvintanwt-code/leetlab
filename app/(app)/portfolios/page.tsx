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
  const base =
    "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 t-caption transition-colors";
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} text-[var(--color-ink-mute)] opacity-55`}
        title={`${label} · none saved`}
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

function GridCell({ p }: { p: ConfirmedPortfolio | null }) {
  if (!p) {
    return (
      <div className="flex h-full flex-col justify-center rounded-md border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-3 text-center">
        <p className="t-caption text-[var(--color-ink-mute)]">Not built</p>
      </div>
    );
  }
  let xray: { expense?: number | null; risk?: number | null; r3y?: number | null } = {};
  try {
    xray = p.xray_json ? JSON.parse(p.xray_json) : {};
  } catch {}
  const r3y = xray.r3y;
  const r3yCls = r3y == null ? "text-[var(--color-ink-mute)]" : r3y > 0 ? "text-[var(--color-positive)]" : r3y < 0 ? "text-[var(--color-negative)]" : "text-[var(--color-ink)]";
  return (
    <Link
      href={buildHref({ provider: p.provider_slug, category: p.category })}
      className="block rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-3 transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-canvas-soft)]"
    >
      <p className="t-caption truncate text-[var(--color-ink)]" title={p.name}>{p.name}</p>
      <p className="t-micro mt-0.5 text-[var(--color-ink-mute)]">
        v<span className="num">{p.version}</span> · <span className="num">{p.holding_count}</span> fund{p.holding_count === 1 ? "" : "s"}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-1.5">
        <div>
          <dt className="t-micro-cap text-[10px]">3Y</dt>
          <dd className={`num t-caption ${r3yCls}`}>
            {r3y != null ? `${r3y > 0 ? "+" : ""}${r3y.toFixed(2)}%` : "—"}
          </dd>
        </div>
        <div>
          <dt className="t-micro-cap text-[10px]">Risk</dt>
          <dd className="num t-caption text-[var(--color-ink)]">
            {xray.risk != null ? `${xray.risk.toFixed(1)}/5` : "—"}
          </dd>
        </div>
      </dl>
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
    <div className="mx-auto w-full max-w-[1280px] px-10 py-8">
      <header className="mb-6">
        <p className="t-micro-cap mb-1.5">Analysis</p>
        <h1 className="t-display-md text-[var(--color-ink)]">Model Portfolios</h1>
        <p className="t-body-md mt-1.5 text-[var(--color-ink-mute)]">
          <span className="num">{portfolios.length}</span> confirmed{" "}
          {portfolios.length === 1 ? "portfolio" : "portfolios"} across{" "}
          <span className="num">{providerCounts.size}</span>{" "}
          {providerCounts.size === 1 ? "provider" : "providers"}.
        </p>
      </header>

      {sp.confirmed && (
        <div className="mb-6 flex items-center justify-between rounded-md border border-[#cfd7e1] bg-[#eef3fb] px-4 py-3">
          <p className="t-body-md text-[var(--color-ink)]">
            Model portfolio saved.{" "}
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
          {/* Sticky sub-nav — only the analysis below changes on toggle */}
          <div className="sticky top-0 z-20 -mx-10 mb-6 border-b border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] px-10 pt-3 pb-2">
            <div className="flex items-center justify-between gap-3">
              <nav aria-label="Provider" className="flex items-center gap-1 overflow-x-auto">
                {providers.map((p) => {
                  const n = providerCounts.get(p.slug) ?? 0;
                  return (
                    <TabLink
                      key={p.slug}
                      href={buildHref({ provider: p.slug })}
                      label={PROVIDER_SHORT[p.slug] ?? p.name}
                      count={n}
                      active={!isShowAll && activeProvider === p.slug}
                      disabled={n === 0}
                    />
                  );
                })}
              </nav>
              <Link
                href={buildHref({ view: "all" })}
                className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 t-caption transition-colors ${
                  isShowAll
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                    : "border-[var(--color-hairline)] text-[var(--color-ink-2)] hover:border-[var(--color-primary)] hover:text-[var(--color-ink)]"
                }`}
              >
                Show all
              </Link>
            </div>

            {!isShowAll && activeProvider && (
              <nav
                aria-label="Risk profile"
                className="mt-2 flex items-center gap-1 overflow-x-auto border-t border-[var(--color-hairline-2)] pt-2"
              >
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
                      <p className="t-body-md text-[var(--color-ink)]">{PROVIDER_SHORT[prov.slug] ?? prov.name}</p>
                      <p className="t-micro mt-0.5 text-[var(--color-ink-mute)]">
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
            <>
              <p className="mb-2 t-caption text-[var(--color-ink-mute)]">
                Latest confirmed for {PROVIDER_SHORT[activePortfolio.provider_slug] ?? activePortfolio.provider_name} · {CATEGORIES.find((c) => c.key === activePortfolio.category)?.label}
                {" · "}
                <Link
                  href={`/portfolios/${activePortfolio.id}`}
                  className="text-[var(--color-primary)] hover:text-[var(--color-primary-deep)]"
                >
                  open standalone →
                </Link>
              </p>
              <PortfolioDetail portfolio={activePortfolio} holdings={holdings} />
            </>
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

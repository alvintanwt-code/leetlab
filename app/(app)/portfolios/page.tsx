import Link from "next/link";
import {
  listConfirmedPortfolios,
  listProvidersWithCounts,
  getPortfolioHoldings,
  type ConfirmedPortfolio,
} from "@/lib/db/queries";
import { PortfolioCard, PortfolioRow, type PortfolioCardData } from "@/components/PortfolioCard";
import { computeAssetMix, computeRiskRating, parseXray } from "@/lib/portfolio-derive";
import { blendPortfolioSeries, blendPortfolioYield } from "@/lib/portfolio-performance";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/portfolio-mandates";

export const dynamic = "force-dynamic";

const PLATFORM_TABS: { slug: string; short: string; disabled?: boolean }[] = [
  { slug: "hsbc", short: "HSBC" },
  { slug: "fwd", short: "FWD" },
  { slug: "tmls", short: "TM" },
  { slug: "gwm", short: "GWM", disabled: true },
];

const STRATEGY_CHIPS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  ...CATEGORY_ORDER.map((k) => ({ key: k, label: CATEGORY_LABELS[k] })),
];

function buildHref(params: {
  platform?: string;
  strategy?: string;
  view?: string;
  confirmed?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (params.platform) sp.set("platform", params.platform);
  if (params.strategy && params.strategy !== "all") sp.set("strategy", params.strategy);
  if (params.view && params.view !== "card") sp.set("view", params.view);
  if (params.confirmed) sp.set("confirmed", params.confirmed);
  const q = sp.toString();
  return q ? `/portfolios?${q}` : "/portfolios";
}

export default async function ModelPortfoliosIndex({
  searchParams,
}: {
  searchParams: Promise<{
    platform?: string;
    strategy?: string;
    view?: string;
    confirmed?: string;
    provider?: string; // legacy
    category?: string; // legacy
  }>;
}) {
  const sp = await searchParams;

  const [allPortfolios, providers] = await Promise.all([
    listConfirmedPortfolios(),
    listProvidersWithCounts(),
  ]);

  // Per-platform saved counts (drives default platform selection).
  const platformCounts = new Map<string, number>();
  for (const p of allPortfolios) {
    platformCounts.set(p.provider_slug, (platformCounts.get(p.provider_slug) ?? 0) + 1);
  }

  // Resolve active platform — explicit param (incl. legacy ?provider=) wins,
  // else first enabled tab that has saved portfolios.
  const requested = sp.platform ?? sp.provider;
  const isValid = (slug?: string) =>
    !!slug && PLATFORM_TABS.some((t) => t.slug === slug && !t.disabled);
  const fallback = PLATFORM_TABS.find((t) => !t.disabled && (platformCounts.get(t.slug) ?? 0) > 0)?.slug
    ?? PLATFORM_TABS.find((t) => !t.disabled)!.slug;
  const activePlatform = isValid(requested) ? requested! : fallback;

  // Resolve active strategy — supports legacy ?category=.
  const requestedStrategy = sp.strategy ?? sp.category ?? "all";
  const activeStrategy =
    requestedStrategy === "all" || CATEGORY_ORDER.includes(requestedStrategy) ? requestedStrategy : "all";

  const activeView = sp.view === "row" ? "row" : "card";

  // Filter portfolios — latest version per (platform, category).
  const platformPortfolios = allPortfolios.filter((p) => p.provider_slug === activePlatform);
  const latestByCategory = new Map<string, ConfirmedPortfolio>();
  for (const p of platformPortfolios) {
    if (!latestByCategory.has(p.category)) latestByCategory.set(p.category, p);
  }
  const filtered: ConfirmedPortfolio[] = (() => {
    const list = [...latestByCategory.values()];
    const inOrder = CATEGORY_ORDER.map((k) => list.find((p) => p.category === k)).filter(
      (p): p is ConfirmedPortfolio => p != null,
    );
    return activeStrategy === "all" ? inOrder : inOrder.filter((p) => p.category === activeStrategy);
  })();

  // Build the per-card data: holdings → asset mix, xray, series.
  const cardData: PortfolioCardData[] = await Promise.all(
    filtered.map(async (portfolio) => {
      const holdings = await getPortfolioHoldings(portfolio.id);
      const xray = parseXray(portfolio);
      const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;
      const components = holdings
        .filter((h) => !!h.isin)
        .map((h) => ({ isin: h.isin as string, weight: h.weight_bps / totalBps }));
      const isIncome = portfolio.category === "dividend_income";
      const [series, yieldBlend] = await Promise.all([
        blendPortfolioSeries(components, 36),
        isIncome ? blendPortfolioYield(components) : Promise.resolve(null),
      ]);
      return {
        portfolio,
        assetMix: computeAssetMix(holdings),
        xray,
        risk: computeRiskRating(holdings, xray),
        series,
        yieldPct: yieldBlend ? yieldBlend.yieldPct : null,
      };
    }),
  );

  return (
    <div className="mx-auto w-full max-w-[1280px] px-20 pb-16">
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

      {/* Sticky chrome — anchor + filter nav. Mirrors the FundSwitchWorkspace
          ChromeTitle + platform-strip pattern so both workspaces share the
          same header shape. */}
      <div className="sticky top-0 z-20 -mx-20 mb-12 bg-[var(--color-canvas-soft)] px-20">
        <header className="border-b border-[var(--color-hairline-2)] py-3">
          <p className="t-micro-cap mb-1">Advisor workspace</p>
          <h1 className="t-h-md text-[var(--color-ink)]">Model portfolio</h1>
        </header>
        <div className="flex items-center gap-6 border-b border-[var(--color-hairline-2)]">
          <p className="t-micro-cap w-20 shrink-0 py-2">Platform</p>
          <div className="flex flex-1 items-center gap-1 overflow-x-auto">
            {PLATFORM_TABS.map((t) => {
              const active = !t.disabled && t.slug === activePlatform;
              const cls = "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 -mb-px t-caption transition-colors";
              if (t.disabled) {
                return (
                  <span
                    key={t.slug}
                    aria-disabled="true"
                    className={`${cls} cursor-not-allowed border-transparent text-[var(--color-ink-mute)] opacity-40`}
                    title="GWM — coming soon"
                  >
                    {t.short}
                  </span>
                );
              }
              return (
                <Link
                  key={t.slug}
                  href={buildHref({ platform: t.slug, strategy: "all", view: activeView })}
                  className={`${cls} ${
                    active
                      ? "border-[var(--color-ink)] font-medium text-[var(--color-ink)]"
                      : "border-transparent text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {t.short}
                  <span className="num text-[10px] text-[var(--color-ink-mute)]">
                    {platformCounts.get(t.slug) ?? 0}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <p className="t-micro-cap w-20 shrink-0 py-2">Strategy</p>
          <div className="flex flex-1 items-center gap-1 overflow-x-auto">
            {STRATEGY_CHIPS.map((c) => {
              const active = c.key === activeStrategy;
              return (
                <Link
                  key={c.key}
                  href={buildHref({ platform: activePlatform, strategy: c.key, view: activeView })}
                  className={`inline-flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-3 -mb-px t-caption transition-colors ${
                    active
                      ? "border-[var(--color-ink)] font-medium text-[var(--color-ink)]"
                      : "border-transparent text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {c.label}
                </Link>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 py-2">
            <Link
              href={buildHref({ platform: activePlatform, strategy: activeStrategy, view: "card" })}
              aria-label="Card view"
              className={`flex h-7 w-7 items-center justify-center border ${
                activeView === "card"
                  ? "border-[var(--color-ink)] text-[var(--color-ink)]"
                  : "border-[var(--color-hairline)] text-[var(--color-ink-mute)] hover:border-[var(--color-ink)]"
              }`}
              title="Card view"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="1" y="1" width="4" height="4" /><rect x="7" y="1" width="4" height="4" />
                <rect x="1" y="7" width="4" height="4" /><rect x="7" y="7" width="4" height="4" />
              </svg>
            </Link>
            <Link
              href={buildHref({ platform: activePlatform, strategy: activeStrategy, view: "row" })}
              aria-label="Row view"
              className={`flex h-7 w-7 items-center justify-center border ${
                activeView === "row"
                  ? "border-[var(--color-ink)] text-[var(--color-ink)]"
                  : "border-[var(--color-hairline)] text-[var(--color-ink-mute)] hover:border-[var(--color-ink)]"
              }`}
              title="Row view"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <line x1="1" y1="3" x2="11" y2="3" /><line x1="1" y1="6" x2="11" y2="6" /><line x1="1" y1="9" x2="11" y2="9" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      {/* Card grid OR row list */}
      {cardData.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-16 text-center">
          <p className="t-micro-cap mb-3">No portfolios</p>
          <h2 className="t-h-lg mx-auto max-w-md text-[var(--color-ink)]">
            Nothing saved for this filter yet.
          </h2>
          <p className="t-body-md mx-auto mt-3 max-w-md text-[var(--color-ink-mute)]">
            Build one in the Portfolio Builder, or change platform / strategy above.
          </p>
          <Link
            href={`/construction/${activePlatform}`}
            className="mt-5 inline-flex t-caption text-[var(--color-primary)] hover:underline"
          >
            Build for {PLATFORM_TABS.find((t) => t.slug === activePlatform)?.short} →
          </Link>
        </div>
      ) : activeView === "card" ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {cardData.map((d) => (
            <PortfolioCard key={d.portfolio.id} data={d} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-6">
          {cardData.map((d) => (
            <PortfolioRow key={d.portfolio.id} data={d} />
          ))}
        </div>
      )}
    </div>
  );
}

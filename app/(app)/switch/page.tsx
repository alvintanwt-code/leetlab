import Link from "next/link";
import {
  listConfirmedPortfolios,
  listProvidersWithCounts,
  type ConfirmedPortfolio,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const PROVIDER_SHORT: Record<string, string> = {
  hsbc: "HSBC Life",
  tmls: "Tokio Marine",
  fwd: "FWD",
  gwm: "GWM",
};

const CATEGORY_LABEL: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
  aggressive: "Aggressive",
  dividend_income: "Income",
};

function buildHref(params: { platform?: string | null }): string {
  const sp = new URLSearchParams();
  if (params.platform) sp.set("platform", params.platform);
  const q = sp.toString();
  return q ? `/switch?${q}` : "/switch";
}

function TabLink({
  href,
  label,
  active,
  disabled,
}: {
  href: string;
  label: string;
  active: boolean;
  disabled?: boolean;
}) {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 pt-2 pb-2 -mb-px t-caption transition-colors";
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} border-transparent text-[var(--color-ink-mute)] opacity-50`}
        title={`${label} · no confirmed models`}
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
    </Link>
  );
}

function RiskDots({ value }: { value: number | null | undefined }) {
  const v = value ?? 0;
  return (
    <span className="inline-flex items-center gap-[3px] align-middle">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`block h-[5px] w-[5px] rounded-[1px] ${
            i <= v ? "bg-[var(--color-ink)]" : "bg-[var(--color-hairline)]"
          }`}
        />
      ))}
    </span>
  );
}

function ModelRow({ p }: { p: ConfirmedPortfolio }) {
  let xray: { risk?: number | null; r3y?: number | null } = {};
  try {
    xray = p.xray_json ? JSON.parse(p.xray_json) : {};
  } catch {}
  const r3y = xray.r3y;
  return (
    <div className="group flex cursor-pointer items-center justify-between border-b border-[var(--color-hairline-2)] py-3 pl-3 pr-4 last:border-0 hover:bg-[var(--color-canvas-soft)]">
      <div className="min-w-0">
        <p className="t-body-md truncate font-medium text-[var(--color-ink)]" title={p.name}>
          {p.name}
        </p>
        <p className="t-micro-cap mt-1 flex items-center gap-2 text-[var(--color-ink-mute)]">
          <span>{CATEGORY_LABEL[p.category] ?? p.category}</span>
          <span className="text-[var(--color-hairline)]">·</span>
          <RiskDots value={xray.risk ?? null} />
          <span className="text-[var(--color-hairline)]">·</span>
          <span className="num">
            {r3y != null ? `${r3y > 0 ? "+" : ""}${r3y.toFixed(1)}% 3Y` : "— 3Y"}
          </span>
        </p>
      </div>
    </div>
  );
}

export default async function FundSwitchPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  const sp = await searchParams;

  const [portfolios, providers] = await Promise.all([
    listConfirmedPortfolios(),
    listProvidersWithCounts(),
  ]);

  const providerCounts = new Map<string, number>();
  for (const p of portfolios) {
    providerCounts.set(p.provider_slug, (providerCounts.get(p.provider_slug) ?? 0) + 1);
  }

  const providersWithSaved = providers.filter((p) => (providerCounts.get(p.slug) ?? 0) > 0);
  const activePlatform =
    sp.platform && providersWithSaved.some((p) => p.slug === sp.platform)
      ? sp.platform
      : providersWithSaved[0]?.slug ?? null;

  const platformModels = activePlatform
    ? portfolios.filter((p) => p.provider_slug === activePlatform)
    : [];

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10">
      {/* Sticky chrome — title + platform row */}
      <div className="sticky top-0 z-20 -mx-10 mb-6 bg-[var(--color-canvas-soft)] px-10">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline-2)] py-3">
          <div>
            <p className="t-micro-cap mb-1">Advisor workspace</p>
            <h1 className="t-h-md text-[var(--color-ink)]">Fund Switch</h1>
          </div>
          <p className="t-caption max-w-sm text-right text-[var(--color-ink-mute)]">
            Client portfolio in, switch memo out. Nothing persists.
          </p>
        </div>

        <div className="flex items-center gap-6 border-b border-[var(--color-hairline)]">
          <p className="t-micro-cap w-20 shrink-0 py-2">Platform</p>
          <nav aria-label="Platform" className="flex items-center gap-3 overflow-x-auto">
            {providers.map((p) => {
              const n = providerCounts.get(p.slug) ?? 0;
              return (
                <TabLink
                  key={p.slug}
                  href={buildHref({ platform: p.slug })}
                  label={PROVIDER_SHORT[p.slug] ?? p.name}
                  active={activePlatform === p.slug}
                  disabled={n === 0}
                />
              );
            })}
          </nav>
        </div>
      </div>

      {!activePlatform ? (
        <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] px-10 py-12 text-center">
          <p className="t-body-md text-[var(--color-ink-mute)]">
            No confirmed model portfolios yet.{" "}
            <Link href="/portfolios" className="text-[var(--color-primary)]">
              Build one first →
            </Link>
          </p>
        </div>
      ) : (
        <>
          {/* Two-column input grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            {/* Left: Client portfolio */}
            <section className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="t-body-md font-medium text-[var(--color-ink)]">Client portfolio</h2>
                <p className="t-micro-cap">Current holdings</p>
              </div>

              {/* Editable holdings table — Phase 1: visual placeholder rows */}
              <div className="overflow-hidden rounded-md border border-[var(--color-hairline-2)]">
                <table className="table-pro w-full">
                  <colgroup>
                    <col />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "140px" }} />
                    <col style={{ width: "140px" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="text-left">Fund</th>
                      <th className="text-right">Units</th>
                      <th className="text-right">Cost basis</th>
                      <th className="text-right">Current value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <PlaceholderRow />
                    <PlaceholderRow />
                    <PlaceholderRow />
                  </tbody>
                </table>
                <button
                  type="button"
                  disabled
                  className="t-caption w-full cursor-not-allowed border-t border-dashed border-[var(--color-hairline-2)] py-3 text-left text-[var(--color-ink-mute)] opacity-60"
                >
                  + Add holding
                </button>
              </div>

              <p className="t-micro-cap mt-4 text-[var(--color-ink-mute)]">
                Type or paste holdings. Cost basis and current value in SGD.
              </p>
            </section>

            {/* Right: Target model */}
            <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="t-body-md font-medium text-[var(--color-ink)]">Target model</h2>
                <p className="t-micro-cap">
                  {(PROVIDER_SHORT[activePlatform] ?? activePlatform).toUpperCase()} · CONFIRMED
                </p>
              </div>

              <div className="-mx-2 flex-1">
                {platformModels.length === 0 ? (
                  <div className="mx-2 rounded-md border border-dashed border-[var(--color-hairline-2)] px-4 py-8 text-center">
                    <p className="t-micro-cap">No confirmed models on this platform yet</p>
                  </div>
                ) : (
                  platformModels.map((p) => <ModelRow key={p.id} p={p} />)
                )}
              </div>
            </section>
          </div>

          {/* Generate row */}
          <div className="mt-6 flex items-center justify-between">
            <p className="t-micro-cap text-[var(--color-ink-mute)]">
              Generated memo is session-only. Closing the tab discards it.
            </p>
            <button
              type="button"
              disabled
              className="t-caption cursor-not-allowed rounded-full bg-[var(--color-canvas-soft)] px-5 py-2.5 font-medium text-[var(--color-ink-mute)]"
            >
              Add holdings and pick a model
            </button>
          </div>

          <div className="h-16" />
        </>
      )}
    </div>
  );
}

function PlaceholderRow() {
  return (
    <tr>
      <td>
        <span className="t-body-md text-[var(--color-ink-mute)] opacity-50">Fund name…</span>
      </td>
      <td className="nowrap right">
        <span className="num text-[var(--color-ink-mute)] opacity-50">—</span>
      </td>
      <td className="nowrap right">
        <span className="num text-[var(--color-ink-mute)] opacity-50">SGD —</span>
      </td>
      <td className="nowrap right">
        <span className="num text-[var(--color-ink-mute)] opacity-50">SGD —</span>
      </td>
    </tr>
  );
}

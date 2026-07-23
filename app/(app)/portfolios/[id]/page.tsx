import Link from "next/link";
import { notFound } from "next/navigation";
import { PortfolioDetail } from "@/components/PortfolioDetail";
import {
  getConfirmedPortfolio,
  getPortfolioHoldings,
} from "@/lib/db/queries";
import { computeTrailingReturns, fillHoldingsWithProxies } from "@/lib/factsheet/build";
import { computeLiveXrayExtras } from "@/lib/portfolio-xray-live";

export const dynamic = "force-dynamic";

export default async function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const portfolioId = parseInt(id, 10);
  if (!Number.isFinite(portfolioId)) notFound();

  const portfolio = await getConfirmedPortfolio(portfolioId);
  if (!portfolio) notFound();

  const rawHoldings = await getPortfolioHoldings(portfolioId);
  // Splice proxy-share-class trailing figures into per-holding rows so the
  // Instruments table below matches the portfolio-level blended numbers.
  const holdings = await fillHoldingsWithProxies(rawHoldings);

  // Rebuild the entire xray live rather than serving the stored snapshot.
  //   - Trailing returns via computeTrailingReturns (proxy-share-class aware).
  //   - Expense, risk, equity coverage, look-through geo / sector / top-10
  //     holdings via computeLiveXrayExtras (reduces current fund_snapshots +
  //     fund_allocations, same math as the picker).
  const [returns, extras] = await Promise.all([
    computeTrailingReturns(holdings),
    computeLiveXrayExtras(holdings),
  ]);
  const freshXray = {
    r1y: returns.ann_1y,
    r3y: returns.ann_3y,
    r5y: returns.ann_5y,
    r10y: returns.ann_10y,
    expense: extras.expense,
    risk: extras.risk,
    equityCoverage: extras.equityCoverage,
    geo: extras.geo,
    sector: extras.sector,
    holdings: extras.holdings,
  };
  const portfolioWithFreshReturns = { ...portfolio, xray_json: JSON.stringify(freshXray) };

  return (
    <div className="mx-auto w-full max-w-[1280px] px-10 py-10">
      <div className="flex items-center justify-between">
        <Link
          href={`/portfolios?platform=${portfolio.provider_slug}`}
          className="t-caption inline-flex items-center gap-1 text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
        >
          &larr; Back to Model Portfolios
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/api/factsheet/${portfolio.id}`}
            target="_blank"
            rel="noopener"
            className="t-caption inline-flex h-8 items-center gap-1.5 border border-[var(--color-hairline)] px-3 text-[var(--color-ink)] hover:border-[var(--color-ink)]"
          >
            Open fact sheet ↗
          </a>
          <a
            href={`/api/factsheet/${portfolio.id}?download=1&format=pdf`}
            className="t-caption inline-flex h-8 items-center gap-1.5 border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 text-[var(--color-canvas)] hover:bg-[var(--color-ink)]/90"
          >
            Download PDF ↓
          </a>
        </div>
      </div>
      <PortfolioDetail portfolio={portfolioWithFreshReturns} holdings={holdings} />
    </div>
  );
}

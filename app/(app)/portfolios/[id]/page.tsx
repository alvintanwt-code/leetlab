import Link from "next/link";
import { notFound } from "next/navigation";
import { PortfolioDetail } from "@/components/PortfolioDetail";
import {
  getConfirmedPortfolio,
  getPortfolioHoldings,
} from "@/lib/db/queries";
import { computeTrailingReturns } from "@/lib/factsheet/build";

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

  const holdings = await getPortfolioHoldings(portfolioId);

  // The stored xray_json was frozen at portfolio confirmation. Recompute the
  // trailing returns live from fund_snapshots with proxy-share-class fallback
  // so the page shows the same numbers as the fact sheet. Everything else on
  // the xray (risk, expense, geo, sector, holdings look-through) still comes
  // from the frozen snapshot for now.
  const returns = await computeTrailingReturns(holdings);
  const freshXray = (() => {
    try {
      const base = portfolio.xray_json ? JSON.parse(portfolio.xray_json) : {};
      return {
        ...base,
        r1y: returns.ann_1y,
        r3y: returns.ann_3y,
        r5y: returns.ann_5y,
        r10y: returns.ann_10y,
      };
    } catch {
      return { r1y: returns.ann_1y, r3y: returns.ann_3y, r5y: returns.ann_5y, r10y: returns.ann_10y };
    }
  })();
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
            href={`/api/factsheet/${portfolio.id}?download=1`}
            className="t-caption inline-flex h-8 items-center gap-1.5 border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 text-[var(--color-canvas)] hover:bg-[var(--color-ink)]/90"
          >
            Download ↓
          </a>
        </div>
      </div>
      <PortfolioDetail portfolio={portfolioWithFreshReturns} holdings={holdings} />
    </div>
  );
}

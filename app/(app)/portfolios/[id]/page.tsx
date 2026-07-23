import Link from "next/link";
import { notFound } from "next/navigation";
import { PortfolioDetail } from "@/components/PortfolioDetail";
import {
  getConfirmedPortfolio,
  getPortfolioHoldings,
} from "@/lib/db/queries";

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
      <PortfolioDetail portfolio={portfolio} holdings={holdings} />
    </div>
  );
}

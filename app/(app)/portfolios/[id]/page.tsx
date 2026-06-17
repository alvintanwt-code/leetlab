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
      <Link
        href="/portfolios"
        className="t-caption inline-flex items-center gap-1 text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
      >
        &larr; Back to Model Portfolios
      </Link>
      <PortfolioDetail portfolio={portfolio} holdings={holdings} allowDelete />
    </div>
  );
}

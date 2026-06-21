import { FundSwitchWorkspace, type FundOption } from "@/components/FundSwitchWorkspace";
import {
  getPortfolioHoldings,
  listConfirmedPortfolios,
  listFundsForPicker,
  listProvidersWithCounts,
} from "@/lib/db/queries";
import { computeAssetMix, computeRiskRating, parseXray } from "@/lib/portfolio-derive";
import { blendPortfolioSeries, blendPortfolioYield } from "@/lib/portfolio-performance";
import type { PortfolioCardData } from "@/components/PortfolioCard";

export const dynamic = "force-dynamic";

export default async function FundSwitchPage() {
  const [portfolios, providers] = await Promise.all([
    listConfirmedPortfolios(),
    listProvidersWithCounts(),
  ]);

  // Enrich each confirmed portfolio with the row-display data shared with
  // /portfolios — asset mix, risk, 3Y blended series, and (for income) yield.
  // Morningstar fetches go through the in-process cache so funds shared
  // across portfolios are only fetched once. Cold first load is slow; warm
  // loads are instant for 6h.
  const enrichedPortfolios: PortfolioCardData[] = await Promise.all(
    portfolios.map(async (portfolio) => {
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

  const fundsBySlug = await Promise.all(
    providers.map(async (p) => {
      const rows = await listFundsForPicker(p.slug);
      const options: FundOption[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        fund_house: r.fund_house,
        asset_class: r.asset_class,
        risk_rating: r.risk_rating,
      }));
      return [p.slug, options] as const;
    }),
  );
  const fundsByPlatform = Object.fromEntries(fundsBySlug);

  return (
    <FundSwitchWorkspace
      portfolios={enrichedPortfolios}
      providers={providers}
      fundsByPlatform={fundsByPlatform}
    />
  );
}

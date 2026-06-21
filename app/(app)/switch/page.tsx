import {
  FundSwitchWorkspace,
  type FundAllocations,
  type FundOption,
} from "@/components/FundSwitchWorkspace";
import {
  allocationsForProviderFunds,
  getPortfolioHoldings,
  listConfirmedPortfolios,
  listFundsForPicker,
  listProvidersWithCounts,
} from "@/lib/db/queries";
import { computeAssetMix, computeRiskRating, parseXray } from "@/lib/portfolio-derive";
import { blendPortfolioYield } from "@/lib/portfolio-performance";
import type { PortfolioCardData } from "@/components/PortfolioCard";

export const dynamic = "force-dynamic";

export default async function FundSwitchPage() {
  const [portfolios, providers] = await Promise.all([
    listConfirmedPortfolios(),
    listProvidersWithCounts(),
  ]);

  // Enrich each confirmed portfolio with the slim-row data: asset mix, risk,
  // KPIs from xrayJson, and (for income only) the trailing-12m yield via the
  // Morningstar blender. The /switch Target Model row doesn't render the
  // sparkline, so we skip blendPortfolioSeries entirely — saves ~5-10s on
  // cold load. /portfolios still does its own series blend.
  const enrichedPortfolios: PortfolioCardData[] = await Promise.all(
    portfolios.map(async (portfolio) => {
      const holdings = await getPortfolioHoldings(portfolio.id);
      const xray = parseXray(portfolio);
      const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;
      const isIncome = portfolio.category === "dividend_income";
      const yieldBlend = isIncome
        ? await blendPortfolioYield(
            holdings
              .filter((h) => !!h.isin)
              .map((h) => ({ isin: h.isin as string, weight: h.weight_bps / totalBps })),
          )
        : null;
      return {
        portfolio,
        assetMix: computeAssetMix(holdings),
        xray,
        risk: computeRiskRating(holdings, xray),
        series: null,
        yieldPct: yieldBlend ? yieldBlend.yieldPct : null,
      };
    }),
  );

  // Per-platform fund options + sector/geo allocations. The summary on the
  // /switch Client Portfolio side needs both — picker for the typeahead and
  // allocations to compute aggregated sector + geo exposure.
  const platformDataPairs = await Promise.all(
    providers.map(async (p) => {
      const [rows, allocs] = await Promise.all([
        listFundsForPicker(p.slug),
        allocationsForProviderFunds(p.slug),
      ]);
      const options: FundOption[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        isin: r.isin,
        fund_house: r.fund_house,
        asset_class: r.asset_class,
        risk_rating: r.risk_rating,
        expense_ratio: r.expense_ratio,
        ann_1y: r.ann_1y,
        ann_3y: r.ann_3y,
        ann_5y: r.ann_5y,
        ann_10y: r.ann_10y,
      }));
      const allocationsForPlatform: Record<number, FundAllocations> = {};
      for (const fundId of Object.keys(allocs)) {
        const id = Number(fundId);
        const sectorRaw = allocs[id].sector ?? [];
        const geoRaw = allocs[id].geography ?? [];
        allocationsForPlatform[id] = {
          sector: [...sectorRaw].sort((a, b) => b.weight_pct - a.weight_pct),
          geography: [...geoRaw].sort((a, b) => b.weight_pct - a.weight_pct),
        };
      }
      return [p.slug, options, allocationsForPlatform] as const;
    }),
  );
  const fundsByPlatform = Object.fromEntries(platformDataPairs.map(([slug, options]) => [slug, options]));
  const allocationsByPlatform = Object.fromEntries(
    platformDataPairs.map(([slug, , allocations]) => [slug, allocations]),
  );

  return (
    <FundSwitchWorkspace
      portfolios={enrichedPortfolios}
      providers={providers}
      fundsByPlatform={fundsByPlatform}
      allocationsByPlatform={allocationsByPlatform}
    />
  );
}

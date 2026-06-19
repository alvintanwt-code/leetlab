import { FundSwitchWorkspace, type FundOption } from "@/components/FundSwitchWorkspace";
import {
  listConfirmedPortfolios,
  listFundsForPicker,
  listProvidersWithCounts,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function FundSwitchPage() {
  const [portfolios, providers] = await Promise.all([
    listConfirmedPortfolios(),
    listProvidersWithCounts(),
  ]);

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
      portfolios={portfolios}
      providers={providers}
      fundsByPlatform={fundsByPlatform}
    />
  );
}

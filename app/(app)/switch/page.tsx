import { FundSwitchWorkspace } from "@/components/FundSwitchWorkspace";
import { listConfirmedPortfolios, listProvidersWithCounts } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function FundSwitchPage() {
  const [portfolios, providers] = await Promise.all([
    listConfirmedPortfolios(),
    listProvidersWithCounts(),
  ]);
  return <FundSwitchWorkspace portfolios={portfolios} providers={providers} />;
}

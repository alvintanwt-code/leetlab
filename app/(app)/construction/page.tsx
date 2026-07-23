import { redirect } from "next/navigation";
import { listProvidersWithCounts } from "@/lib/db/queries";

// Bare /construction resolves to the first provider's picker so the layout's
// unlock action has a valid post-unlock destination when the caller landed
// there without a specific provider slug.
export const dynamic = "force-dynamic";

export default async function ConstructionIndex() {
  const providers = await listProvidersWithCounts();
  const first = providers.find((p) => p.fund_count > 0);
  redirect(first ? `/construction/${first.slug}/picker` : "/portfolios");
}

import { notFound } from "next/navigation";
import {
  fundsInspectorForProvider,
  detailedAllocationsForProvider,
  listProvidersWithCounts,
} from "@/lib/db/queries";
import { BuildPicker } from "@/components/BuildPicker";

export const dynamic = "force-dynamic";

// Step-1 picker that lands in front of the existing StudioShell. Lets the
// advisor browse the full in-scope fund universe across all platforms, filter
// by asset class / region / dividend payers, and stage a selection. "Confirm
// build" then hands the selection to /construction/[provider] via
// sessionStorage so the existing builder pre-populates its basket.
export default async function PickerPage({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  const allProviders = await listProvidersWithCounts();
  const meta = allProviders.find((p) => p.slug === provider);
  if (!meta) notFound();

  const [funds, allocsFlat] = await Promise.all([
    fundsInspectorForProvider(provider),
    detailedAllocationsForProvider(provider),
  ]);

  // Canonical platform order + short labels shared with /portfolios and /switch.
  const PROVIDER_ORDER = ["hsbc", "fwd", "tmls", "gwm"];
  const SHORT_NAMES: Record<string, string> = {
    hsbc: "HSBC",
    fwd: "FWD",
    tmls: "TM",
    gwm: "GWM",
  };
  const providerTabs = allProviders
    .map((p) => ({
      slug: p.slug,
      short: SHORT_NAMES[p.slug] ?? p.name,
      count: p.fund_count,
      disabled: p.fund_count === 0,
    }))
    .sort((a, b) => PROVIDER_ORDER.indexOf(a.slug) - PROVIDER_ORDER.indexOf(b.slug));

  return (
    <BuildPicker
      providerSlug={provider}
      providerName={meta.name}
      providerTabs={providerTabs}
      funds={funds}
      allocations={allocsFlat}
    />
  );
}

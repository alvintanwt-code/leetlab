import { notFound } from "next/navigation";
import { StudioShell } from "@/components/StudioShell";
import {
  fundsInspectorForProvider,
  detailedAllocationsForProvider,
  documentsForProvider,
  listConfirmedPortfolios,
  listProvidersWithCounts,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  const allProviders = await listProvidersWithCounts();
  const meta = allProviders.find((p) => p.slug === provider);
  if (!meta) notFound();

  const [funds, allocsFlat, docsFlat, allConfirmed] = await Promise.all([
    fundsInspectorForProvider(provider),
    detailedAllocationsForProvider(provider),
    documentsForProvider(provider),
    listConfirmedPortfolios(),
  ]);
  const savedPortfolios = allConfirmed
    .filter((p) => p.provider_slug === provider)
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      version: p.version,
      confirmed_at: p.confirmed_at,
      holding_count: p.holding_count,
    }));

  // shape docs to { fundId: [{type, label}] }
  const documents: Record<number, { type: string; label: string }[]> = {};
  for (const d of docsFlat) {
    if (!documents[d.fund_id]) documents[d.fund_id] = [];
    documents[d.fund_id].push({ type: d.type, label: d.label });
  }

  if (funds.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-10 py-20 text-center">
        <p className="t-micro-cap mb-3">{meta.name}</p>
        <h1 className="t-display-md text-[var(--color-ink)]">No funds scraped yet for this provider.</h1>
        <p className="t-body-md mt-3 text-[var(--color-ink-mute)]">
          Adapter pending. Once the scraper for {meta.name} runs, instruments appear here.
        </p>
      </div>
    );
  }

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
    <StudioShell
      providerSlug={provider}
      providerName={meta.name}
      providerTabs={providerTabs}
      funds={funds}
      allocations={allocsFlat}
      documents={documents}
      savedPortfolios={savedPortfolios}
    />
  );
}

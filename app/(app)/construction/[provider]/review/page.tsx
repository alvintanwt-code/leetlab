import { notFound } from "next/navigation";
import {
  fundsInspectorForProvider,
  detailedAllocationsForProvider,
  listProvidersWithCounts,
} from "@/lib/db/queries";
import { BuildReview } from "@/components/BuildReview";

export const dynamic = "force-dynamic";

// Step-2 review page — sits between the picker and the full StudioShell save
// flow. Reads the picker's sessionStorage hand-off, blends an x-ray from the
// underlying funds + allocations and shows the instrument table + xray panels
// on a single page. Edit-inputs back link returns to the picker.
export default async function ReviewPage({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  const allProviders = await listProvidersWithCounts();
  const meta = allProviders.find((p) => p.slug === provider);
  if (!meta) notFound();

  const [funds, allocsFlat] = await Promise.all([
    fundsInspectorForProvider(provider),
    detailedAllocationsForProvider(provider),
  ]);

  return (
    <BuildReview
      providerSlug={provider}
      providerName={meta.name}
      funds={funds}
      allocations={allocsFlat}
    />
  );
}

import PortfolioBuilder from "@/components/PortfolioBuilder";
import { listFundsForPicker, allocationsForProviderFunds } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function BuilderPage() {
  // V1: hardcoded to HSBC. Provider switcher arrives once providers 2-4 exist.
  const [funds, allocations] = await Promise.all([
    listFundsForPicker("hsbc"),
    allocationsForProviderFunds("hsbc"),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-10 py-10">
      <header className="mb-8">
        <p className="t-micro-cap mb-2">Analysis · Build</p>
        <h1 className="t-display-md text-[var(--color-ink)]">Build a model portfolio</h1>
        <p className="t-body-md mt-2 text-[var(--color-ink-mute)]">
          Pick from HSBC Life Singapore. Set weights to 100%. X-ray on the right. Confirm to save the model.
        </p>
      </header>
      <PortfolioBuilder
        providerSlug="hsbc"
        providerName="HSBC Life Singapore"
        funds={funds}
        allocations={allocations}
      />
    </div>
  );
}

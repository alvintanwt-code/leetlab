export const dynamic = "force-dynamic";

export default function ResearchAndWritePage() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-20 pb-16">
      <div className="sticky top-0 z-20 -mx-20 mb-12 bg-[var(--color-canvas-soft)] px-20">
        <header className="border-b border-[var(--color-hairline-2)] py-6">
          <p className="t-micro-cap mb-1">leet research</p>
          <h1 className="t-h-md text-[var(--color-ink)]">Market Commentary</h1>
        </header>
      </div>

      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-12 text-center">
        <p className="t-micro-cap mb-3">Coming soon</p>
        <h2 className="t-h-lg mx-auto max-w-md text-[var(--color-ink)]">
          A writer agent that drafts in the house voice.
        </h2>
        <p className="t-body-md mx-auto mt-3 max-w-md text-[var(--color-ink-mute)]">
          Will pull from confirmed model portfolios, current market commentary, and the firm&rsquo;s
          investment philosophy doc. Drafts client letters, quarterly updates, and switch rationales
          ready for review.
        </p>
      </div>
    </div>
  );
}

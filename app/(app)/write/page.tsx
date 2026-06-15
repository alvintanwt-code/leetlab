export const dynamic = "force-dynamic";

export default function ResearchAndWritePage() {
  return (
    <div className="mx-auto w-full max-w-[920px] px-10 py-16">
      <p className="t-micro-cap mb-3">Leet Research</p>
      <h1 className="t-display-md text-[var(--color-ink)]">Research and Write</h1>
      <p className="t-body-md mt-3 text-[var(--color-ink-mute)]">
        A research-team workspace for drafting market commentary and switch rationales in the firm&rsquo;s house voice.
      </p>

      <div className="mt-10 rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-12 text-center">
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

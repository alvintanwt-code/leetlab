export const dynamic = "force-dynamic";

export default function FundSwitchPage() {
  return (
    <div className="mx-auto w-full max-w-[920px] px-10 py-16">
      <p className="t-micro-cap mb-3">Advisor workspace</p>
      <h1 className="t-display-md text-[var(--color-ink)]">Fund Switch Analysis</h1>
      <p className="t-body-md mt-3 text-[var(--color-ink-mute)]">
        Compare a client&rsquo;s current portfolio against a confirmed model and generate a switch
        rationale in the firm&rsquo;s house voice.
      </p>

      <div className="mt-10 rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas)] p-12 text-center">
        <p className="t-micro-cap mb-3">Coming soon</p>
        <h2 className="t-h-lg mx-auto max-w-md text-[var(--color-ink)]">
          Client portfolio in, narrative out.
        </h2>
        <p className="t-body-md mx-auto mt-3 max-w-md text-[var(--color-ink-mute)]">
          Paste a client portfolio (or upload a statement screenshot — vision parsing). Pick a target
          model from the saved portfolios. The app generates a thoughtful switch rationale — the
          conversation, not the trade.
        </p>
      </div>
    </div>
  );
}

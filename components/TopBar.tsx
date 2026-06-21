export function TopBar() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-hairline)] bg-[var(--color-canvas)] px-5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/leet-logo.png"
            alt=""
            width={20}
            height={20}
            className="block h-5 w-5 object-contain"
          />
        </span>
        <span className="t-body-md font-medium tracking-tight text-[var(--color-ink)]">
          lab.leet
        </span>
        <span className="ml-1 rounded bg-[var(--color-canvas-soft)] px-1.5 py-0.5 t-micro-cap">
          desk
        </span>
      </div>
    </header>
  );
}

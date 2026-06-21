export function TopBar() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-hairline)] bg-[var(--color-canvas)] px-5">
      <div className="flex items-center gap-2">
        <span className="block h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden />
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

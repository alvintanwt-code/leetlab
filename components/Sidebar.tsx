"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  meta?: string;
  disabled?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

export type SidebarCounts = { hsbcFunds: number; confirmedPortfolios: number };
export type SidebarUser = { name: string | null; email: string | null; image: string | null } | null;

function buildSections(counts: SidebarCounts): NavSection[] {
  return [
    {
      label: "Library",
      items: [
        { label: "HSBC Life Singapore", href: "/library/hsbc", meta: `${counts.hsbcFunds}` },
        { label: "Provider 02", href: "#", meta: "—", disabled: true },
        { label: "Provider 03", href: "#", meta: "—", disabled: true },
        { label: "Provider 04", href: "#", meta: "—", disabled: true },
      ],
    },
    {
      label: "Analysis",
      items: [
        { label: "Build portfolio", href: "/portfolio/build" },
        { label: "Confirmed portfolios", href: "/portfolio", meta: `${counts.confirmedPortfolios}` },
        { label: "Switch narratives", href: "/portfolio/narratives", disabled: true },
      ],
    },
  ];
}

function activeHref(pathname: string, sections: NavSection[]): string {
  // Pick the most-specific (longest) matching href so siblings under a shared prefix don't both light up.
  let bestHref = "";
  for (const s of sections) {
    for (const item of s.items) {
      if (item.disabled || item.href === "#") continue;
      const matches = pathname === item.href || pathname.startsWith(item.href + "/");
      if (matches && item.href.length > bestHref.length) bestHref = item.href;
    }
  }
  return bestHref;
}

export function Sidebar({ counts, user, signOutAction }: { counts: SidebarCounts; user: SidebarUser; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const sections = buildSections(counts);
  const winner = activeHref(pathname, sections);

  const initials = user?.name
    ? user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
    : (user?.email?.[0] ?? "?").toUpperCase();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="block h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden />
        <span className="t-h-md text-[var(--color-ink)]">leetlab</span>
        <span className="t-micro-cap ml-auto">desk</span>
      </div>

      <div className="hairline mx-5 h-px" />

      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {sections.map((section) => (
          <div key={section.label} className="mb-7">
            <p className="t-micro-cap px-3 pb-2">{section.label}</p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = !item.disabled && item.href !== "#" && item.href === winner;
                return (
                  <li key={item.label}>
                    <Link
                      href={item.disabled ? "#" : item.href}
                      aria-disabled={item.disabled}
                      tabIndex={item.disabled ? -1 : 0}
                      className={[
                        "group flex items-center justify-between rounded-md px-3 py-2 t-body-md transition-colors",
                        item.disabled
                          ? "pointer-events-none text-[var(--color-ink-mute)] opacity-55"
                          : active
                          ? "bg-[var(--color-canvas-soft)] text-[var(--color-ink)]"
                          : "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-2">
                        {active && (
                          <span
                            className="h-3.5 w-[2px] rounded-full bg-[var(--color-primary)]"
                            aria-hidden
                          />
                        )}
                        {item.label}
                      </span>
                      {item.meta && (
                        <span className="num text-[11px] text-[var(--color-ink-mute)]">
                          {item.meta}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="hairline mx-5 h-px" />
      {user ? (
        <form action={signOutAction} className="flex items-center gap-2 px-4 py-3">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="h-7 w-7 shrink-0 rounded-full" />
          ) : (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-bg)] text-[10px] font-medium text-[var(--color-primary-deep)]">
              {initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="t-caption truncate text-[var(--color-ink)]" title={user.name ?? ""}>
              {user.name ?? "Unnamed"}
            </p>
            <p className="t-micro truncate text-[var(--color-ink-mute)]" title={user.email ?? ""}>
              {user.email}
            </p>
          </div>
          <button
            type="submit"
            className="t-micro-cap text-[var(--color-ink-mute)] hover:text-[var(--color-negative)]"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between px-5 py-4 text-[var(--color-ink-mute)]">
          <span className="t-caption">Research desk</span>
          <span className="num text-[11px]">v0.1</span>
        </div>
      )}
    </aside>
  );
}

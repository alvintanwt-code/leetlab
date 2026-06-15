"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type SidebarProvider = { slug: string; short: string; count: number; disabled: boolean };
export type SidebarUser = { name: string | null; email: string | null; image: string | null };

function LockIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className="shrink-0 text-[var(--color-ink-mute)]"
    >
      <rect x="2.5" y="5.5" width="7" height="5" rx="0.6" stroke="currentColor" strokeWidth="0.9" />
      <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  );
}

export function LeftSidebar({
  defaultBuilderHref,
  user,
  signOutAction,
}: {
  defaultBuilderHref: string;
  user: SidebarUser;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isResearchWrite = pathname.startsWith("/write");
  const isBuilder = pathname.startsWith("/construction");
  const isModels = pathname.startsWith("/portfolios");
  const isSwitch = pathname.startsWith("/switch");

  const initials = user.name
    ? user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
    : (user.email?.[0] ?? "?").toUpperCase();

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <nav className="flex-1 overflow-y-auto px-2.5 py-4">
        <ul className="flex flex-col gap-0.5">
          <NavItem href="/write" label="Research and Write" active={isResearchWrite} locked />
          <NavItem href={defaultBuilderHref} label="Portfolio Builder" active={isBuilder} locked />
          <NavItem href="/portfolios" label="Model Portfolios" active={isModels} />
          <NavItem href="/switch" label="Fund Switch Analysis" active={isSwitch} />
        </ul>
      </nav>

      <div className="hairline mx-4 h-px" />
      <div className="relative px-2.5 py-2.5">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--color-canvas-soft)]"
          aria-label="Account menu"
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="h-6 w-6 shrink-0 rounded-full" />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-bg)] text-[10px] font-medium text-[var(--color-primary-deep)]">
              {initials}
            </span>
          )}
          <span className="min-w-0 flex-1 text-left">
            <span className="t-caption block truncate text-[var(--color-ink)]">{user.name ?? "Unnamed"}</span>
            <span className="t-micro block truncate text-[var(--color-ink-mute)]">{user.email}</span>
          </span>
        </button>
        {menuOpen && (
          <div
            className="absolute bottom-full left-3 right-3 mb-1 rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] py-1 shadow-[0_8px_24px_rgba(13,37,61,0.08)]"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <form action={signOutAction}>
              <button
                type="submit"
                className="w-full px-3 py-2 text-left t-body-md text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-negative)]"
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}

function NavItem({
  href,
  label,
  active,
  locked,
}: {
  href: string;
  label: string;
  active: boolean;
  locked?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={[
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 t-caption transition-colors",
          active
            ? "bg-[var(--color-canvas-soft)] text-[var(--color-ink)]"
            : "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]",
        ].join(" ")}
      >
        {active && (
          <span className="h-3 w-[2px] rounded-full bg-[var(--color-primary)]" aria-hidden />
        )}
        <span className="flex-1">{label}</span>
        {locked && <LockIcon />}
      </Link>
    </li>
  );
}

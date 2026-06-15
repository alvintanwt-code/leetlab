"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type SidebarProvider = { slug: string; short: string; count: number; disabled: boolean };
export type SidebarUser = { name: string | null; email: string | null; image: string | null };

export function LeftSidebar({
  providers,
  confirmedCount,
  user,
  signOutAction,
}: {
  providers: SidebarProvider[];
  confirmedCount: number;
  user: SidebarUser;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isResearchWrite = pathname.startsWith("/write");
  const isConstruction = pathname.startsWith("/construction") || pathname === "/portfolios";
  const isSwitch = pathname.startsWith("/switch");
  const activeProvider = pathname.startsWith("/construction/")
    ? pathname.split("/")[2] ?? ""
    : "";

  const initials = user.name
    ? user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
    : (user.email?.[0] ?? "?").toUpperCase();

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <nav className="flex-1 overflow-y-auto px-2.5 py-4">
        {/* LEET RESEARCH section */}
        <div className="mb-5">
          <div className="flex items-center justify-between px-2.5 pb-1.5">
            <p className="t-micro-cap">Leet Research</p>
            <span
              className="t-micro-cap text-[10px] text-[var(--color-ink-mute)]"
              title="Internal: research team only"
            >
              · locked
            </span>
          </div>
          <ul className="flex flex-col gap-0.5">
            <NavItem href="/write" label="Research and Write" active={isResearchWrite} muted />
            <li>
              <div
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 t-caption ${
                  isConstruction ? "text-[var(--color-ink)]" : "text-[var(--color-ink-2)]"
                }`}
              >
                <span className="flex items-center gap-2">
                  {isConstruction && (
                    <span
                      className="h-3 w-[2px] rounded-full bg-[var(--color-primary)]"
                      aria-hidden
                    />
                  )}
                  Portfolio Construction
                </span>
              </div>
              <ul className="ml-3 mt-1 flex flex-col gap-0.5 border-l border-[var(--color-hairline-2)] pl-2">
                {providers.map((p) => {
                  const active = activeProvider === p.slug;
                  if (p.disabled) {
                    return (
                      <li key={p.slug}>
                        <span
                          aria-disabled="true"
                          className="flex items-center justify-between rounded-md px-2.5 py-1 t-caption text-[var(--color-ink-mute)] opacity-55"
                        >
                          {p.short}
                          <span className="num text-[10px]">—</span>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={p.slug}>
                      <Link
                        href={`/construction/${p.slug}`}
                        className={[
                          "flex items-center justify-between rounded-md px-2.5 py-1 t-caption transition-colors",
                          active
                            ? "bg-[var(--color-canvas-soft)] text-[var(--color-ink)]"
                            : "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]",
                        ].join(" ")}
                      >
                        {p.short}
                        <span className="num text-[10px] text-[var(--color-ink-mute)]">{p.count}</span>
                      </Link>
                    </li>
                  );
                })}
                <li className="my-1 border-t border-[var(--color-hairline-2)]" />
                <li>
                  <Link
                    href="/portfolios"
                    className={[
                      "flex items-center justify-between rounded-md px-2.5 py-1 t-caption transition-colors",
                      pathname === "/portfolios"
                        ? "bg-[var(--color-canvas-soft)] text-[var(--color-ink)]"
                        : "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]",
                    ].join(" ")}
                  >
                    Saved portfolios
                    <span className="num text-[10px] text-[var(--color-ink-mute)]">{confirmedCount}</span>
                  </Link>
                </li>
              </ul>
            </li>
          </ul>
        </div>

        {/* divider */}
        <div className="hairline my-3 mx-2.5 h-px" />

        {/* Switch analysis standalone */}
        <ul className="flex flex-col gap-0.5">
          <NavItem href="/switch" label="Fund Switch Analysis" active={isSwitch} muted />
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

function NavItem({ href, label, active, muted }: { href: string; label: string; active: boolean; muted?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        className={[
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 t-caption transition-colors",
          active
            ? "bg-[var(--color-canvas-soft)] text-[var(--color-ink)]"
            : muted
            ? "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
            : "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]",
        ].join(" ")}
      >
        {active && (
          <span className="h-3 w-[2px] rounded-full bg-[var(--color-primary)]" aria-hidden />
        )}
        {label}
      </Link>
    </li>
  );
}

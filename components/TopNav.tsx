"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type TopNavProvider = { slug: string; name: string; short: string; count: number; disabled: boolean };
export type TopNavUser = { name: string | null; email: string | null; image: string | null };

export function TopNav({
  providers,
  user,
  confirmedCount,
  signOutAction,
}: {
  providers: TopNavProvider[];
  user: TopNavUser;
  confirmedCount: number;
  signOutAction: () => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const activeSlug = pathname.startsWith("/studio/") ? pathname.split("/")[2] ?? "" : "";

  const initials = user.name
    ? user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
    : (user.email?.[0] ?? "?").toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-hairline)] bg-[var(--color-canvas)]">
      <div className="flex items-center gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="block h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden />
          <span className="t-h-md text-[var(--color-ink)]">leetlab</span>
        </Link>
        <span className="text-[var(--color-ink-mute)]">/</span>
        <span className="t-micro-cap">Model Portfolio Studio</span>

        <nav className="ml-auto flex items-center gap-3">
          <Link
            href="/portfolios"
            className="flex items-center gap-2 rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] px-3 py-1.5 t-caption text-[var(--color-ink)] hover:bg-[var(--color-canvas)]"
          >
            Confirmed portfolios
            <span className="num text-[var(--color-ink-mute)]">{confirmedCount}</span>
          </Link>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--color-canvas-soft)]"
              aria-label="Account menu"
            >
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="h-7 w-7 rounded-full" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-primary-bg)] text-[10px] font-medium text-[var(--color-primary-deep)]">
                  {initials}
                </span>
              )}
              <span className="hidden md:flex md:flex-col md:items-start">
                <span className="t-caption text-[var(--color-ink)]">{user.name ?? "Unnamed"}</span>
                <span className="t-micro text-[var(--color-ink-mute)]">{user.email}</span>
              </span>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-52 rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] py-1 shadow-[0_8px_24px_rgba(13,37,61,0.08)]"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <div className="px-3 py-2">
                  <p className="t-caption text-[var(--color-ink)] truncate">{user.name ?? "Unnamed"}</p>
                  <p className="t-micro text-[var(--color-ink-mute)] truncate">{user.email}</p>
                </div>
                <div className="hairline mx-2 h-px" />
                <form action={signOutAction}>
                  <button type="submit" className="w-full px-3 py-2 text-left t-body-md text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-negative)]">
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </nav>
      </div>

      <div className="flex items-center gap-1 px-6">
        {providers.map((p) => {
          const active = p.slug === activeSlug;
          if (p.disabled) {
            return (
              <span
                key={p.slug}
                aria-disabled="true"
                className="flex items-center gap-2 border-b-2 border-transparent px-4 py-2.5 t-body-md text-[var(--color-ink-mute)] opacity-55"
                title="Adapter pending"
              >
                {p.short}
                <span className="num text-[11px] text-[var(--color-ink-mute)]">—</span>
              </span>
            );
          }
          return (
            <Link
              key={p.slug}
              href={`/studio/${p.slug}`}
              className={[
                "flex items-center gap-2 border-b-2 px-4 py-2.5 t-body-md transition-colors",
                active
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]",
              ].join(" ")}
            >
              {p.short}
              <span
                className={[
                  "num rounded-full px-1.5 py-px text-[10px]",
                  active
                    ? "bg-[var(--color-primary-bg)] text-[var(--color-primary-deep)]"
                    : "bg-[var(--color-canvas-soft)] text-[var(--color-ink-mute)]",
                ].join(" ")}
              >
                {p.count}
              </span>
            </Link>
          );
        })}
      </div>
    </header>
  );
}

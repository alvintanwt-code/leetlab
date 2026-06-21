"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export type SidebarProvider = { slug: string; short: string; count: number; disabled: boolean };
export type SidebarUser = { name: string | null; email: string | null; image: string | null };

// ---------------- icons ----------------
// Hairline outline icons (16×16 viewBox, stroke 1.3) to match the editorial
// chrome elsewhere. Each renders at 14px in the nav so it sits cleanly next
// to the t-caption row.

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 13.5 L4 11l6.5-6.5 2.5 2.5L6.5 13.5l-2.5.5-1.5-.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.5 5L11 6.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function BlocksIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 13.5h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="3.5" y="8" width="2" height="5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="7" y="5" width="2" height="8" stroke="currentColor" strokeWidth="1.2" />
      <rect x="10.5" y="9.5" width="2" height="3.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 5.5h9 M9.5 3l2.5 2.5L9.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 10.5H4 M6.5 13L4 10.5L6.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden className="shrink-0 text-[var(--color-ink-mute)]">
      <rect x="2.5" y="5.5" width="7" height="5" rx="0.6" stroke="currentColor" strokeWidth="0.9" />
      <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={collapsed ? "M6 4l4 4-4 4" : "M10 4l-4 4 4 4"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------- sidebar ----------------

const COLLAPSE_KEY = "sidebar:collapsed:v1";

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
  // Start expanded for SSR parity; hydrate from localStorage on mount.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw === "1") setCollapsed(true);
    } catch {
      // storage blocked — keep expanded
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  const isResearchWrite = pathname.startsWith("/write");
  const isBuilder = pathname.startsWith("/construction");
  const isModels = pathname.startsWith("/portfolios");
  const isSwitch = pathname.startsWith("/switch");

  const initials = user.name
    ? user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
    : (user.email?.[0] ?? "?").toUpperCase();

  return (
    <aside
      className={[
        "flex h-full shrink-0 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-canvas)] transition-[width] duration-150",
        collapsed ? "w-[56px]" : "w-[10vw] min-w-[152px]",
      ].join(" ")}
    >
      <div className={`flex ${collapsed ? "justify-center" : "justify-end"} px-2 pt-3 pb-3`}>
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-ink-mute)] transition-colors hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
      </div>

      <div className="hairline mx-3 h-px" />

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          <NavItem href="/write" label="Write" icon={<PencilIcon />} active={isResearchWrite} locked collapsed={collapsed} />
          <NavItem href={defaultBuilderHref} label="Build" icon={<BlocksIcon />} active={isBuilder} locked collapsed={collapsed} />
          <NavItem href="/portfolios?view=all" label="Model portfolio" icon={<ChartIcon />} active={isModels} collapsed={collapsed} />
          <NavItem href="/switch" label="Fund switch" icon={<SwapIcon />} active={isSwitch} collapsed={collapsed} />
        </ul>
      </nav>

      <div className="hairline mx-3 h-px" />
      <div className="relative px-2 py-2.5">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={[
            "flex w-full items-center rounded-md py-1.5 hover:bg-[var(--color-canvas-soft)]",
            collapsed ? "justify-center px-1" : "gap-2 px-2",
          ].join(" ")}
          aria-label="Account menu"
          title={collapsed ? (user.name ?? user.email ?? "Account") : undefined}
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="h-6 w-6 shrink-0 rounded-full" />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-bg)] text-[10px] font-medium text-[var(--color-primary-deep)]">
              {initials}
            </span>
          )}
          {!collapsed && (
            <span className="min-w-0 flex-1 text-left">
              <span className="t-caption block truncate text-[var(--color-ink)]">{user.name ?? "Unnamed"}</span>
              <span className="t-micro block truncate text-[var(--color-ink-mute)]">{user.email}</span>
            </span>
          )}
        </button>
        {menuOpen && (
          <div
            className={[
              "absolute bottom-full mb-1 rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] py-1 shadow-[0_8px_24px_rgba(13,37,61,0.08)]",
              collapsed ? "left-full ml-2 w-[160px]" : "left-3 right-3",
            ].join(" ")}
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
  icon,
  active,
  locked,
  collapsed,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  locked?: boolean;
  collapsed: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        title={collapsed ? label : undefined}
        className={[
          "relative flex items-center rounded-md t-caption transition-colors",
          collapsed ? "justify-center px-2 py-2" : "gap-2 px-2 py-1.5",
          active
            ? "bg-[var(--color-canvas-soft)] text-[var(--color-ink)]"
            : "text-[var(--color-ink-2)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]",
        ].join(" ")}
      >
        {active && (
          <span
            className={`absolute h-3 w-[2px] rounded-full bg-[var(--color-primary)] ${
              collapsed ? "left-0.5" : "left-0"
            }`}
            aria-hidden
          />
        )}
        <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center text-[var(--color-ink-mute)]">
          {icon}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
            {locked && <LockIcon />}
          </>
        )}
      </Link>
    </li>
  );
}

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

// Soft password gate on top of the existing Google OAuth. Read once, set a
// cookie, unlock the whole /construction/* subtree for the session. Anyone
// who reaches this layout has already passed Google auth via the (app)
// group's middleware, so this is a second factor for portfolio-builder
// access, not primary security.

const COOKIE_NAME = "builder_unlocked";
// Hardcoded on purpose — this is an internal advisor tool with a small user
// pool, and the primary auth (Google OAuth) already gates the whole app. This
// gate is a per-role speed bump, not real security; rotating it means one
// commit + push, no infra.
const BUILDER_PASSWORD = "leet1337";

async function unlockAction(formData: FormData) {
  "use server";
  const attempt = String(formData.get("password") ?? "").trim();
  const expected = BUILDER_PASSWORD;
  const next = String(formData.get("next") ?? "/construction").trim() || "/construction";
  // Only allow same-origin construction URLs to avoid open-redirect surprises.
  const safeNext = next.startsWith("/construction") ? next : "/construction";
  if (!expected || attempt !== expected) {
    // Bounce back to the original path with an error flag so the caller can
    // re-enter without losing which fund picker they were trying to open.
    const sep = safeNext.includes("?") ? "&" : "?";
    redirect(`${safeNext}${sep}err=1`);
  }
  const jar = await cookies();
  jar.set(COOKIE_NAME, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // 12h session — long enough for a day's work, short enough to re-prompt
    // if someone leaves the tab open overnight.
    maxAge: 60 * 60 * 12,
    path: "/construction",
  });
  redirect(safeNext);
}

export default async function ConstructionLayout({
  children,
  searchParams,
}: {
  children: React.ReactNode;
  searchParams?: Promise<{ err?: string }>;
}) {
  const jar = await cookies();
  const unlocked = jar.get(COOKIE_NAME)?.value === "1";
  if (unlocked) return <>{children}</>;

  const sp = (await searchParams) ?? {};
  const showError = sp.err === "1";
  // Preserve where the caller was heading so unlock returns them there.
  const hdrs = await headers();
  const originalPath = hdrs.get("x-invoke-path") ?? hdrs.get("next-url") ?? "/construction";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] items-center justify-center px-20 py-16">
      <div className="w-full max-w-[420px] border border-[var(--color-hairline-2)] bg-[var(--color-canvas)] p-8">
        <p className="t-micro-cap mb-2">Advisor workspace</p>
        <h1 className="t-h-md text-[var(--color-ink)] mb-1">Portfolio Builder</h1>
        <p className="t-body-md text-[var(--color-ink-mute)] mb-6">
          Restricted. Enter the builder password to open the screener.
        </p>

        <form action={unlockAction} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={originalPath} />
          <label className="flex flex-col gap-1.5">
            <span className="t-caption text-[var(--color-ink-mute)]">Password</span>
            <input
              type="password"
              name="password"
              autoFocus
              required
              autoComplete="current-password"
              className="h-10 border border-[var(--color-hairline)] bg-transparent px-3 t-body-md text-[var(--color-ink)] focus:border-[var(--color-ink)] focus:outline-none"
            />
          </label>
          {showError && (
            <p className="t-caption text-[var(--color-negative)]">Incorrect password.</p>
          )}
          <button
            type="submit"
            className="mt-2 h-10 border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 t-caption text-[var(--color-canvas)] hover:bg-[var(--color-ink)]/90"
          >
            Unlock
          </button>
        </form>

        <p className="t-caption text-[var(--color-ink-mute)] mt-6 border-t border-[var(--color-hairline-2)] pt-4">
          Session unlocks the builder for 12 hours on this browser.
        </p>
      </div>
    </div>
  );
}

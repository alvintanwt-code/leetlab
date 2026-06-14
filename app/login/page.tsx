import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { callbackUrl } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas-soft)] p-6">
      <div className="w-full max-w-md rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-10 text-center">
        <div className="mx-auto mb-6 flex items-center justify-center gap-2">
          <span className="block h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden />
          <span className="t-h-md text-[var(--color-ink)]">leetlab</span>
        </div>
        <p className="t-micro-cap mb-2">Research desk</p>
        <h1 className="t-display-md text-[var(--color-ink)]">Sign in to continue.</h1>
        <p className="t-body-md mx-auto mt-3 max-w-sm text-[var(--color-ink-mute)]">
          Use your team Google account. Sessions are stored on Neon Postgres alongside the model portfolio audit trail.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl ?? "/" });
          }}
          className="mt-8"
        >
          <button type="submit" className="btn-pill btn-primary w-full justify-center">
            Sign in with Google
          </button>
        </form>

        <p className="t-caption mt-6 text-[var(--color-ink-mute)]">
          Internal research tool. Access is restricted to authorised team members.
        </p>
      </div>
    </div>
  );
}

import { LeftSidebar } from "@/components/LeftSidebar";
import { TopBar } from "@/components/TopBar";
import { listProvidersWithCounts } from "@/lib/db/queries";
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Portfolio Builder needs a default destination — pick the first provider
  // that actually has funds. Falls back to /portfolios if no provider is ready.
  const rawProviders = await listProvidersWithCounts();
  const firstReady = rawProviders.find((p) => p.fund_count > 0);
  const defaultBuilderHref = firstReady ? `/construction/${firstReady.slug}` : "/portfolios";

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--color-canvas-soft)]">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <LeftSidebar
          defaultBuilderHref={defaultBuilderHref}
          user={{
            name: session.user.name ?? null,
            email: session.user.email ?? null,
            image: session.user.image ?? null,
          }}
          signOutAction={signOutAction}
        />
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

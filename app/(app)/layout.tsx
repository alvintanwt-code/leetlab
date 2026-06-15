import { TopNav, type TopNavProvider } from "@/components/TopNav";
import { listProvidersWithCounts, countAllConfirmedPortfolios } from "@/lib/db/queries";
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const SHORT_NAMES: Record<string, string> = {
  hsbc: "HSBC Life",
  tmls: "Tokio Marine",
  fwd: "FWD",
  gwm: "GWM",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [rawProviders, confirmedCount] = await Promise.all([
    listProvidersWithCounts(),
    countAllConfirmedPortfolios(),
  ]);

  const providers: TopNavProvider[] = rawProviders.map((p) => ({
    slug: p.slug,
    name: p.name,
    short: SHORT_NAMES[p.slug] ?? p.name,
    count: p.fund_count,
    disabled: p.fund_count === 0,
  }));

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-canvas-soft)]">
      <TopNav
        providers={providers}
        confirmedCount={confirmedCount}
        user={{
          name: session.user.name ?? null,
          email: session.user.email ?? null,
          image: session.user.image ?? null,
        }}
        signOutAction={signOutAction}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}

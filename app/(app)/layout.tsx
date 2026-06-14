import { Sidebar } from "@/components/Sidebar";
import { providerStats, countAllConfirmedPortfolios } from "@/lib/db/queries";
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [{ fundCount: hsbcFunds }, confirmedPortfolios] = await Promise.all([
    providerStats("hsbc"),
    countAllConfirmedPortfolios(),
  ]);

  const sidebarUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
  };

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-canvas-soft)]">
      <Sidebar
        counts={{ hsbcFunds, confirmedPortfolios }}
        user={sidebarUser}
        signOutAction={signOutAction}
      />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

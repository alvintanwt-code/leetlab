import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { modelPortfolios } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { id } = await params;
  const portfolioId = parseInt(id, 10);
  if (!Number.isFinite(portfolioId)) {
    return NextResponse.json({ error: "Invalid portfolio id" }, { status: 400 });
  }

  // model_portfolio_holdings.portfolio_id has ON DELETE CASCADE, so a single
  // DELETE on the parent row removes the basket too.
  const deleted = await db()
    .delete(modelPortfolios)
    .where(eq(modelPortfolios.id, portfolioId))
    .returning({ id: modelPortfolios.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

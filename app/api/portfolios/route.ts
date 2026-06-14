import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { providers, modelPortfolios, modelPortfolioHoldings } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { auth } from "@/auth";

const Body = z.object({
  providerSlug: z.string(),
  category: z.enum(["conservative", "balanced", "growth", "aggressive", "dividend_income"]),
  name: z.string().min(1).max(120),
  notes: z.string().max(2000).nullable().optional(),
  holdings: z.array(z.object({ fundId: z.number().int().positive(), weightBps: z.number().int().min(0).max(10000) })).min(1),
  xray: z.unknown().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const total = parsed.holdings.reduce((s, h) => s + h.weightBps, 0);
  if (total !== 10000) {
    return NextResponse.json({ error: `Weights must total 100% (got ${(total / 100).toFixed(2)}%)` }, { status: 400 });
  }

  const providerRows = await db()
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.slug, parsed.providerSlug))
    .limit(1);
  const provider = providerRows[0];
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const versionRows = await db().execute(sql`
    SELECT COALESCE(MAX(version), 0)::int AS v
    FROM model_portfolios
    WHERE provider_id = ${provider.id} AND category = ${parsed.category} AND name = ${parsed.name}
  `) as unknown as { v: number }[];
  const version = (versionRows[0]?.v ?? 0) + 1;

  const inserted = await db()
    .insert(modelPortfolios)
    .values({
      providerId: provider.id,
      category: parsed.category,
      name: parsed.name,
      version,
      status: "confirmed",
      notes: parsed.notes ?? null,
      xrayJson: parsed.xray ? JSON.stringify(parsed.xray) : null,
      createdBy: session.user.id,
      confirmedBy: session.user.id,
      confirmedAt: new Date(),
    })
    .returning({ id: modelPortfolios.id });
  const portfolioId = inserted[0].id;

  await db()
    .insert(modelPortfolioHoldings)
    .values(parsed.holdings.map((h) => ({ portfolioId, fundId: h.fundId, weightBps: h.weightBps })));

  return NextResponse.json({ id: portfolioId, version });
}

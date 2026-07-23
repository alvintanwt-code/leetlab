import { NextRequest, NextResponse } from "next/server";
import {
  insertFactsheet,
  listConfirmedPortfolioIds,
} from "@/lib/db/queries";
import { buildFactsheetForPortfolio, previousMonthEnd, monthKey } from "@/lib/factsheet/build";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/factsheets/generate
 *   ?month=YYYY-MM   — override target month (defaults to previous full month)
 *   ?force=1         — allow overwrite of an existing archive row for that
 *                      month; otherwise archive rows are immutable
 *
 * Called by Vercel Cron at 09:00 SGT on the 4th of every month. Iterates
 * every confirmed model portfolio and inserts one archived fact-sheet row
 * per portfolio into portfolio_factsheets, keyed by (portfolio_id, month).
 *
 * The 4th (not the 1st) gives Morningstar 3 clear days to publish the
 * month-end NAV series across the underlying fund universe.
 *
 * Auth: Vercel Cron includes `Authorization: Bearer $CRON_SECRET`.
 * When CRON_SECRET is unset locally the endpoint is unauthenticated
 * so it can be triggered from the dev machine for one-off freezes.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
  }

  const monthParam = req.nextUrl.searchParams.get("month");
  const force = req.nextUrl.searchParams.get("force") === "1";
  const asOfMonth = monthParam ? new Date(monthParam + "-15T00:00:00Z") : previousMonthEnd();
  const targetKey = monthKey(asOfMonth);

  const portfolios = await listConfirmedPortfolioIds();
  const results: Array<{ id: number; slug: string; name: string; status: string; asOf?: string }> = [];

  for (const p of portfolios) {
    try {
      const built = await buildFactsheetForPortfolio(p.id, asOfMonth);
      if (!built) {
        results.push({ ...p, status: "skipped:no-portfolio" });
        continue;
      }
      const write = await insertFactsheet(p.id, built.asOfMonthKey, built.html);
      if (write.inserted) {
        results.push({ ...p, asOf: built.asOfMonthKey, status: "archived" });
      } else if (force) {
        // Existing row for that month; blow it away and re-insert.
        // Use a dedicated helper to keep the queries file the sole DB touchpoint.
        const { neon } = await import("@neondatabase/serverless");
        const sql = neon(process.env.DATABASE_URL!);
        await sql`DELETE FROM portfolio_factsheets WHERE portfolio_id = ${p.id} AND as_of_month = ${built.asOfMonthKey}`;
        await insertFactsheet(p.id, built.asOfMonthKey, built.html);
        results.push({ ...p, asOf: built.asOfMonthKey, status: "re-archived" });
      } else {
        results.push({ ...p, asOf: built.asOfMonthKey, status: "already-archived" });
      }
    } catch (e) {
      results.push({ ...p, status: `error:${(e as Error).message.slice(0, 80)}` });
    }
  }

  return NextResponse.json({
    ok: true,
    targetMonth: targetKey,
    portfolios: results.length,
    results,
  });
}

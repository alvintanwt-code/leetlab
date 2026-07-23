import { NextRequest, NextResponse } from "next/server";
import {
  getConfirmedPortfolio,
  getFactsheetByMonth,
  getLatestFactsheet,
} from "@/lib/db/queries";
import { buildFactsheetForPortfolio } from "@/lib/factsheet/build";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/factsheet/:id
 *   ?download=1        — force browser download instead of inline render
 *   ?month=YYYY-MM     — serve a specific archived month
 *
 * Resolution order:
 *   1. If ?month=YYYY-MM is given, serve that archived row or 404.
 *   2. Otherwise serve the LATEST archived row for this portfolio.
 *   3. If no archive exists yet (portfolio is fresh, or cron hasn't run),
 *      render live for the previous full month as a preview.
 *
 * Once the monthly cron (/api/factsheets/generate) has landed for the
 * new month, this endpoint automatically starts serving that newer row —
 * the display and download URL stay stable, the underlying content rolls
 * forward.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: rawId } = await ctx.params;
  const portfolioId = parseInt(rawId, 10);
  if (!Number.isFinite(portfolioId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const portfolio = await getConfirmedPortfolio(portfolioId);
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const monthParam = req.nextUrl.searchParams.get("month");
  const download = req.nextUrl.searchParams.get("download") === "1";

  let html: string | null = null;
  let asOfMonthKey: string | null = null;

  if (monthParam) {
    const row = await getFactsheetByMonth(portfolioId, monthParam);
    if (!row) return NextResponse.json({ error: "no archive for that month" }, { status: 404 });
    html = row.html_content;
    asOfMonthKey = row.as_of_month;
  } else {
    const latest = await getLatestFactsheet(portfolioId);
    if (latest) {
      html = latest.html_content;
      asOfMonthKey = latest.as_of_month;
    } else {
      // Fallback: nothing archived yet — render live for last full month.
      const built = await buildFactsheetForPortfolio(portfolioId);
      if (!built) return NextResponse.json({ error: "render failed" }, { status: 500 });
      html = built.html;
      asOfMonthKey = built.asOfMonthKey;
    }
  }

  const filename = `factsheet-${portfolio.provider_slug}-${portfolio.category}-${asOfMonthKey}.html`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

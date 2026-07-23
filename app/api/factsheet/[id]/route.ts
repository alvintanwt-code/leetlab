import { NextRequest, NextResponse } from "next/server";
import {
  getConfirmedPortfolio,
  getFactsheetByMonth,
  getLatestFactsheet,
} from "@/lib/db/queries";
import { buildFactsheetForPortfolio } from "@/lib/factsheet/build";
import { htmlToPdf } from "@/lib/factsheet/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PDF generation needs Chromium headroom on Vercel — 60s covers cold-start
// binary decompression + first render.
export const maxDuration = 60;

/**
 * GET /api/factsheet/:id
 *   ?download=1        — force browser download instead of inline render
 *   ?month=YYYY-MM     — serve a specific archived month
 *   ?format=pdf        — render the archived HTML to PDF server-side via
 *                        headless Chromium and return application/pdf.
 *                        Without this flag the endpoint returns the raw
 *                        HTML the browser will Cmd+P print anyway.
 *
 * Resolution order (HTML source):
 *   1. If ?month=YYYY-MM is given, use that archived row or 404.
 *   2. Otherwise use the LATEST archived row for this portfolio.
 *   3. If no archive exists yet (portfolio is fresh, or cron hasn't run),
 *      render live for the previous full month as a preview.
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
  const format = req.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "html";

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

  const stem = `factsheet-${portfolio.provider_slug}-${portfolio.category}-${asOfMonthKey}`;

  if (format === "pdf") {
    try {
      const pdf = await htmlToPdf(html);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${stem}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return NextResponse.json({ error: "pdf render failed", detail: (e as Error).message }, { status: 500 });
    }
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${stem}.html"`,
      "Cache-Control": "no-store",
    },
  });
}

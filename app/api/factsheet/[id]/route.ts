import { NextRequest, NextResponse } from "next/server";
import { getConfirmedPortfolio, getPortfolioHoldings } from "@/lib/db/queries";
import { parseXray } from "@/lib/portfolio-derive";
import { blendPortfolioSeries } from "@/lib/portfolio-performance";
import { renderFactsheetHtml } from "@/lib/factsheet/render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/factsheet/:id
 *   ?download=1  — force browser download instead of inline render
 *
 * Renders the two-page Global Alpha fact sheet for a specific confirmed model
 * portfolio using live database + Morningstar data. Everything the template
 * needs is derived here (weighted YTD / trailing / stddev / expense, blended
 * growth-of-100k series) then passed to lib/factsheet/render.ts, which owns
 * the SKILL brand system markup.
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

  const holdings = await getPortfolioHoldings(portfolioId);
  const xray = parseXray(portfolio);

  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;
  const components = holdings
    .filter((h) => !!h.isin)
    .map((h) => ({ isin: h.isin as string, weight: h.weight_bps / totalBps }));

  const series = await blendPortfolioSeries(components, 120);

  // Weighted trailing figures — YTD from fund_snapshots.ytd (Morningstar M0),
  // 1Y/3Y/5Y from xray (already weighted at portfolio-build time).
  const weight = (h: typeof holdings[number]) => h.weight_bps / totalBps;
  const weightedYtd = holdings.reduce((s, h) => {
    return h.ytd == null ? s : s + weight(h) * h.ytd;
  }, 0);
  const weightedStddev3y = holdings.reduce((s, h) => {
    return h.stddev_3y == null ? s : s + weight(h) * h.stddev_3y;
  }, 0);

  const asOfMonth = (() => {
    const d = new Date();
    // Report on last completed month-end. e.g. 23 Jul → June 2026.
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d;
  })();

  const html = renderFactsheetHtml({
    portfolio,
    holdings,
    xray,
    series,
    weightedYtd: Number.isFinite(weightedYtd) ? weightedYtd : null,
    weightedStddev3y: Number.isFinite(weightedStddev3y) ? weightedStddev3y : null,
    asOfMonth,
  });

  const filename = `factsheet-${portfolio.provider_slug}-${portfolio.category}-${asOfMonth
    .toISOString()
    .slice(0, 7)}.html`;
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

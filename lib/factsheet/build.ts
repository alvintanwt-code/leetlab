// Shared entry point that turns a portfolioId (+ target month) into the
// finished fact-sheet HTML. Used by both the on-demand route and the
// monthly cron.

import { getConfirmedPortfolio, getPortfolioHoldings, type ConfirmedPortfolio } from "@/lib/db/queries";
import { parseXray } from "@/lib/portfolio-derive";
import { blendPortfolioSeries } from "@/lib/portfolio-performance";
import { renderFactsheetHtml } from "./render";

export function previousMonthEnd(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d;
}

export function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export type BuildResult = {
  portfolio: ConfirmedPortfolio;
  asOfMonthKey: string; // YYYY-MM
  html: string;
};

export async function buildFactsheetForPortfolio(portfolioId: number, asOfMonth?: Date): Promise<BuildResult | null> {
  const portfolio = await getConfirmedPortfolio(portfolioId);
  if (!portfolio) return null;

  const holdings = await getPortfolioHoldings(portfolioId);
  const xray = parseXray(portfolio);

  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;
  const components = holdings
    .filter((h) => !!h.isin)
    .map((h) => ({ isin: h.isin as string, weight: h.weight_bps / totalBps }));

  const series = await blendPortfolioSeries(components, 120);

  const weightedYtd = holdings.reduce((s, h) => (h.ytd == null ? s : s + (h.weight_bps / totalBps) * h.ytd), 0);
  const weightedStddev3y = holdings.reduce((s, h) => (h.stddev_3y == null ? s : s + (h.weight_bps / totalBps) * h.stddev_3y), 0);

  const asOf = asOfMonth ?? previousMonthEnd();

  const html = renderFactsheetHtml({
    portfolio,
    holdings,
    xray,
    series,
    weightedYtd: Number.isFinite(weightedYtd) ? weightedYtd : null,
    weightedStddev3y: Number.isFinite(weightedStddev3y) ? weightedStddev3y : null,
    asOfMonth: asOf,
  });

  return { portfolio, asOfMonthKey: monthKey(asOf), html };
}

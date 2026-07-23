// Live recompute of the portfolio x-ray (expense, risk, equity coverage,
// look-through geo/sector/top-10 holdings) from the current fund_snapshots +
// fund_allocations. Mirrors the reduce in components/BuildReview.tsx so the
// portfolio detail page shows the same numbers users see at build time — but
// refreshed against today's sync rather than frozen at confirmation.

import type { ConfirmedPortfolioHolding } from "@/lib/db/queries";
import { allocationsForFundIds, type AllocationDetail } from "@/lib/db/queries";
import type { PortfolioXray, XrayBar } from "@/lib/portfolio-derive";

export async function computeLiveXrayExtras(
  holdings: ConfirmedPortfolioHolding[],
): Promise<Pick<PortfolioXray, "expense" | "risk" | "equityCoverage" | "geo" | "sector" | "holdings">> {
  if (holdings.length === 0) {
    return { expense: null, risk: null, equityCoverage: null, geo: [], sector: [], holdings: [] };
  }

  const allocRows = await allocationsForFundIds(holdings.map((h) => h.fund_id));
  const allocsByFund = new Map<number, AllocationDetail[]>();
  for (const row of allocRows) {
    const bucket = allocsByFund.get(row.fund_id) ?? [];
    bucket.push(row);
    allocsByFund.set(row.fund_id, bucket);
  }

  let expense = 0, risk = 0, covEx = 0, covRisk = 0, equityCoverage = 0;
  const aggGeo: Record<string, number> = {};
  const aggSector: Record<string, number> = {};
  const aggHoldings: Record<string, number> = {};

  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;

  for (const h of holdings) {
    const w = h.weight_bps / totalBps; // 0..1
    if (h.expense_ratio != null) { expense += w * h.expense_ratio; covEx += w; }
    if (h.risk_rating != null)   { risk    += w * h.risk_rating;   covRisk += w; }

    const allocs = allocsByFund.get(h.fund_id) ?? [];
    const stockAlloc = allocs.find((a) => a.kind === "asset" && /stock/i.test(a.label));
    const equityShare = stockAlloc
      ? stockAlloc.weight_pct / 100
      : (h.asset_class ?? "").toLowerCase().includes("equity")
        ? 1
        : 0;
    equityCoverage += w * equityShare;

    for (const a of allocs) {
      if (a.kind === "geography") {
        aggGeo[a.label] = (aggGeo[a.label] ?? 0) + w * equityShare * a.weight_pct;
      } else if (a.kind === "sector") {
        aggSector[a.label] = (aggSector[a.label] ?? 0) + w * equityShare * a.weight_pct;
      } else if (a.kind === "holding") {
        // Filter garbled bond-fund holdings (impossible weight, date fragments,
        // stub labels) — mirrors the BuildReview.tsx cleanup.
        if (
          a.weight_pct > 100 ||
          a.weight_pct < 0 ||
          /^\d+\/\d*\/?$/.test(a.label) ||
          a.label.length < 3
        ) continue;
        aggHoldings[a.label] = (aggHoldings[a.label] ?? 0) + w * a.weight_pct;
      }
    }
  }

  const sSec = Object.values(aggSector).reduce((a, b) => a + b, 0) || 1;
  const sGeo = Object.values(aggGeo).reduce((a, b) => a + b, 0) || 1;
  const sortedNorm = (agg: Record<string, number>, total: number): XrayBar[] =>
    Object.entries(agg)
      .map(([label, w]) => ({ label, weight_pct: (w / total) * 100 }))
      .sort((a, b) => b.weight_pct - a.weight_pct);

  return {
    expense: covEx > 0 ? expense / covEx : null,
    risk: covRisk > 0 ? risk / covRisk : null,
    equityCoverage,
    geo: sortedNorm(aggGeo, sGeo),
    sector: sortedNorm(aggSector, sSec),
    holdings: Object.entries(aggHoldings)
      .map(([label, w]) => ({ label, weight_pct: w }))
      .sort((a, b) => b.weight_pct - a.weight_pct)
      .slice(0, 10),
  };
}

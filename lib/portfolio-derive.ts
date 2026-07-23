import type { ConfirmedPortfolio, ConfirmedPortfolioHolding } from "@/lib/db/queries";

// Weighted asset-class breakdown → rounded-to-10 chips for the card header.
// Mapping mirrors `classKey` in components/StudioShell.tsx so the labels we
// surface here are consistent with the rest of the app.

export type AssetBucket = "E" | "F" | "A" | "L" | "C" | "M";

const BUCKET_LABEL: Record<AssetBucket, string> = {
  E: "Equity",
  F: "Fixed Income",
  A: "Multi-Asset",
  L: "Alternatives",
  C: "Commodities",
  M: "Cash",
};

function bucketKey(raw: string | null): AssetBucket {
  if (!raw) return "M";
  const s = raw.toLowerCase();
  if (s.includes("equity")) return "E";
  if (s.includes("fixed")) return "F";
  if (s.includes("allocation")) return "A";
  if (s.includes("alt")) return "L";
  if (s.includes("commod")) return "C";
  return "M";
}

export type AssetChip = { key: AssetBucket; label: string; pct: number };

export function computeAssetMix(holdings: ConfirmedPortfolioHolding[]): AssetChip[] {
  const totalBps = holdings.reduce((s, h) => s + h.weight_bps, 0) || 1;
  const bps = new Map<AssetBucket, number>();
  for (const h of holdings) {
    const k = bucketKey(h.asset_class);
    bps.set(k, (bps.get(k) ?? 0) + h.weight_bps);
  }
  // Convert to %, round to nearest 10, drop zeros, sort desc.
  const rounded: AssetChip[] = [...bps.entries()]
    .map(([k, b]) => ({ key: k, label: BUCKET_LABEL[k], pct: Math.round(((b / totalBps) * 100) / 10) * 10 }))
    .filter((c) => c.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  // Take top 2 (cards stay tight); fold remainder into largest so chips sum 100.
  if (rounded.length <= 2) {
    const sum = rounded.reduce((s, c) => s + c.pct, 0);
    if (rounded.length > 0 && sum !== 100) rounded[0].pct += 100 - sum;
    return rounded;
  }
  const top = rounded.slice(0, 2);
  const sum = top.reduce((s, c) => s + c.pct, 0);
  if (sum !== 100) top[0].pct += 100 - sum;
  return top;
}

// Risk class — pulled from the precomputed xrayJson when available, else
// derived as the weight-bps-weighted average of fund-level `risk_rating`.
//
// `risk_rating` is sourced from Morningstar's CollectedSRRI / CalculatedSRRI
// (see lib/morningstar/parse.ts). EU SRRI is nominally 1–7, but the values
// observed across our 283-fund universe are entirely 1–5 — so the displayed
// scale is /5 everywhere (cards, detail header, StudioShell xray). Whole-number
// values render as integers; fractional values show one decimal.
export function computeRiskRating(
  holdings: ConfirmedPortfolioHolding[],
  xray: PortfolioXray | null,
): number | null {
  if (xray?.risk != null) return xray.risk;
  const total = holdings.reduce((s, h) => s + (h.risk_rating != null ? h.weight_bps : 0), 0);
  if (total === 0) return null;
  const weighted = holdings.reduce(
    (s, h) => s + (h.risk_rating != null ? (h.weight_bps / total) * h.risk_rating : 0),
    0,
  );
  return Math.round(weighted * 10) / 10;
}

export type XrayBar = { label: string; weight_pct: number };
export type PortfolioXray = {
  expense?: number | null;
  risk?: number | null;
  r1y?: number | null;
  r3y?: number | null;
  r5y?: number | null;
  r10y?: number | null;
  equityCoverage?: number | null;
  geo?: XrayBar[];
  sector?: XrayBar[];
  holdings?: XrayBar[];
};

export function parseXray(p: Pick<ConfirmedPortfolio, "xray_json">): PortfolioXray | null {
  if (!p.xray_json) return null;
  try {
    return JSON.parse(p.xray_json) as PortfolioXray;
  } catch {
    return null;
  }
}

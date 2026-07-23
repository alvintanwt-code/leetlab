import type {
  NormalizedFund,
  NormalizedSnapshot,
  NormalizedAllocation,
  NormalizedDocument,
  ScrapedFund,
} from "../scrapers/types";
import type { UniverseFund } from "./api";

// Morningstar BreakdownValues use coded Types that need lookup tables.
// Verified against the rendered HSBC/FWD/TM widget output we already scraped.

const ASSET_TYPE_LABELS: Record<string, string> = {
  "1": "Stocks",
  "3": "Bonds",
  "5": "Preferred",
  "6": "Convertible",
  "7": "Cash",
  "8": "Other",
  "99": "Not Classified",
};

const SECTOR_LABELS: Record<string, string> = {
  "101": "Basic Materials",
  "102": "Consumer Cyclical",
  "103": "Financial Services",
  "104": "Real Estate",
  "205": "Consumer Defensive",
  "206": "Healthcare",
  "207": "Utilities",
  "308": "Communication Services",
  "309": "Energy",
  "310": "Industrials",
  "311": "Technology",
};

const REGION_LABELS: Record<string, string> = {
  "1": "North America",
  "2": "Latin America",
  "3": "United Kingdom",
  "4": "Eurozone",
  "5": "Europe ex Euro",
  "6": "Africa/Middle East",
  "7": "Japan",
  "8": "Australasia",
  "9": "Asia Developed",
  "10": "Asia Emerging",
  "11": "Africa",
};

// SRRI is the EU 1-7 synthetic risk-return indicator.
const SRRI_LABELS: Record<number, string> = {
  1: "Very Low",
  2: "Low",
  3: "Below Average",
  4: "Balanced",
  5: "Above Average",
  6: "High",
  7: "Very High",
};

type SnapshotIn = {
  Id?: string;
  Name?: string;
  LegalName?: string;
  Isin?: string;
  BrandingCompanyName?: string;
  Domicile?: string;
  Currency?: { Id?: string };
  CategoryBroadAssetClass?: { Id?: string; Name?: string };
  CollectedSRRI?: { Rank?: number };
  CalculatedSRRI?: { Rank?: number };
  InceptionDate?: string;
  InvestmentStrategy?: string;
  OngoingCharge?: string | number;
  TotalExpenseRatio?: number;
  ManagementFee?: number;
  ActualManagementFee?: number;
  LastPrice?: {
    Value?: number;
    MarketDate?: string;
    Date?: string;
    Currency?: { Id?: string };
  };
  FundBenchmark?: Array<{ Name?: string }>;
  TrailingPerformance?: Array<{
    Return?: Array<{
      Value?: number;
      Annualized?: boolean;
      TimePeriod?: string;
    }>;
  }>;
  RiskStatistics?: Array<{
    SharpeRatios?: Array<{ Value?: number; TimePeriod?: string }>;
    StandardDeviations?: Array<{ Value?: number; TimePeriod?: string }>;
  }>;
  Portfolios?: Array<{
    AssetAllocations?: Array<{
      SalePosition?: string;
      BreakdownValues?: Array<{ Type?: string; Value?: number }>;
    }>;
    GlobalStockSectorBreakdown?: Array<{
      SalePosition?: string;
      BreakdownValues?: Array<{ Type?: string; Value?: number }>;
    }>;
    RegionalExposure?: Array<{
      SalePosition?: string;
      BreakdownValues?: Array<{ Type?: string; Value?: number }>;
    }>;
    PortfolioHoldings?: Array<{ SecurityName?: string; Weighting?: number }>;
  }>;
  Documents?: Array<{ DocumentTypes?: string[]; EncodedDocumentId?: string }>;
};

function getReturn(
  trailing: SnapshotIn["TrailingPerformance"],
  timePeriod: string,
  annualizedOnly = true,
): number | null {
  const ret = trailing?.[0]?.Return ?? [];
  const m = ret.find(
    (r) =>
      r.TimePeriod === timePeriod &&
      (annualizedOnly ? r.Annualized === true : r.Annualized !== true),
  );
  return m?.Value != null ? Number(m.Value) : null;
}

function inferDistribution(name: string | undefined): string | null {
  const up = (name ?? "").toUpperCase();
  // Accumulating signal first (more specific)
  if (/\b(?:ACC|CAP|ACCUMULATING)\b/.test(up)) return "Acc";
  if (/\b(?:DIS|DIST|MDIS|MDISTRIB|INC|DISTRIBUTING)\b/.test(up)) return "Dist";
  return null;
}

function pushBreakdown(
  out: NormalizedAllocation[],
  breakdowns: Array<{ SalePosition?: string; BreakdownValues?: Array<{ Type?: string; Value?: number }> }> | undefined,
  labels: Record<string, string>,
  kind: NormalizedAllocation["kind"],
  asOf: string,
) {
  const net = breakdowns?.find((b) => b.SalePosition === "N");
  if (!net) return;
  for (const bv of net.BreakdownValues ?? []) {
    const type = bv.Type;
    const label = type ? labels[type] : undefined;
    const val = typeof bv.Value === "number" ? bv.Value : NaN;
    if (!label || !Number.isFinite(val) || val === 0) continue;
    out.push({ kind, label, weightPct: val, asOf });
  }
}

/**
 * Build a ScrapedFund from a screener row only — no MFsnapshot needed.
 *
 * Used as a fallback for funds where the full MFsnapshot endpoint returns
 * empty (notably MAS-coded Singapore funds in the FWD universe). The screener
 * gives us name / asset class / risk / fund house / 1Y-10Y annualised returns
 * directly; what's missing is NAV (no LastPrice in screener), allocations
 * (sector/geo/holdings), and OCF for SG funds specifically.
 */
export function parseScreenerRow(
  row: UniverseFund,
  fallbackExternalId: string,
  sourceUrl: string,
): ScrapedFund {
  const externalId = row.secId || fallbackExternalId;
  const srri = row.CollectedSRRI ?? row.CalculatedSRRI ?? null;
  const riskRating = srri ? Math.min(5, Math.max(1, srri)) : null;
  const ocf =
    typeof row.OngoingCharge === "number" && Number.isFinite(row.OngoingCharge)
      ? row.OngoingCharge
      : null;

  const fund: NormalizedFund = {
    externalId,
    name: row.Name || row.LegalName || `(unknown — ${externalId})`,
    isin: row.Isin || null,
    fundHouse: row.BrandingCompanyName ?? row.FundCompanyName ?? null,
    currency: row.Currency ?? null,
    assetClass: row.CategoryName ?? null,
    distributionType: inferDistribution(row.Name),
    riskRating,
    riskLabel: srri ? SRRI_LABELS[srri] ?? null : null,
    shareClassInception: row.InceptionDate ? row.InceptionDate.slice(0, 10) : null,
    fundSize: null,
    fundSizeCurrency: null,
    fundSizeAsOf: null,
    dealingFrequency: null,
    benchmark: null,
    sfdrClassification: null,
    expenseRatio: ocf,
    managementFee: typeof row.ManagementFee === "number" ? row.ManagementFee : null,
    morningstarRating: null,
    investmentObjective: null,
    sourceUrl,
  };

  const snapshot: NormalizedSnapshot = {
    asOf: new Date().toISOString().slice(0, 10),
    nav: null,
    currency: row.Currency ?? null,
    changePct: null,
    ytd: row.ReturnM0 ?? null,
    ann1y: row.ReturnM12 ?? null,
    ann3y: row.ReturnM36 ?? null,
    ann5y: row.ReturnM60 ?? null,
    ann10y: row.ReturnM120 ?? null,
    annSince: null,
    alpha3y: null,
    beta3y: null,
    sharpe3y: null,
    stddev3y: row.StandardDeviationM36 ?? null,
  };

  return { fund, snapshot, allocations: [], documents: [], rawMarkdown: "" };
}

export function parseMorningstarSnapshot(
  data: SnapshotIn,
  fallbackExternalId: string,
  sourceUrl: string,
): ScrapedFund {
  const externalId = data.Id ?? fallbackExternalId;
  const inception = data.InceptionDate ? data.InceptionDate.slice(0, 10) : null;
  const navDate =
    data.LastPrice?.MarketDate ??
    (data.LastPrice?.Date ? data.LastPrice.Date.slice(0, 10) : null);
  const asOf = navDate ?? new Date().toISOString().slice(0, 10);

  const srri = data.CollectedSRRI?.Rank ?? data.CalculatedSRRI?.Rank ?? null;
  // SRRI is 1-7 but our schema fits 1-5; cap at 5 with a "Very High / Very Low" surrogate label.
  const riskRating = srri ? Math.min(5, Math.max(1, srri)) : null;

  const expenseRatio =
    (data.OngoingCharge != null ? parseFloat(String(data.OngoingCharge)) : NaN) ||
    data.TotalExpenseRatio ||
    null;
  const managementFee = data.ActualManagementFee ?? data.ManagementFee ?? null;

  const fund: NormalizedFund = {
    externalId,
    name: data.Name ?? data.LegalName ?? `(unknown — ${externalId})`,
    isin: data.Isin ?? null,
    fundHouse: data.BrandingCompanyName ?? null,
    currency: data.Currency?.Id ?? data.LastPrice?.Currency?.Id ?? null,
    assetClass: data.CategoryBroadAssetClass?.Name ?? null,
    distributionType: inferDistribution(data.Name),
    riskRating,
    riskLabel: srri ? SRRI_LABELS[srri] ?? null : null,
    shareClassInception: inception,
    fundSize: null,
    fundSizeCurrency: null,
    fundSizeAsOf: null,
    dealingFrequency: null,
    benchmark: data.FundBenchmark?.[0]?.Name ?? null,
    sfdrClassification: null,
    expenseRatio: Number.isFinite(expenseRatio) ? (expenseRatio as number) : null,
    managementFee: typeof managementFee === "number" ? managementFee : null,
    morningstarRating: null,
    investmentObjective: data.InvestmentStrategy ?? null,
    sourceUrl,
  };

  const trailing = data.TrailingPerformance;
  const riskRow = data.RiskStatistics?.[0];
  const sharpe3y = riskRow?.SharpeRatios?.find((r) => r.TimePeriod === "M36")?.Value ?? null;
  const stddev3y = riskRow?.StandardDeviations?.find((r) => r.TimePeriod === "M36")?.Value ?? null;

  const snapshot: NormalizedSnapshot = {
    asOf,
    nav: data.LastPrice?.Value ?? null,
    currency: data.LastPrice?.Currency?.Id ?? data.Currency?.Id ?? null,
    changePct: getReturn(trailing, "D1", false),
    ytd: getReturn(trailing, "M0", true),
    ann1y: getReturn(trailing, "M12", true),
    ann3y: getReturn(trailing, "M36", true),
    ann5y: getReturn(trailing, "M60", true),
    ann10y: getReturn(trailing, "M120", true),
    annSince: getReturn(trailing, "M255", true),
    alpha3y: null,
    beta3y: null,
    sharpe3y,
    stddev3y,
  };

  const allocations: NormalizedAllocation[] = [];
  const portfolio = data.Portfolios?.[0];
  if (portfolio) {
    pushBreakdown(allocations, portfolio.AssetAllocations, ASSET_TYPE_LABELS, "asset", asOf);
    pushBreakdown(allocations, portfolio.GlobalStockSectorBreakdown, SECTOR_LABELS, "sector", asOf);
    pushBreakdown(allocations, portfolio.RegionalExposure, REGION_LABELS, "geography", asOf);
    for (const h of portfolio.PortfolioHoldings ?? []) {
      const label = h.SecurityName;
      const val = typeof h.Weighting === "number" ? h.Weighting : NaN;
      if (label && Number.isFinite(val) && val > 0) {
        allocations.push({ kind: "holding", label, weightPct: val, asOf });
      }
    }
  }

  // Documents — Morningstar returns coded DocumentTypes. The download flow needs
  // separate work (Task #6 in the original wrap-up) so we leave them empty here.
  const documents: NormalizedDocument[] = [];

  return { fund, snapshot, allocations, documents, rawMarkdown: "" };
}

export type NormalizedFund = {
  externalId: string;
  name: string;
  isin: string | null;
  fundHouse: string | null;
  currency: string | null;
  assetClass: string | null;
  distributionType: "Acc" | "Dist" | string | null;
  riskRating: number | null;
  riskLabel: string | null;
  shareClassInception: string | null;
  fundSize: number | null;
  fundSizeCurrency: string | null;
  fundSizeAsOf: string | null;
  dealingFrequency: string | null;
  benchmark: string | null;
  sfdrClassification: string | null;
  expenseRatio: number | null;
  managementFee: number | null;
  morningstarRating: number | null;
  investmentObjective: string | null;
  sourceUrl: string;
};

export type NormalizedSnapshot = {
  asOf: string;
  nav: number | null;
  currency: string | null;
  changePct: number | null;
  ann1y: number | null;
  ann3y: number | null;
  ann5y: number | null;
  ann10y: number | null;
  annSince: number | null;
  alpha3y: number | null;
  beta3y: number | null;
  sharpe3y: number | null;
  stddev3y: number | null;
};

export type NormalizedAllocation = {
  kind: "asset" | "geography" | "sector" | "holding";
  label: string;
  weightPct: number;
  asOf: string;
};

export type NormalizedDocument = {
  type: string;
  label: string;
  sourceUrl: string | null;
};

export type ScrapedFund = {
  fund: NormalizedFund;
  snapshot: NormalizedSnapshot;
  allocations: NormalizedAllocation[];
  documents: NormalizedDocument[];
  rawMarkdown: string;
};

export interface FundProviderAdapter {
  slug: string;
  name: string;
  sourceUrl: string;
  listFundIds(): Promise<string[]>;
  scrapeFund(externalId: string): Promise<ScrapedFund>;
}

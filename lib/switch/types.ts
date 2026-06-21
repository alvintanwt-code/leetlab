export type ResolvedHolding = {
  inputName: string;
  currentValue: number;
  units: number | null;
  unitPrice: number | null;
  fundId: number | null;
  matchedName: string | null;
  assetClass: string | null;
  risk: number | null;
  expenseRatio: number | null;
  ann3y: number | null;
  isin: string | null;
};

export type ModelHolding = {
  fundId: number;
  name: string;
  assetClass: string | null;
  risk: number | null;
  expenseRatio: number | null;
  ann3y: number | null;
  weightPct: number;
  isin: string | null;
};

export type AssetClassDriftRow = {
  assetClass: string;
  currentPct: number;
  targetPct: number;
  delta: number;
};

export type WhyRowKind = "switch" | "remove" | "reduce" | "add" | "increase";

export type WhyRow = {
  kind: WhyRowKind;
  fromFund: string | null;
  toFund: string | null;
  fromPct: number;
  toPct: number;
  delta: number;
  assetClass: string | null;
  rationale: string;
};

export type XrayBreakdown = { label: string; weight_pct: number }[];

export type SwitchOrderOutRow = {
  fund: string;
  sgdAmount: number;
  pctOfFund: number;
};

export type SwitchOrderInRow = {
  fund: string;
  pct: number;
};

export type SwitchOrder = {
  switchOut: SwitchOrderOutRow[];
  switchIn: SwitchOrderInRow[];
  totalSwitchOutSgd: number;
};

// One row in the current or target fund table — same shape on both sides so
// the comparison reads cleanly. ISIN is for the chart blend on the target side
// and to key change rows on either side.
export type SwitchFundRow = {
  fundId: number | null;
  name: string;
  weightPct: number;
  valueSgd: number;
  assetClass: string | null;
  isin: string | null;
};

export type ChangeKind = "new" | "added" | "reduced" | "no_change";

export type SwitchChangeRow = {
  fundId: number | null;
  name: string;
  currentPct: number;
  targetPct: number;
  delta: number;
  kind: ChangeKind;
};

export type SwitchMemo = {
  platformLabel: string;
  modelName: string;
  modelCategory: string;
  proposedDate: string;
  delta: {
    expReturn: number | null;
    expRisk: number | null;
    ocf: number | null;
  };
  current: {
    expReturn: number | null;
    expRisk: number | null;
    ocf: number | null;
    holdingsCount: number;
    totalValue: number;
    mergedRowCount: number;
  };
  target: {
    expReturn: number | null;
    expRisk: number | null;
    ocf: number | null;
    holdingsCount: number;
  };
  assetClassDrift: AssetClassDriftRow[];
  whyRows: WhyRow[];
  unmatched: string[];
  proposedXray: {
    sector: XrayBreakdown;
    geo: XrayBreakdown;
    holdings: XrayBreakdown;
    // Headline trailing returns lifted from the model's stored xray_json. Used
    // by the SwitchResult's new-portfolio Performance section.
    r1y: number | null;
    r3y: number | null;
    r5y: number | null;
    r10y: number | null;
    expense: number | null;
    risk: number | null;
  };
  switchOrder: SwitchOrder;
  // Side-by-side raw tables for the new result view. `currentFunds` is the
  // client's aggregated holdings (one row per fund, accounts merged);
  // `targetFunds` is the model holdings in weight-desc order.
  currentFunds: SwitchFundRow[];
  targetFunds: SwitchFundRow[];
  // Union of funds across current + target, classified into one of four
  // states for the changes table. Includes no-change rows (unlike `whyRows`,
  // which filters them out for the advisor memo).
  changes: SwitchChangeRow[];
};

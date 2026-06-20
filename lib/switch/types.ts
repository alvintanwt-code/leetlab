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
};

export type ModelHolding = {
  fundId: number;
  name: string;
  assetClass: string | null;
  risk: number | null;
  expenseRatio: number | null;
  ann3y: number | null;
  weightPct: number;
};

export type AssetClassDriftRow = {
  assetClass: string;
  currentPct: number;
  targetPct: number;
  delta: number;
};

export type WhyRow = {
  kind: "reduce" | "add" | "switch";
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
  };
  switchOrder: SwitchOrder;
};

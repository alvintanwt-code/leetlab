"use server";

import { z } from "zod";
import { auth } from "@/auth";
import {
  getConfirmedPortfolio,
  getPortfolioHoldings,
  listFundsForPicker,
} from "@/lib/db/queries";
import { computeMemo } from "@/lib/switch/compute";
import type {
  ModelHolding,
  ResolvedHolding,
  SwitchMemo,
  XrayBreakdown,
} from "@/lib/switch/types";

const PROVIDER_LABEL: Record<string, string> = {
  hsbc: "HSBC Life",
  tmls: "Tokio Marine",
  fwd: "FWD",
  gwm: "GWM",
};

const PayloadSchema = z.object({
  modelId: z.number().int().positive(),
  holdings: z
    .array(
      z.object({
        fund: z.string().min(1).max(200),
        fundId: z.number().int().positive().optional(),
        units: z.string().max(40).optional(),
        costBasis: z.string().max(40).optional(),
        currentValue: z.string().min(1).max(40),
      }),
    )
    .min(1)
    .max(50),
});

function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

type FundMeta = {
  id: number;
  name: string;
  asset_class: string | null;
  risk_rating: number | null;
  expense_ratio: number | null;
  ann_3y: number | null;
};

function matchFund(name: string, funds: FundMeta[]): FundMeta | null {
  const norm = name.trim().toLowerCase();
  if (!norm) return null;
  const exact = funds.find((f) => f.name.toLowerCase() === norm);
  if (exact) return exact;
  const subs = funds.filter((f) => f.name.toLowerCase().includes(norm));
  if (subs.length > 0) {
    subs.sort((a, b) => a.name.length - b.name.length);
    return subs[0];
  }
  const reverse = funds.filter((f) => norm.includes(f.name.toLowerCase()));
  if (reverse.length > 0) {
    reverse.sort((a, b) => b.name.length - a.name.length);
    return reverse[0];
  }
  return null;
}

function safeXrayBreakdown(value: unknown): XrayBreakdown {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is { label: string; weight_pct: number } =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as { label?: unknown }).label === "string" &&
        typeof (v as { weight_pct?: unknown }).weight_pct === "number",
    )
    .map((v) => ({ label: v.label, weight_pct: v.weight_pct }));
}

export type GenerateSwitchResult =
  | { ok: true; memo: SwitchMemo }
  | { ok: false; error: string };

export async function generateSwitch(input: unknown): Promise<GenerateSwitchResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign in required" };

  const parsed = PayloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { modelId, holdings } = parsed.data;

  const portfolio = await getConfirmedPortfolio(modelId);
  if (!portfolio) return { ok: false, error: "Model not found" };

  const [modelHoldingRows, providerFunds] = await Promise.all([
    getPortfolioHoldings(modelId),
    listFundsForPicker(portfolio.provider_slug),
  ]);

  const fundLookup: FundMeta[] = providerFunds.map((f) => ({
    id: f.id,
    name: f.name,
    asset_class: f.asset_class,
    risk_rating: f.risk_rating,
    expense_ratio: f.expense_ratio,
    ann_3y: f.ann_3y,
  }));

  const byId = new Map<number, FundMeta>();
  for (const f of fundLookup) byId.set(f.id, f);

  const resolved: ResolvedHolding[] = holdings.map((h) => {
    const cv = parseNum(h.currentValue) ?? 0;
    const cb = parseNum(h.costBasis);
    const u = parseNum(h.units);
    const explicit = h.fundId != null ? byId.get(h.fundId) ?? null : null;
    const matched = explicit ?? matchFund(h.fund, fundLookup);
    if (!matched) {
      return {
        inputName: h.fund,
        currentValue: cv,
        costBasis: cb,
        units: u,
        fundId: null,
        matchedName: null,
        assetClass: null,
        risk: null,
        expenseRatio: null,
        ann3y: null,
      };
    }
    return {
      inputName: h.fund,
      currentValue: cv,
      costBasis: cb,
      units: u,
      fundId: matched.id,
      matchedName: matched.name,
      assetClass: matched.asset_class,
      risk: matched.risk_rating,
      expenseRatio: matched.expense_ratio,
      ann3y: matched.ann_3y,
    };
  });

  const modelHoldings: ModelHolding[] = modelHoldingRows.map((m) => ({
    fundId: m.fund_id,
    name: m.name,
    assetClass: m.asset_class,
    risk: m.risk_rating,
    expenseRatio: m.expense_ratio,
    ann3y: m.ann_3y,
    weightPct: m.weight_bps / 100,
  }));

  let proposedXray: SwitchMemo["proposedXray"] = { sector: [], geo: [], holdings: [] };
  try {
    if (portfolio.xray_json) {
      const x = JSON.parse(portfolio.xray_json) as Record<string, unknown>;
      proposedXray = {
        sector: safeXrayBreakdown(x.sector),
        geo: safeXrayBreakdown(x.geo),
        holdings: safeXrayBreakdown(x.holdings),
      };
    }
  } catch {
    // leave proposedXray empty
  }

  const memo = computeMemo({
    resolved,
    modelHoldings,
    modelName: portfolio.name,
    modelCategory: portfolio.category,
    platformLabel: PROVIDER_LABEL[portfolio.provider_slug] ?? portfolio.provider_name,
    proposedDate: new Date().toISOString().slice(0, 10),
    proposedXray,
  });

  return { ok: true, memo };
}

"use server";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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
        units: z.string().min(1).max(40),
        unitPrice: z.string().min(1).max(40),
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
    const u = parseNum(h.units);
    const p = parseNum(h.unitPrice);
    const cv = u != null && p != null ? u * p : 0;
    const explicit = h.fundId != null ? byId.get(h.fundId) ?? null : null;
    const matched = explicit ?? matchFund(h.fund, fundLookup);
    if (!matched) {
      return {
        inputName: h.fund,
        currentValue: cv,
        units: u,
        unitPrice: p,
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
      units: u,
      unitPrice: p,
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

const ParseRequestSchema = z.object({
  text: z.string().min(10).max(20000),
  platformSlug: z.string().min(1).max(20),
});

const ParsedHoldingSchema = z.object({
  fund: z
    .string()
    .describe(
      "Best canonical fund name. Use the exact name from the platform fund universe when matched.",
    ),
  fundId: z
    .number()
    .nullable()
    .describe(
      "Numeric ID from the platform fund universe if confidently matched. Null when uncertain.",
    ),
  units: z
    .number()
    .describe(
      "Number of units / shares the client holds. Required. Plain number, no commas. If the source only shows total value and unit price, divide to compute units.",
    ),
  unitPrice: z
    .number()
    .describe(
      "Unit price / NAV in SGD as a plain number — strip currency prefixes and commas. Required. If the source only shows total value and units, divide value by units to compute unit price.",
    ),
});

const ParsedPortfolioSchema = z.object({
  holdings: z
    .array(ParsedHoldingSchema)
    .describe(
      "One entry per client holding. Skip headers, totals, subtotals, footnotes, summary rows.",
    ),
});

export type ParsedHoldingRow = z.infer<typeof ParsedHoldingSchema>;

export type ParsePastedPortfolioResult =
  | { ok: true; rows: ParsedHoldingRow[] }
  | { ok: false; error: string };

export async function parsePastedPortfolio(
  input: unknown,
): Promise<ParsePastedPortfolioResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign in required" };

  const parsed = ParseRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY is not set on the server. Restart the dev server with the key exported.",
    };
  }

  const { text, platformSlug } = parsed.data;

  const funds = await listFundsForPicker(platformSlug);
  const fundUniverse = funds
    .map(
      (f) =>
        `${f.id} | ${f.name} | ${f.fund_house ?? "—"} | ${f.asset_class ?? "—"}`,
    )
    .join("\n");

  const platformLabel = PROVIDER_LABEL[platformSlug] ?? platformSlug;

  const client = new Anthropic();

  try {
    // System prompt is split into two blocks: stable rules (cacheable across
    // every paste) + per-platform fund universe (cacheable per-platform for
    // ~5 min). Pasted text lives in the user message — the only volatile
    // portion. Net effect: repeat pastes within the cache window pay ~0.1x
    // input cost on the universe (typically the largest chunk of input).
    const response = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      // Adaptive thinking lets the model reason through messy share-class
      // disambiguation (Acc vs Dist, SGDH vs SGD, fund-house overlap) before
      // emitting a row — material accuracy lift on the fundId binding step.
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text:
            "You parse client investment portfolio data from messy pasted text (statements, broker portals, emails) and emit a structured list of holdings.\n\n" +
            "Rules:\n" +
            "- One entry per unique fund — even when the source shows the same fund spread across multiple account sections (Initial Account, Accumulation Account, RSP, SRS, Cash, sub-policies, etc.). Combine them: SUM the units across accounts; the unit price stays the same (a fund's NAV is universal across accounts). The implicit total value equals units_summed × unitPrice.\n" +
            "- Skip headers, totals, subtotals, footnotes, summary rows, balance lines, account labels.\n" +
            "- **Skip positions where units across all accounts sum to 0** — no actual exposure, would distort the analysis.\n" +
            "- Strip currency prefixes (SGD, S$, USD, $, etc.) and thousands separators to produce plain numbers.\n" +
            "- **Multi-currency handling.** The emitted `unitPrice` must be in SGD.\n" +
            "  • If the source's unit-price column is already in SGD (fund currency = SGD, or no other currency shown), use it directly.\n" +
            "  • If the source shows unit price in a fund currency other than SGD AND an FX rate (e.g. column labelled `Fx Rate`, `Exchange Rate`) or an SGD-equivalent value (e.g. `Policy Value (Contract Currency)` where the contract currency is SGD), convert: emit `unitPrice` = fund_currency_NAV × fx_rate_to_sgd. If no FX rate is given but both fund-currency value and SGD value are shown for the same row, derive the FX as sgd_value / fund_ccy_value.\n" +
            "  • Sanity-check: emitted_units × emitted_unitPrice should match the source's SGD value for that fund within a small rounding tolerance.\n" +
            "- Match each holding against the supplied platform fund universe (sourced from Morningstar). Use fund_house + name + asset class to disambiguate share classes. Prefer a confident match — only leave fundId null if multiple equally-good candidates exist.\n" +
            "- When matched, use the canonical name from the universe in `fund`.\n" +
            "- Each emitted row needs `units` (total number of units / shares held across all accounts) AND `unitPrice` (NAV per unit, in SGD per the rule above). If the source only shows two of {units, unitPrice, total value}, derive the third — they're linked by value = units × unitPrice.",
        },
        {
          type: "text",
          text:
            `Platform: ${platformLabel}\n\n` +
            `Fund universe (id | name | fund house | asset class):\n${fundUniverse || "(empty)"}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content:
            `Pasted portfolio text:\n${text}\n\n` +
            `Extract each client holding and emit them via the structured response.`,
        },
      ],
      output_config: {
        format: zodOutputFormat(ParsedPortfolioSchema),
      },
    });

    // Safety classifiers may decline a paste (rare; usually triggers on text
    // that looks like a credential/PII dump). The structured response is empty
    // in that case — surface a distinct error instead of the generic one.
    if (response.stop_reason === "refusal") {
      return {
        ok: false,
        error: "Anthropic safety classifiers declined this paste. Strip sensitive identifiers (account numbers, NRIC) and retry.",
      };
    }

    const data = response.parsed_output;
    if (!data || !Array.isArray(data.holdings)) {
      return { ok: false, error: "Couldn't parse the pasted text into holdings." };
    }
    if (data.holdings.length === 0) {
      return { ok: false, error: "No holdings detected in the pasted text." };
    }

    return { ok: true, rows: data.holdings };
  } catch (error) {
    console.error("parsePastedPortfolio error:", error);
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Parse failed (${error.status}): ${error.message}` };
    }
    return { ok: false, error: "Parse failed. Try a smaller or cleaner block of text." };
  }
}

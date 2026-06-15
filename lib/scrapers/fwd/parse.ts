import type {
  NormalizedFund,
  NormalizedSnapshot,
  NormalizedAllocation,
  NormalizedDocument,
  ScrapedFund,
} from "../types";

const DETAIL_URL = (id: string) =>
  `https://www.fwd.com.sg/personalised-financial-advice/fund-report/?currencyId=SGD&languageId=en-GB&id=${id}`;

export type FwdExtractJson = {
  name?: string | null;
  latestNav?: number | string | null;
  navDate?: string | null;
  isin?: string | null;
  currency?: string | null;
  fundHouse?: string | null;
  fundSize?: string | null;
  benchmark?: string | null;
  morningstarCategory?: string | null;
  morningstarRating?: number | null;
  assetClass?: string | null;
  riskRating?: number | null;
  riskLabel?: string | null;
  investmentObjective?: string | null;
  expenseRatio?: number | null;
  managementFee?: number | null;
  shareClassInception?: string | null;
  distributionType?: string | null;
  ann1y?: number | null;
  ann3y?: number | null;
  ann5y?: number | null;
  ann10y?: number | null;
  assetAllocation?: Array<{ label: string; weightPct: number }>;
  geographicAllocation?: Array<{ label: string; weightPct: number }>;
  sectorAllocation?: Array<{ label: string; weightPct: number }>;
  topHoldings?: Array<{ label: string; weightPct: number }>;
};

function nz<T>(v: T | undefined): T | null {
  if (v === undefined) return null;
  return v;
}

function emptyOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim();
  return t.length === 0 ? null : t;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/[, ]/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function parseFundSize(raw: string | null | undefined): {
  fundSize: number | null;
  currency: string | null;
  asOf: string | null;
} {
  if (!raw) return { fundSize: null, currency: null, asOf: null };
  // Seen formats:
  //   "8403.36M(12/06/2026)"          (FWD)
  //   "SGD 1.69b (29 May 2026)"        (TM)
  //   "USD 2.4B as of 31 May 2026"     (defensive)
  const cur = raw.match(/\b([A-Z]{3})\b/);
  const amt = raw.match(/([0-9][0-9,.]*)\s*([MmBb])\b/);
  const date = raw.match(/\(([^)]+)\)|as of\s+([^,)]+)/i);
  let size: number | null = null;
  if (amt) {
    size = parseFloat(amt[1].replace(/,/g, ""));
    if (amt[2].toLowerCase() === "b") size *= 1000;
  }
  return {
    fundSize: size,
    currency: cur ? cur[1] : null,
    asOf: emptyOrNull(date ? (date[1] ?? date[2]) : null),
  };
}

function normaliseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // DD MMM YYYY
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const m = t.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // DD/MM/YYYY
  const m2 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return null;
}

function normaliseDistribution(s: string | null | undefined): string | null {
  const t = emptyOrNull(s);
  if (!t) return null;
  const lc = t.toLowerCase();
  if (lc.startsWith("acc")) return "Acc";
  if (lc.startsWith("dis") || lc.startsWith("dist")) return "Dist";
  return t;
}

function detectHallucination(raw: FwdExtractJson): string | null {
  // Firecrawl's JSON extractor falls back to plausible-but-fake values when
  // the target page didn't render — usually a landing-page fallback. Catch
  // the common tells before we write fake data to the DB.
  const name = String(raw.name ?? "").trim();
  if (!name) return "no name returned (empty extraction)";
  if (/^FWD\s+Singapore\s+Fund$/i.test(name)) return "name matches landing-page fallback";
  const placeholderHolding = (raw.topHoldings ?? []).some((h) =>
    /^Company\s+[A-Z]\b/i.test(String(h?.label ?? "")),
  );
  if (placeholderHolding) return "topHoldings contain placeholder labels (Company A/B/...)";
  const isin = String(raw.isin ?? "").trim();
  if (/^SG00012345/.test(isin) || /^[A-Z]{2}0+1234/.test(isin)) {
    return `placeholder ISIN ${isin}`;
  }
  return null;
}

export function buildScrapedFund(
  externalId: string,
  raw: FwdExtractJson,
  sourceUrl: string,
): ScrapedFund {
  const hallucination = detectHallucination(raw);
  if (hallucination) {
    throw new Error(`hallucinated extraction (${hallucination}) — extractor likely received a fallback page`);
  }
  const fundSizeInfo = parseFundSize(emptyOrNull(raw.fundSize));
  const navAsOf = normaliseDate(raw.navDate) ?? new Date().toISOString().slice(0, 10);

  const fund: NormalizedFund = {
    externalId,
    name: emptyOrNull(raw.name) ?? `(unknown — ${externalId})`,
    isin: emptyOrNull(raw.isin),
    fundHouse: emptyOrNull(raw.fundHouse),
    currency: emptyOrNull(raw.currency),
    assetClass: emptyOrNull(raw.assetClass),
    distributionType: normaliseDistribution(raw.distributionType),
    riskRating: nz(raw.riskRating),
    riskLabel: emptyOrNull(raw.riskLabel),
    shareClassInception: emptyOrNull(raw.shareClassInception),
    fundSize: fundSizeInfo.fundSize,
    fundSizeCurrency: fundSizeInfo.currency ?? emptyOrNull(raw.currency),
    fundSizeAsOf: fundSizeInfo.asOf,
    dealingFrequency: null,
    benchmark: emptyOrNull(raw.benchmark),
    sfdrClassification: null,
    expenseRatio: nz(raw.expenseRatio),
    managementFee: nz(raw.managementFee),
    morningstarRating: nz(raw.morningstarRating),
    investmentObjective: emptyOrNull(raw.investmentObjective),
    sourceUrl,
  };

  const snapshot: NormalizedSnapshot = {
    asOf: navAsOf,
    nav: num(raw.latestNav),
    currency: emptyOrNull(raw.currency),
    changePct: null,
    ann1y: num(raw.ann1y),
    ann3y: num(raw.ann3y),
    ann5y: num(raw.ann5y),
    ann10y: num(raw.ann10y),
    annSince: null,
    alpha3y: null,
    beta3y: null,
    sharpe3y: null,
    stddev3y: null,
  };

  const allocations: NormalizedAllocation[] = [];
  const allocAsOf = navAsOf;
  const pushAllocs = (
    arr: Array<{ label: string; weightPct: number }> | undefined,
    kind: NormalizedAllocation["kind"],
  ) => {
    if (!arr) return;
    for (const row of arr) {
      const label = emptyOrNull(row?.label);
      const w = num(row?.weightPct);
      if (!label || w == null) continue;
      allocations.push({ kind, label, weightPct: w, asOf: allocAsOf });
    }
  };
  pushAllocs(raw.assetAllocation, "asset");
  pushAllocs(raw.geographicAllocation, "geography");
  pushAllocs(raw.sectorAllocation, "sector");
  pushAllocs(raw.topHoldings, "holding");

  const documents: NormalizedDocument[] = [];

  return { fund, snapshot, allocations, documents, rawMarkdown: "" };
}

export { DETAIL_URL };

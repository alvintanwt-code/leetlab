import type {
  NormalizedFund,
  NormalizedSnapshot,
  NormalizedAllocation,
  NormalizedDocument,
  ScrapedFund,
} from "../types";

// Shared parser for the Morningstar fund-report widget used by both FWD
// and TMLS detail pages. Assumes the page has been scraped with the
// expand-accordions click action so all sections are visible.

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

function num(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "" || t === "–" || t === "-" || t === "—" || t === "N/A") return null;
  const m = t.replace(/[, ]/g, "").replace(/−/g, "-").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function emptyOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (t === "" || t === "–" || t === "-" || t === "—" || t === "N/A") return null;
  return t;
}

function dmyToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // "15 June 2026" or "31 Jan 2019"
  const m = t.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // "15/06/2026" or "30/04/2026"
  const m2 = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return null;
}

/**
 * Slice markdown between a heading and the next heading at the same-or-shallower
 * depth. Returns the body text (no heading line).
 */
function sliceSection(md: string, headingRegex: RegExp): string {
  const startMatch = md.match(headingRegex);
  if (!startMatch) return "";
  const startIdx = startMatch.index! + startMatch[0].length;
  const tail = md.slice(startIdx);
  // Find next "## " or end. We stop at top-level (`##`) headings to avoid
  // sucking in subsequent sections. Sub-headings (`###`) stay within scope.
  const next = tail.search(/\n##\s+[^#]/);
  return next === -1 ? tail : tail.slice(0, next);
}

/**
 * Parse the top header card. The structure is:
 *   {Fund Name}\n\nLatest NAV\n{nav}\n\nDate of Latest NAV\n{date}\n\nISIN\n{isin}\n
 *   Currency\n{ccy}\n\nFund Size\n{size}\n\nBenchmark\n{bench}\n\nMorningstar category\n{cat}
 */
type TopCard = {
  name: string | null;
  nav: number | null;
  navDate: string | null;
  isin: string | null;
  currency: string | null;
  fundSizeRaw: string | null;
  benchmark: string | null;
  morningstarCategory: string | null;
};

function parseTopCard(md: string): TopCard {
  const labelValue = (label: string): string | null => {
    // Each labeled value lives on its own line, separated by blank lines.
    const re = new RegExp(
      `(?:^|\\n)${label}\\s*\\n+([^\\n]+)`,
      "i",
    );
    const m = md.match(re);
    return m ? m[1].trim() : null;
  };

  // Fund name: the line immediately preceding "Latest NAV". TM has a (CODE)
  // suffix; FWD does not. We grab whatever's on the line above the label.
  let name: string | null = null;
  const navIdx = md.search(/\n+Latest NAV\s*\n/);
  if (navIdx >= 0) {
    // Walk back to find the previous non-empty line.
    const before = md.slice(0, navIdx).split("\n").reverse();
    for (const line of before) {
      const t = line.trim();
      if (
        t &&
        !t.startsWith("##") &&
        !t.startsWith("[") &&
        t !== "Subscribe Inquiry" &&
        t !== "* * *"
      ) {
        name = t;
        break;
      }
    }
  }

  return {
    name,
    nav: num(labelValue("Latest NAV")),
    navDate: dmyToIso(labelValue("Date of Latest NAV")),
    isin: emptyOrNull(labelValue("ISIN")),
    currency: emptyOrNull(labelValue("Currency")),
    fundSizeRaw: emptyOrNull(labelValue("Fund Size")),
    benchmark: emptyOrNull(labelValue("Benchmark")),
    morningstarCategory: emptyOrNull(labelValue("Morningstar category")),
  };
}

function parseFundSize(raw: string | null): {
  fundSize: number | null;
  currency: string | null;
  asOf: string | null;
} {
  if (!raw) return { fundSize: null, currency: null, asOf: null };
  // "8403.36M(12/06/2026)" (FWD) or "SGD 1.69b (29 May 2026)" (TM)
  const cur = raw.match(/\b([A-Z]{3})\b/);
  const amt = raw.match(/([0-9][0-9,.]*)\s*([MmBb])\b/);
  const dateInner = raw.match(/\(([^)]+)\)/);
  const dateBare = raw.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  let size: number | null = null;
  if (amt) {
    size = parseFloat(amt[1].replace(/,/g, ""));
    if (amt[2].toLowerCase() === "b") size *= 1000;
  }
  return {
    fundSize: size,
    currency: cur ? cur[1] : null,
    asOf: dmyToIso(dateInner ? dateInner[1] : dateBare ? dateBare[1] : null),
  };
}

function parseInvestmentObjective(md: string): string | null {
  const body = sliceSection(md, /\n##\s+Investment objective\s*\n/i).trim();
  if (!body) return null;
  // Take only the first paragraph (until blank line or next ## block start).
  const para = body.split(/\n\s*\n/)[0].trim();
  return para || null;
}

/**
 * Trailing returns table — 1M / 3M / 6M / 1Y / 3Y / 5Y / sometimes 10Y.
 * The row of interest starts with "| Fund |".
 */
function parseTrailingReturns(md: string): {
  ann1y: number | null;
  ann3y: number | null;
  ann5y: number | null;
  ann10y: number | null;
} {
  const perfBody = sliceSection(md, /\n##\s+Performance\s*\n/i);
  // The trailing-returns table is uniquely identified by a header row that
  // contains both "1M" and "5Y" (other tables have year-range or calendar-
  // year headers, never these short period labels).
  const headerRe = /^\|[^\n]*\b1M\b[^\n]*\b5Y\b[^\n]*$/m;
  const headerMatch = perfBody.match(headerRe);
  if (!headerMatch) return { ann1y: null, ann3y: null, ann5y: null, ann10y: null };

  // Walk forward to find the "| Fund |" row.
  const afterHeader = perfBody.slice(headerMatch.index! + headerMatch[0].length);
  const fundLineMatch = afterHeader.match(/\n\|\s*Fund\s*\|[^\n]+/);
  if (!fundLineMatch) return { ann1y: null, ann3y: null, ann5y: null, ann10y: null };

  const headerCells = headerMatch[0].split("|").map((c) => c.trim());
  const valueCells = fundLineMatch[0].split("|").map((c) => c.trim());
  const idxFor = (re: RegExp): number => headerCells.findIndex((c) => re.test(c));

  return {
    ann1y: num(valueCells[idxFor(/^1Y/i)] ?? null),
    ann3y: num(valueCells[idxFor(/^3Y/i)] ?? null),
    ann5y: num(valueCells[idxFor(/^5Y/i)] ?? null),
    ann10y: num(valueCells[idxFor(/^10Y/i)] ?? null),
  };
}

/**
 * Parse the per-period risk metrics table from the Risk and rating section.
 * Returns 3Y values (matches existing DB columns).
 */
function parseRiskMetrics(md: string): {
  sharpe3y: number | null;
  stddev3y: number | null;
  alpha3y: number | null;
  beta3y: number | null;
} {
  const body = sliceSection(md, /\n##\s+Risk and rating\s*\n/i);
  // Each row: "| {Label} | {1Y} | {3Y} | {5Y} |"
  const row = (label: RegExp): string[] => {
    const re = new RegExp(`\\|\\s*${label.source}\\s*\\|([^\\n]+)`, "i");
    const m = body.match(re);
    if (!m) return [];
    return m[1].split("|").map((c) => c.trim());
  };
  const sharpe = row(/Sharpe ratio/);
  const stddev = row(/Standard deviation \(%\)/);
  const alpha = row(/Alpha/);
  const beta = row(/Beta/);
  // Index 1 = 3 Years column (0 = 1 Year, 1 = 3 Years, 2 = 5 Years).
  return {
    sharpe3y: num(sharpe[1] ?? null),
    stddev3y: num(stddev[1] ?? null),
    alpha3y: num(alpha[1] ?? null),
    beta3y: num(beta[1] ?? null),
  };
}

function parseFees(md: string): {
  expenseRatio: number | null;
  managementFee: number | null;
} {
  const body = sliceSection(md, /\n##\s+Fees & Expenses\s*\n/i);
  const findRow = (label: RegExp): number | null => {
    const re = new RegExp(`\\|\\s*${label.source}\\s*\\|\\s*([^|\\n]+)`, "i");
    const m = body.match(re);
    return m ? num(m[1]) : null;
  };
  return {
    expenseRatio: findRow(/Ongoing Cost/),
    managementFee: findRow(/Management Fee/),
  };
}

/** Asset, geography, sector, holding allocation rows. */
function parseAllocations(md: string, asOf: string): NormalizedAllocation[] {
  const out: NormalizedAllocation[] = [];

  const portfolioBody = sliceSection(md, /\n##\s+Portfolio[^\n]*\n/i);

  // --- Asset allocation ---
  const assetTable = portfolioBody.match(
    /\|\s*Asset Allocation\s*\|[^\n]*\n\|\s*-+\s*\|[^\n]*\n([\s\S]*?)(?:\n\s*\n|ec-security|$)/i,
  );
  if (assetTable) {
    for (const line of assetTable[1].split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      // Expected: ["", label, weight, category, ""]
      if (cells.length < 4) continue;
      const label = cells[1];
      const w = num(cells[2]);
      if (!label || w == null) continue;
      out.push({ kind: "asset", label, weightPct: w, asOf });
    }
  }

  // --- Geographic regions ---
  const regionTable = portfolioBody.match(
    /\|\s*Region\s*\|[^\n]*\n\|\s*-+\s*\|[^\n]*\n([\s\S]*?)(?:\n\s*\n|ec-security|$)/i,
  );
  if (regionTable) {
    for (const line of regionTable[1].split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 4) continue;
      const label = cells[1];
      const w = num(cells[2]);
      if (!label || w == null) continue;
      out.push({ kind: "geography", label, weightPct: w, asOf });
    }
  }

  // --- Stock sectors: three sub-sections (Cyclical / Sensitive / Defensive) ---
  const sectorTableRe =
    /###\s+(?:Cyclical|Sensitive|Defensive)\s+%[\s\S]*?\|\s*\|\s*Weight %[^\n]*\n\|\s*-+\s*\|[^\n]*\n([\s\S]*?)(?:\n\s*\n|ec-security|$)/gi;
  let secMatch;
  while ((secMatch = sectorTableRe.exec(portfolioBody)) !== null) {
    for (const line of secMatch[1].split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 4) continue;
      const label = cells[1];
      const w = num(cells[2]);
      if (!label || w == null) continue;
      out.push({ kind: "sector", label, weightPct: w, asOf });
    }
  }

  // --- Top 10 holdings ---
  const holdingsTable = portfolioBody.match(
    /\|\s*\|\s*Security Name[^\n]*\n\|\s*-+\s*\|[^\n]*\n([\s\S]*?)(?:\n\s*\n|ec-security|$)/i,
  );
  if (holdingsTable) {
    for (const line of holdingsTable[1].split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      // Expected: ["", rank, name, sector, country, weight, ""]
      if (cells.length < 6) continue;
      const label = cells[2];
      const w = num(cells[5]);
      if (!label || w == null) continue;
      out.push({ kind: "holding", label, weightPct: w, asOf });
    }
  }

  return out;
}

function parseDocuments(md: string): NormalizedDocument[] {
  const body = sliceSection(md, /\n##\s+Documents\s*\n/i);
  if (!body) return [];
  const out: NormalizedDocument[] = [];
  const typeMap: { type: string; label: string; re: RegExp }[] = [
    { type: "factsheet", label: "Factsheet", re: /^\s*\|\s*Factsheet\s*\|/m },
    { type: "phs", label: "Product Highlight Sheet", re: /Product Highlight Sheet/i },
    { type: "prospectus", label: "Prospectus", re: /Prospectus|Fund Prospectus/i },
    { type: "fund_summary", label: "Fund Summary", re: /Fund Summary/i },
    { type: "annual", label: "Annual Report", re: /Annual Fund Report|Annual & Semi-annual Fund reports|^\s*\|\s*Annual Report/im },
    { type: "semi_annual", label: "Semi-Annual Report", re: /Semi[\s-]?Annual Fund Report/i },
  ];
  for (const t of typeMap) {
    if (t.re.test(body)) out.push({ type: t.type, label: t.label, sourceUrl: null });
  }
  return out;
}

function parseFundHouse(md: string): string | null {
  const body = sliceSection(md, /\n##\s+Fund Management\s*\n/i);
  if (!body) return null;
  const m = body.match(/(?:^|\n)Company name\s*\n+([^\n]+)/i);
  return m ? m[1].trim() : null;
}

function parseShareClassInception(md: string): string | null {
  const body = sliceSection(md, /\n##\s+Fund Management\s*\n/i);
  if (!body) return null;
  const m = body.match(/(?:^|\n)Fund launch date\s*\n+([^\n]+)/i);
  return m ? dmyToIso(m[1]) : null;
}

/** Asset class inference from the asset-allocation table — best-effort. */
function inferAssetClass(allocations: NormalizedAllocation[]): string | null {
  const assets = allocations.filter((a) => a.kind === "asset");
  if (assets.length === 0) return null;
  const top = assets.reduce((max, a) => (a.weightPct > max.weightPct ? a : max));
  const lc = top.label.toLowerCase();
  if (lc.includes("stock")) return "Equity";
  if (lc.includes("bond")) return "Fixed Income";
  if (lc.includes("cash")) return "Capital Preservation";
  return null;
}

export function parseMorningstarExpandedDetail(
  markdown: string,
  externalId: string,
  sourceUrl: string,
): ScrapedFund {
  const top = parseTopCard(markdown);
  const fundSizeInfo = parseFundSize(top.fundSizeRaw);
  const asOf = top.navDate ?? new Date().toISOString().slice(0, 10);
  const trailing = parseTrailingReturns(markdown);
  const risk = parseRiskMetrics(markdown);
  const fees = parseFees(markdown);
  const allocations = parseAllocations(markdown, asOf);
  const documents = parseDocuments(markdown);
  const fundHouse = parseFundHouse(markdown);
  const shareClassInception = parseShareClassInception(markdown);
  const objective = parseInvestmentObjective(markdown);
  const assetClass = inferAssetClass(allocations);

  const fund: NormalizedFund = {
    externalId,
    name: top.name ?? `(unknown — ${externalId})`,
    isin: top.isin,
    fundHouse,
    currency: top.currency,
    assetClass,
    distributionType: null,
    riskRating: null,
    riskLabel: null,
    shareClassInception,
    fundSize: fundSizeInfo.fundSize,
    fundSizeCurrency: fundSizeInfo.currency ?? top.currency,
    fundSizeAsOf: fundSizeInfo.asOf,
    dealingFrequency: null,
    benchmark: top.benchmark,
    sfdrClassification: null,
    expenseRatio: fees.expenseRatio,
    managementFee: fees.managementFee,
    morningstarRating: null,
    investmentObjective: objective,
    sourceUrl,
  };

  const snapshot: NormalizedSnapshot = {
    asOf,
    nav: top.nav,
    currency: top.currency,
    changePct: null,
    ann1y: trailing.ann1y,
    ann3y: trailing.ann3y,
    ann5y: trailing.ann5y,
    ann10y: trailing.ann10y,
    annSince: null,
    alpha3y: risk.alpha3y,
    beta3y: risk.beta3y,
    sharpe3y: risk.sharpe3y,
    stddev3y: risk.stddev3y,
  };

  return { fund, snapshot, allocations, documents, rawMarkdown: markdown };
}

// The click action that walks every leaf "Open" text node up to its
// click-handler ancestor and dispatches a click. Used as the action body
// in the Firecrawl scrape call for both FWD and TMLS detail pages.
export const EXPAND_ACCORDIONS_JS =
  "(function(){const all=Array.from(document.querySelectorAll('*'));const opens=all.filter(e=>{const t=(e.textContent||'').trim();return t==='Open'&&e.children.length===0;});opens.forEach(o=>{let n=o;while(n&&n!==document.body){if(n.onclick||n.getAttribute('role')==='button'||n.tagName==='BUTTON'||n.tagName==='A'){n.click();return;}n=n.parentElement;}o.click();});})();";

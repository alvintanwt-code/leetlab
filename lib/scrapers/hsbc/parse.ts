import type {
  NormalizedFund,
  NormalizedSnapshot,
  NormalizedAllocation,
  NormalizedDocument,
  ScrapedFund,
} from "../types";

const DETAIL_URL = (id: string) => `https://fundprices.insurance.hsbc.com.sg/detail?id=${id}`;

function pct(s: string | null | undefined): number | null {
  if (!s) return null;
  // HSBC uses real minus glyph ("−") and hyphen ("-"). Both should work.
  const m = s.replace(/−/g, "-").match(/[-+]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function num(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/[, ]/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function section(md: string, header: string, nextHeaders: string[] = []): string {
  const re = new RegExp(`##\\s+${header}([\\s\\S]*?)(?=##\\s+(?:${nextHeaders.join("|")})|$)`, "i");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

function parseAttributesRow(md: string): { currency: string | null; assetClass: string | null; distributionType: string | null; riskLabel: string | null; riskRating: number | null } {
  // Bullet list directly after fund house line, e.g.
  // - USD
  // - Equity
  // - Accumulating
  // - 3 - Balanced
  const bullets = md.match(/^- (.+)$/gm)?.slice(0, 4).map((b) => b.replace(/^- /, "").trim()) ?? [];
  const [currency, assetClass, distribution, risk] = bullets;
  let riskRating: number | null = null;
  let riskLabel: string | null = null;
  if (risk) {
    const rm = risk.match(/(\d)\s*-\s*(.+)/);
    if (rm) {
      riskRating = parseInt(rm[1], 10);
      riskLabel = rm[2].trim();
    }
  }
  const distMap: Record<string, string> = { Accumulating: "Acc", Distributing: "Dist" };
  return {
    currency: currency ?? null,
    assetClass: assetClass ?? null,
    distributionType: distribution ? (distMap[distribution] ?? distribution) : null,
    riskLabel,
    riskRating,
  };
}

function parseFundFacts(md: string): {
  isin: string | null;
  fundHouse: string | null;
  shareClassInception: string | null;
  fundSize: number | null;
  fundSizeCurrency: string | null;
  fundSizeAsOf: string | null;
  dealingFrequency: string | null;
  benchmark: string | null;
  sfdrClassification: string | null;
  morningstarRating: number | null;
} {
  const block = section(md, "Fund facts", ["Fees and charges", "Fund documents", "Disclaimer"]).replace(/\n+/g, " ");
  // Labels in the order they appear, glued directly to values with no separator.
  // Strategy: locate each label, slice the value as everything up to the next known label.
  const labels = [
    "Product risk rating",
    "Share class currency",
    "Share class inception date",
    "Fund size",
    "ISIN",
    "Dealing frequency",
    "Fund benchmark",
    "Fund house",
    "Morningstar Rating",
    "SFDR Classification",
  ];
  const positions: { label: string; start: number; end: number }[] = [];
  for (const label of labels) {
    const idx = block.indexOf(label);
    if (idx === -1) continue;
    positions.push({ label, start: idx, end: idx + label.length });
  }
  positions.sort((a, b) => a.start - b.start);
  const values: Record<string, string> = {};
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const nextStart = i + 1 < positions.length ? positions[i + 1].start : block.length;
    values[p.label] = block.slice(p.end, nextStart).trim();
  }

  // Fund size has its own internal structure: "(as of <date>) <CCY> <amount> <M|B>"
  let fundSize: number | null = null;
  let fundSizeCurrency: string | null = null;
  let fundSizeAsOf: string | null = null;
  if (values["Fund size"]) {
    const fsM = values["Fund size"].match(/\(as of\s*([^)]+)\)\s*([A-Z]{3})\s*([0-9.,]+)\s*([MB]?)/i);
    if (fsM) {
      fundSizeAsOf = fsM[1].trim();
      fundSizeCurrency = fsM[2];
      fundSize = parseFloat(fsM[3].replace(/,/g, ""));
      if (fsM[4] === "B") fundSize *= 1000;
    }
  }

  const msMatch = block.match(/\((\d)\s*Morningstar Rating\)/);
  const morningstarRating = msMatch ? parseInt(msMatch[1], 10) : null;

  // ISIN: 12 alphanumeric (LU0861579265 etc). Defensive: pick first ISIN-shaped token from the slice.
  const isinRaw = values["ISIN"] ?? "";
  const isinMatch = isinRaw.match(/^[A-Z]{2}[A-Z0-9]{9,10}/);
  const isin = isinMatch ? isinMatch[0] : null;

  return {
    isin,
    fundHouse: values["Fund house"]?.replace(/Morningstar.*$/, "").trim() || null,
    shareClassInception: values["Share class inception date"] || null,
    fundSize,
    fundSizeCurrency,
    fundSizeAsOf,
    dealingFrequency: values["Dealing frequency"] || null,
    benchmark: values["Fund benchmark"] || null,
    sfdrClassification: values["SFDR Classification"] || null,
    morningstarRating,
  };
}

function parseFees(md: string): { expenseRatio: number | null; managementFee: number | null } {
  const block = section(md, "Fees and charges", ["Fund documents", "Fund facts", "Disclaimer"]);
  const expense = block.match(/Expense Ratio\s*([0-9.]+)\s*%/i)?.[1];
  const mgmt = block.match(/Annual management fee\s*([0-9.]+)\s*%/i)?.[1];
  return {
    expenseRatio: expense ? parseFloat(expense) : null,
    managementFee: mgmt ? parseFloat(mgmt) : null,
  };
}

function parseObjective(md: string): string | null {
  const block = section(md, "Investment Objective", ["Annualised returns", "Allocations", "Performance", "Disclaimer"]);
  return block.trim() || null;
}

function parseAnnualisedReturns(md: string): { ann1y: number | null; ann3y: number | null; ann5y: number | null; ann10y: number | null } {
  const block = section(md, "Annualised returns", ["Allocations", "Performance", "Risk", "Fund facts", "Disclaimer"]);
  const get = (label: string) => {
    const m = block.match(new RegExp(`${label}\\s*\\*?\\*?\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*%`, "i"));
    return m ? parseFloat(m[1]) : null;
  };
  return {
    ann1y: get("1 year"),
    ann3y: get("3 years"),
    ann5y: get("5 years"),
    ann10y: get("10 years"),
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function dmyToIso(s: string): string | null {
  // "11 Jun 2026" → "2026-06-11"  (no timezone math; that flipped dates on UTC-X hosts)
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const mIdx = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
  if (mIdx < 0) return null;
  return `${m[3]}-${String(mIdx + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function parseNav(md: string): { nav: number | null; currency: string | null; asOf: string | null; changePct: number | null } {
  // Markdown looks like: **NAV (as of 11 Jun 2026) :** **USD 52.50**
  const m = md.match(/NAV\s*\(as of\s*([^)]+)\)\s*:[*\s]+([A-Z]{3})\s*([0-9.,]+)/i);
  if (!m) return { nav: null, currency: null, asOf: null, changePct: null };
  const asOfDate = m[1].trim();
  const iso = dmyToIso(asOfDate) ?? asOfDate;
  // Change% appears just after the NAV block on its own line.
  const navIdx = md.indexOf(m[0]) + m[0].length;
  const tail = md.slice(navIdx, navIdx + 200);
  const changeMatch = tail.match(/([-+−]?\d+(?:\.\d+)?)\s*%/);
  const changePct = changeMatch ? parseFloat(changeMatch[1].replace(/−/g, "-")) : null;
  return {
    nav: parseFloat(m[3].replace(/,/g, "")),
    currency: m[2],
    asOf: iso,
    changePct,
  };
}

function parseAllocations(md: string, asOf: string): NormalizedAllocation[] {
  const out: NormalizedAllocation[] = [];
  const grabSection = (header: string, kind: NormalizedAllocation["kind"]) => {
    const re = new RegExp(`###\\s+${header}([\\s\\S]*?)(?=###|##|$)`, "i");
    const m = md.match(re);
    if (!m) return;
    const body = m[1];
    // Each entry looks like "Stock99.16%" or "Technology29.29%" — label glued to %.
    // Two tricky cases:
    //   "Asia - Developed3.25%"   → label "Asia - Developed", value +3.25
    //   "Cash-72.82%"             → label "Cash", value -72.82  (leveraged short)
    // Distinguish by whether the hyphen is space-surrounded (part of label) or
    // glued to the digits (sign).
    const entryRe =
      /([A-Za-z](?:[A-Za-z0-9 &/.()]|\s-\s)*?[A-Za-z0-9)])(-?)([0-9]+(?:\.[0-9]+)?)\s*%/g;
    let match;
    while ((match = entryRe.exec(body)) !== null) {
      const sign = match[2] === "-" ? -1 : 1;
      out.push({
        kind,
        label: match[1].trim(),
        weightPct: sign * parseFloat(match[3]),
        asOf,
      });
    }
  };
  grabSection("Asset Allocation", "asset");
  grabSection("Geographical Allocation", "geography");
  grabSection("Sector Allocation", "sector");
  // Top Holdings: similar pattern under "### Top Holdings"
  const topRe = /###\s+Top Holdings([\s\S]*?)(?=##|$)/i;
  const topMatch = md.match(topRe);
  if (topMatch) {
    const body = topMatch[1];
    const entryRe = /([A-Za-z0-9][^%\n]+?)([0-9]+(?:\.[0-9]+)?)\s*%/g;
    let m;
    while ((m = entryRe.exec(body)) !== null) {
      out.push({ kind: "holding", label: m[1].trim(), weightPct: parseFloat(m[2]), asOf });
    }
  }
  return out;
}

function parseDocuments(md: string): NormalizedDocument[] {
  const block = section(md, "Fund documents", ["Disclaimer"]);
  if (!block) return [];
  const docs: NormalizedDocument[] = [];
  const docTypes = [
    { type: "factsheet", label: "Factsheet", match: /^Factsheet/im },
    { type: "factsheet_zh", label: "Chinese Factsheet", match: /Chinese Factsheet/i },
    { type: "phs", label: "Product Highlight Sheet", match: /Product Highlight Sheet/i },
    { type: "semi_annual", label: "Semi-Annual Report", match: /Semi-?Annual Report/i },
    { type: "annual", label: "Annual Report", match: /Annual Report/i },
    { type: "prospectus", label: "Prospectus", match: /Prospectus/i },
  ];
  for (const d of docTypes) {
    if (d.match.test(block)) {
      // Download URL is JS-driven; not in markdown. Leave null for now; factsheet proxy resolves later.
      docs.push({ type: d.type, label: d.label, sourceUrl: null });
    }
  }
  return docs;
}

function parseName(md: string): string | null {
  // The fund name is the first H1 after "Back to Fund library" line
  const m = md.match(/Back to Fund library\s*\n+#\s+(.+?)\n/);
  if (m) return m[1].trim();
  // Fallback: first H1
  const m2 = md.match(/^#\s+(.+?)$/m);
  return m2 ? m2[1].trim() : null;
}

export function parseDetail(markdown: string, externalId: string): ScrapedFund {
  const name = parseName(markdown);
  const attrs = parseAttributesRow(markdown);
  const facts = parseFundFacts(markdown);
  const fees = parseFees(markdown);
  const objective = parseObjective(markdown);
  const annual = parseAnnualisedReturns(markdown);
  const nav = parseNav(markdown);
  const docs = parseDocuments(markdown);
  const allocAsOf = nav.asOf ?? new Date().toISOString().slice(0, 10);
  const allocations = parseAllocations(markdown, allocAsOf);

  const fund: NormalizedFund = {
    externalId,
    name: name ?? `(unknown — ${externalId})`,
    isin: facts.isin,
    fundHouse: facts.fundHouse,
    currency: attrs.currency,
    assetClass: attrs.assetClass,
    distributionType: attrs.distributionType,
    riskRating: attrs.riskRating,
    riskLabel: attrs.riskLabel,
    shareClassInception: facts.shareClassInception,
    fundSize: facts.fundSize,
    fundSizeCurrency: facts.fundSizeCurrency,
    fundSizeAsOf: facts.fundSizeAsOf,
    dealingFrequency: facts.dealingFrequency,
    benchmark: facts.benchmark,
    sfdrClassification: facts.sfdrClassification,
    expenseRatio: fees.expenseRatio,
    managementFee: fees.managementFee,
    morningstarRating: facts.morningstarRating,
    investmentObjective: objective,
    sourceUrl: DETAIL_URL(externalId),
  };

  const snapshot: NormalizedSnapshot = {
    asOf: nav.asOf ?? new Date().toISOString().slice(0, 10),
    nav: nav.nav,
    currency: nav.currency,
    changePct: nav.changePct,
    ann1y: annual.ann1y,
    ann3y: annual.ann3y,
    ann5y: annual.ann5y,
    ann10y: annual.ann10y,
    annSince: null,
    alpha3y: null,
    beta3y: null,
    sharpe3y: null,
    stddev3y: null,
  };

  return {
    fund,
    snapshot,
    allocations,
    documents: docs,
    rawMarkdown: markdown,
  };
}

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "./client";
import { sql, type SQL } from "drizzle-orm";

// In-scope allowlist per provider (e.g. HSBC's 92 funds across the Wealth
// Voyage product range). Cached on first read; same file is re-checked across
// requests since Node module-level state persists in the server runtime.
const ALLOWLIST_CACHE = new Map<string, string[] | null>();

function loadInScopeAllowlist(providerSlug: string): string[] | null {
  if (ALLOWLIST_CACHE.has(providerSlug)) return ALLOWLIST_CACHE.get(providerSlug) ?? null;
  const file = join(process.cwd(), "data", "in-scope", `${providerSlug}.json`);
  if (!existsSync(file)) {
    ALLOWLIST_CACHE.set(providerSlug, null);
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { isins?: string[] };
    const isins = Array.isArray(parsed.isins) ? parsed.isins : null;
    ALLOWLIST_CACHE.set(providerSlug, isins);
    return isins;
  } catch {
    ALLOWLIST_CACHE.set(providerSlug, null);
    return null;
  }
}

// Drizzle's neon-http `.execute()` returns a pg-style { rows, rowCount, … } object.
// Wrap it so call-sites get a plain array regardless of underlying driver shape.
async function q<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const r = await db().execute(query);
  return (Array.isArray(r) ? r : (r as unknown as { rows: T[] }).rows) as T[];
}

export type FundListRow = {
  id: number;
  external_id: string;
  name: string;
  isin: string | null;
  fund_house: string | null;
  currency: string | null;
  asset_class: string | null;
  distribution_type: string | null;
  risk_rating: number | null;
  nav: number | null;
  nav_as_of: string | null;
  ann_3y: number | null;
  ann_5y: number | null;
  ann_10y: number | null;
};

export async function listFundsForProvider(slug: string): Promise<FundListRow[]> {
  return q<FundListRow>(sql`
    SELECT f.id, f.external_id, f.name, f.isin, f.fund_house, f.currency, f.asset_class,
           f.distribution_type, f.risk_rating,
           s.nav, s.as_of AS nav_as_of, s.ann_3y, s.ann_5y, s.ann_10y
    FROM funds f
    JOIN providers p ON p.id = f.provider_id
    LEFT JOIN LATERAL (
      SELECT nav, as_of, ann_3y, ann_5y, ann_10y FROM fund_snapshots
      WHERE fund_id = f.id ORDER BY as_of DESC LIMIT 1
    ) s ON true
    WHERE p.slug = ${slug}
    ORDER BY f.name
  `);
}

export async function providerStats(slug: string): Promise<{ fundCount: number; lastScrapedAt: string | null }> {
  const rows = await q<{ fund_count: number; last_scraped: string | null }>(sql`
    SELECT COUNT(*)::int AS fund_count, MAX(last_scraped_at)::text AS last_scraped
    FROM funds f JOIN providers p ON p.id = f.provider_id
    WHERE p.slug = ${slug}
  `);
  const r = rows[0] ?? { fund_count: 0, last_scraped: null };
  return { fundCount: r.fund_count, lastScrapedAt: r.last_scraped };
}

export type FundDetail = {
  id: number;
  external_id: string;
  name: string;
  isin: string | null;
  fund_house: string | null;
  currency: string | null;
  asset_class: string | null;
  distribution_type: string | null;
  risk_rating: number | null;
  risk_label: string | null;
  share_class_inception: string | null;
  fund_size: number | null;
  fund_size_currency: string | null;
  fund_size_as_of: string | null;
  dealing_frequency: string | null;
  benchmark: string | null;
  sfdr_classification: string | null;
  expense_ratio: number | null;
  management_fee: number | null;
  morningstar_rating: number | null;
  investment_objective: string | null;
  source_url: string;
  last_scraped_at: string | null;
};

export async function getFundByExternalId(providerSlug: string, externalId: string): Promise<FundDetail | null> {
  const rows = await q<FundDetail>(sql`
    SELECT f.id, f.external_id, f.name, f.isin, f.fund_house, f.currency, f.asset_class,
           f.distribution_type, f.risk_rating, f.risk_label, f.share_class_inception,
           f.fund_size, f.fund_size_currency, f.fund_size_as_of, f.dealing_frequency,
           f.benchmark, f.sfdr_classification, f.expense_ratio, f.management_fee,
           f.morningstar_rating, f.investment_objective, f.source_url,
           f.last_scraped_at::text AS last_scraped_at
    FROM funds f
    JOIN providers p ON p.id = f.provider_id
    WHERE p.slug = ${providerSlug} AND f.external_id = ${externalId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export type FundSnapshot = {
  as_of: string;
  nav: number | null;
  currency: string | null;
  change_pct: number | null;
  ann_1y: number | null;
  ann_3y: number | null;
  ann_5y: number | null;
  ann_10y: number | null;
};

export async function getLatestSnapshot(fundId: number): Promise<FundSnapshot | null> {
  const rows = await q<FundSnapshot>(sql`
    SELECT as_of, nav, currency, change_pct, ann_1y, ann_3y, ann_5y, ann_10y
    FROM fund_snapshots
    WHERE fund_id = ${fundId}
    ORDER BY as_of DESC LIMIT 1
  `);
  return rows[0] ?? null;
}

export type FundAllocation = {
  kind: "asset" | "geography" | "sector" | "holding";
  label: string;
  weight_pct: number;
  as_of: string;
};

export async function getAllocations(fundId: number): Promise<FundAllocation[]> {
  return q<FundAllocation>(sql`
    SELECT kind, label, weight_pct, as_of
    FROM fund_allocations
    WHERE fund_id = ${fundId}
    ORDER BY kind, weight_pct DESC
  `);
}

export type FundDocument = {
  type: string;
  label: string;
  source_url: string | null;
};

export async function getDocuments(fundId: number): Promise<FundDocument[]> {
  return q<FundDocument>(sql`
    SELECT type, label, source_url FROM fund_documents
    WHERE fund_id = ${fundId} ORDER BY id
  `);
}

export type FundPickerRow = {
  id: number;
  external_id: string;
  name: string;
  isin: string | null;
  fund_house: string | null;
  currency: string | null;
  asset_class: string | null;
  risk_rating: number | null;
  expense_ratio: number | null;
  nav: number | null;
  ann_1y: number | null;
  ann_3y: number | null;
  ann_5y: number | null;
  ann_10y: number | null;
};

export async function listFundsForPicker(providerSlug: string): Promise<FundPickerRow[]> {
  const allowlist = loadInScopeAllowlist(providerSlug);
  if (allowlist && allowlist.length > 0) {
    // Use string_to_array to feed a parameter-bound text array into ANY()
    // — passing a JS array directly through Drizzle's sql tag gets boxed as
    // a record (composite type) and Postgres can't cast it to text[].
    const joined = allowlist.join("\x1f"); // unit separator — safe vs ISINs
    return q<FundPickerRow>(sql`
      SELECT f.id, f.external_id, f.name, f.isin, f.fund_house, f.currency, f.asset_class, f.risk_rating,
             f.expense_ratio, s.nav, s.ann_1y, s.ann_3y, s.ann_5y, s.ann_10y
      FROM funds f
      JOIN providers p ON p.id = f.provider_id
      LEFT JOIN LATERAL (
        SELECT nav, ann_1y, ann_3y, ann_5y, ann_10y FROM fund_snapshots
        WHERE fund_id = f.id ORDER BY as_of DESC LIMIT 1
      ) s ON true
      WHERE p.slug = ${providerSlug}
        AND f.isin = ANY(string_to_array(${joined}, E'\x1f'))
      ORDER BY f.name
    `);
  }
  return q<FundPickerRow>(sql`
    SELECT f.id, f.external_id, f.name, f.isin, f.fund_house, f.currency, f.asset_class, f.risk_rating,
           f.expense_ratio, s.nav, s.ann_1y, s.ann_3y, s.ann_5y, s.ann_10y
    FROM funds f
    JOIN providers p ON p.id = f.provider_id
    LEFT JOIN LATERAL (
      SELECT nav, ann_1y, ann_3y, ann_5y, ann_10y FROM fund_snapshots
      WHERE fund_id = f.id ORDER BY as_of DESC LIMIT 1
    ) s ON true
    WHERE p.slug = ${providerSlug}
    ORDER BY f.name
  `);
}

export type AllocationByFund = Record<number, {
  asset: { label: string; weight_pct: number }[];
  geography: { label: string; weight_pct: number }[];
  sector: { label: string; weight_pct: number }[];
}>;

export async function allocationsForProviderFunds(providerSlug: string): Promise<AllocationByFund> {
  const rows = await q<{ fund_id: number; kind: keyof AllocationByFund[number]; label: string; weight_pct: number }>(sql`
    SELECT a.fund_id, a.kind, a.label, a.weight_pct
    FROM fund_allocations a
    JOIN funds f ON f.id = a.fund_id
    JOIN providers p ON p.id = f.provider_id
    WHERE p.slug = ${providerSlug} AND a.kind IN ('asset','geography','sector')
  `);
  const out: AllocationByFund = {};
  for (const r of rows) {
    if (!out[r.fund_id]) out[r.fund_id] = { asset: [], geography: [], sector: [] };
    out[r.fund_id][r.kind].push({ label: r.label, weight_pct: r.weight_pct });
  }
  return out;
}

export async function countConfirmedPortfolios(providerSlug: string): Promise<number> {
  const rows = await q<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM model_portfolios mp
    JOIN providers p ON p.id = mp.provider_id
    WHERE p.slug = ${providerSlug} AND mp.status = 'confirmed'
  `);
  return rows[0]?.n ?? 0;
}

export type ProviderRow = {
  slug: string;
  name: string;
  fund_count: number;
  confirmed_count: number;
};

export async function listProvidersWithCounts(): Promise<ProviderRow[]> {
  const rows = await q<ProviderRow>(sql`
    SELECT
      p.slug,
      p.name,
      (SELECT COUNT(*)::int FROM funds WHERE provider_id = p.id) AS fund_count,
      (SELECT COUNT(*)::int FROM model_portfolios mp WHERE mp.provider_id = p.id AND mp.status = 'confirmed') AS confirmed_count
    FROM providers p
    ORDER BY p.id
  `);
  // Re-count for providers with an in-scope allowlist so the platform tab
  // shows the in-scope universe (e.g. HSBC's 92 funds), not the full sync.
  const out: ProviderRow[] = [];
  for (const r of rows) {
    const allowlist = loadInScopeAllowlist(r.slug);
    if (allowlist && allowlist.length > 0) {
      const joined = allowlist.join("\x1f");
      const scoped = await q<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n
        FROM funds f
        JOIN providers p ON p.id = f.provider_id
        WHERE p.slug = ${r.slug}
          AND f.isin = ANY(string_to_array(${joined}, E'\x1f'))
      `);
      out.push({ ...r, fund_count: scoped[0]?.n ?? 0 });
    } else {
      out.push(r);
    }
  }
  return out;
}

export type FundInspectorData = {
  id: number;
  external_id: string;
  name: string;
  isin: string | null;
  fund_house: string | null;
  currency: string | null;
  asset_class: string | null;
  distribution_type: string | null;
  risk_rating: number | null;
  risk_label: string | null;
  share_class_inception: string | null;
  fund_size: number | null;
  fund_size_currency: string | null;
  dealing_frequency: string | null;
  benchmark: string | null;
  sfdr_classification: string | null;
  expense_ratio: number | null;
  management_fee: number | null;
  morningstar_rating: number | null;
  investment_objective: string | null;
  nav: number | null;
  nav_as_of: string | null;
  change_pct: number | null;
  ann_1y: number | null;
  ann_3y: number | null;
  ann_5y: number | null;
  ann_10y: number | null;
  stddev_3y: number | null;
  ytd: number | null;
};

export async function fundsInspectorForProvider(providerSlug: string): Promise<FundInspectorData[]> {
  const allowlist = loadInScopeAllowlist(providerSlug);
  if (allowlist && allowlist.length > 0) {
    const joined = allowlist.join("\x1f");
    return q<FundInspectorData>(sql`
      SELECT
        f.id, f.external_id, f.name, f.isin, f.fund_house, f.currency, f.asset_class,
        f.distribution_type, f.risk_rating, f.risk_label, f.share_class_inception,
        f.fund_size, f.fund_size_currency, f.dealing_frequency, f.benchmark,
        f.sfdr_classification, f.expense_ratio, f.management_fee,
        f.morningstar_rating, f.investment_objective,
        s.nav, s.as_of AS nav_as_of, s.change_pct, s.ytd,
        s.ann_1y, s.ann_3y, s.ann_5y, s.ann_10y, s.stddev_3y
      FROM funds f
      JOIN providers p ON p.id = f.provider_id
      LEFT JOIN LATERAL (
        SELECT nav, as_of, change_pct, ytd, ann_1y, ann_3y, ann_5y, ann_10y, stddev_3y
        FROM fund_snapshots WHERE fund_id = f.id ORDER BY as_of DESC LIMIT 1
      ) s ON true
      WHERE p.slug = ${providerSlug}
        AND f.isin = ANY(string_to_array(${joined}, E'\x1f'))
      ORDER BY f.name
    `);
  }
  return q<FundInspectorData>(sql`
    SELECT
      f.id, f.external_id, f.name, f.isin, f.fund_house, f.currency, f.asset_class,
      f.distribution_type, f.risk_rating, f.risk_label, f.share_class_inception,
      f.fund_size, f.fund_size_currency, f.dealing_frequency, f.benchmark,
      f.sfdr_classification, f.expense_ratio, f.management_fee,
      f.morningstar_rating, f.investment_objective,
      s.nav, s.as_of AS nav_as_of, s.change_pct, s.ytd,
      s.ann_1y, s.ann_3y, s.ann_5y, s.ann_10y, s.stddev_3y
    FROM funds f
    JOIN providers p ON p.id = f.provider_id
    LEFT JOIN LATERAL (
      SELECT nav, as_of, change_pct, ytd, ann_1y, ann_3y, ann_5y, ann_10y, stddev_3y
      FROM fund_snapshots WHERE fund_id = f.id ORDER BY as_of DESC LIMIT 1
    ) s ON true
    WHERE p.slug = ${providerSlug}
    ORDER BY f.name
  `);
}

export type AllocationDetail = {
  fund_id: number;
  kind: "asset" | "geography" | "sector" | "holding";
  label: string;
  weight_pct: number;
};

export async function allocationsForFundIds(fundIds: number[]): Promise<AllocationDetail[]> {
  if (fundIds.length === 0) return [];
  // Drizzle's tagged template unpacks a JS array into positional params, so
  // `= ANY(${fundIds})` becomes `= ANY($1,$2,…)` which is a syntax error.
  // Rewriting the id list as a SQL-side ARRAY[…] literal side-steps that.
  // Guard against injection by keeping only finite integers.
  const clean = fundIds.filter((id) => Number.isInteger(id) && id > 0);
  if (clean.length === 0) return [];
  return q<AllocationDetail>(sql`
    SELECT fund_id, kind, label, weight_pct
    FROM fund_allocations
    WHERE fund_id = ANY(ARRAY[${sql.raw(clean.join(","))}])
    ORDER BY fund_id, kind, weight_pct DESC
  `);
}

export async function detailedAllocationsForProvider(providerSlug: string): Promise<AllocationDetail[]> {
  return q<AllocationDetail>(sql`
    SELECT a.fund_id, a.kind, a.label, a.weight_pct
    FROM fund_allocations a
    JOIN funds f ON f.id = a.fund_id
    JOIN providers p ON p.id = f.provider_id
    WHERE p.slug = ${providerSlug}
    ORDER BY a.fund_id, a.kind, a.weight_pct DESC
  `);
}

export async function documentsForProvider(providerSlug: string): Promise<{ fund_id: number; type: string; label: string }[]> {
  return q<{ fund_id: number; type: string; label: string }>(sql`
    SELECT d.fund_id, d.type, d.label
    FROM fund_documents d
    JOIN funds f ON f.id = d.fund_id
    JOIN providers p ON p.id = f.provider_id
    WHERE p.slug = ${providerSlug}
    ORDER BY d.fund_id, d.id
  `);
}

export async function countAllConfirmedPortfolios(): Promise<number> {
  const rows = await q<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM model_portfolios WHERE status = 'confirmed'
  `);
  return rows[0]?.n ?? 0;
}

export type ConfirmedPortfolio = {
  id: number;
  provider_slug: string;
  provider_name: string;
  category: string;
  name: string;
  version: number;
  notes: string | null;
  confirmed_at: string | null;
  holding_count: number;
  xray_json: string | null;
};

export async function listConfirmedPortfolios(): Promise<ConfirmedPortfolio[]> {
  return q<ConfirmedPortfolio>(sql`
    SELECT mp.id, p.slug AS provider_slug, p.name AS provider_name,
           mp.category, mp.name, mp.version, mp.notes,
           mp.confirmed_at::text AS confirmed_at, mp.xray_json,
           (SELECT COUNT(*)::int FROM model_portfolio_holdings h WHERE h.portfolio_id = mp.id) AS holding_count
    FROM model_portfolios mp
    JOIN providers p ON p.id = mp.provider_id
    WHERE mp.status = 'confirmed'
    ORDER BY mp.confirmed_at DESC NULLS LAST, mp.id DESC
  `);
}

export type ConfirmedPortfolioHolding = {
  weight_bps: number;
  fund_id: number;
  external_id: string;
  name: string;
  isin: string | null;
  fund_house: string | null;
  currency: string | null;
  asset_class: string | null;
  risk_rating: number | null;
  expense_ratio: number | null;
  nav: number | null;
  ytd: number | null;
  ann_1y: number | null;
  ann_3y: number | null;
  ann_5y: number | null;
  ann_10y: number | null;
  stddev_3y: number | null;
};

export async function getConfirmedPortfolio(id: number): Promise<ConfirmedPortfolio | null> {
  const rows = await q<ConfirmedPortfolio>(sql`
    SELECT mp.id, p.slug AS provider_slug, p.name AS provider_name,
           mp.category, mp.name, mp.version, mp.notes,
           mp.confirmed_at::text AS confirmed_at, mp.xray_json,
           (SELECT COUNT(*)::int FROM model_portfolio_holdings h WHERE h.portfolio_id = mp.id) AS holding_count
    FROM model_portfolios mp
    JOIN providers p ON p.id = mp.provider_id
    WHERE mp.id = ${id} AND mp.status = 'confirmed'
    LIMIT 1
  `);
  return rows[0] ?? null;
}

// ─── Factsheet archive ─────────────────────────────────────────
// One-row-per-portfolio-per-month store of frozen fact-sheet HTML.
// Populated by the /api/factsheets/generate cron on the 4th of every
// month for the prior full month.

export type FactsheetRow = {
  id: number;
  portfolio_id: number;
  as_of_month: string; // YYYY-MM
  html_content: string;
  generated_at: string;
};

export async function getLatestFactsheet(portfolioId: number): Promise<FactsheetRow | null> {
  const rows = await q<FactsheetRow>(sql`
    SELECT id, portfolio_id, as_of_month, html_content, generated_at::text
    FROM portfolio_factsheets
    WHERE portfolio_id = ${portfolioId}
    ORDER BY as_of_month DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function getFactsheetByMonth(portfolioId: number, asOfMonth: string): Promise<FactsheetRow | null> {
  const rows = await q<FactsheetRow>(sql`
    SELECT id, portfolio_id, as_of_month, html_content, generated_at::text
    FROM portfolio_factsheets
    WHERE portfolio_id = ${portfolioId} AND as_of_month = ${asOfMonth}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function insertFactsheet(portfolioId: number, asOfMonth: string, html: string): Promise<{ id: number; inserted: boolean }> {
  const rows = await q<{ id: number }>(sql`
    INSERT INTO portfolio_factsheets (portfolio_id, as_of_month, html_content)
    VALUES (${portfolioId}, ${asOfMonth}, ${html})
    ON CONFLICT (portfolio_id, as_of_month) DO NOTHING
    RETURNING id
  `);
  if (rows[0]) return { id: rows[0].id, inserted: true };
  const existing = await getFactsheetByMonth(portfolioId, asOfMonth);
  return { id: existing?.id ?? -1, inserted: false };
}

export async function listConfirmedPortfolioIds(): Promise<{ id: number; slug: string; name: string }[]> {
  return q<{ id: number; slug: string; name: string }>(sql`
    SELECT mp.id, p.slug, mp.name
    FROM model_portfolios mp
    JOIN providers p ON p.id = mp.provider_id
    WHERE mp.status = 'confirmed'
    ORDER BY mp.id
  `);
}

export async function getPortfolioHoldings(portfolioId: number): Promise<ConfirmedPortfolioHolding[]> {
  return q<ConfirmedPortfolioHolding>(sql`
    SELECT h.weight_bps,
           f.id AS fund_id, f.external_id, f.name, f.isin, f.fund_house, f.currency,
           f.asset_class, f.risk_rating, f.expense_ratio,
           s.nav, s.ytd, s.ann_1y, s.ann_3y, s.ann_5y, s.ann_10y, s.stddev_3y
    FROM model_portfolio_holdings h
    JOIN funds f ON f.id = h.fund_id
    LEFT JOIN LATERAL (
      SELECT nav, ytd, ann_1y, ann_3y, ann_5y, ann_10y, stddev_3y FROM fund_snapshots
      WHERE fund_id = f.id ORDER BY as_of DESC LIMIT 1
    ) s ON true
    WHERE h.portfolio_id = ${portfolioId}
    ORDER BY h.weight_bps DESC
  `);
}

import { pgTable, serial, integer, text, real, timestamp, unique, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* =========================================================
 * Domain tables — mirror current SQLite schema, Postgres-flavoured
 * ========================================================= */

export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sourceUrl: text("source_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const portfolioFactsheets = pgTable(
  "portfolio_factsheets",
  {
    id: serial("id").primaryKey(),
    // Note: FK target `modelPortfolios` is defined further down; drizzle
    // resolves this reference lazily via the callback form.
    portfolioId: integer("portfolio_id").notNull(),
    asOfMonth: text("as_of_month").notNull(), // YYYY-MM
    htmlContent: text("html_content").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqPortfolioMonth: unique("portfolio_factsheets_portfolio_month_key").on(t.portfolioId, t.asOfMonth),
  }),
);

export const funds = pgTable(
  "funds",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .references(() => providers.id, { onDelete: "cascade" })
      .notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    isin: text("isin"),
    fundHouse: text("fund_house"),
    currency: text("currency"),
    assetClass: text("asset_class"),
    distributionType: text("distribution_type"),
    riskRating: integer("risk_rating"),
    riskLabel: text("risk_label"),
    shareClassInception: text("share_class_inception"),
    fundSize: real("fund_size"),
    fundSizeCurrency: text("fund_size_currency"),
    fundSizeAsOf: text("fund_size_as_of"),
    dealingFrequency: text("dealing_frequency"),
    benchmark: text("benchmark"),
    sfdrClassification: text("sfdr_classification"),
    expenseRatio: real("expense_ratio"),
    managementFee: real("management_fee"),
    morningstarRating: integer("morningstar_rating"),
    investmentObjective: text("investment_objective"),
    status: text("status").default("active").notNull(),
    sourceUrl: text("source_url").notNull(),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  },
  (t) => ({
    uniqProviderExternal: unique("funds_provider_external_idx").on(t.providerId, t.externalId),
  }),
);

export const fundSnapshots = pgTable(
  "fund_snapshots",
  {
    id: serial("id").primaryKey(),
    fundId: integer("fund_id")
      .references(() => funds.id, { onDelete: "cascade" })
      .notNull(),
    asOf: text("as_of").notNull(),
    nav: real("nav"),
    currency: text("currency"),
    changePct: real("change_pct"),
    ytd: real("ytd"),
    ann1y: real("ann_1y"),
    ann3y: real("ann_3y"),
    ann5y: real("ann_5y"),
    ann10y: real("ann_10y"),
    annSince: real("ann_since"),
    alpha3y: real("alpha_3y"),
    beta3y: real("beta_3y"),
    sharpe3y: real("sharpe_3y"),
    stddev3y: real("stddev_3y"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqFundAsOf: unique("fund_snapshots_fund_asof_idx").on(t.fundId, t.asOf),
  }),
);

export const fundAllocations = pgTable("fund_allocations", {
  id: serial("id").primaryKey(),
  fundId: integer("fund_id").references(() => funds.id, { onDelete: "cascade" }).notNull(),
  asOf: text("as_of").notNull(),
  kind: text("kind").notNull(), // 'asset' | 'geography' | 'sector' | 'holding'
  label: text("label").notNull(),
  weightPct: real("weight_pct").notNull(),
});

export const fundDocuments = pgTable(
  "fund_documents",
  {
    id: serial("id").primaryKey(),
    fundId: integer("fund_id").references(() => funds.id, { onDelete: "cascade" }).notNull(),
    type: text("type").notNull(),
    label: text("label").notNull(),
    sourceUrl: text("source_url"),
    localPath: text("local_path"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (t) => ({
    uniqFundType: unique("fund_documents_fund_type_idx").on(t.fundId, t.type),
  }),
);

export const modelPortfolios = pgTable(
  "model_portfolios",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" }).notNull(),
    category: text("category").notNull(), // conservative|balanced|growth|aggressive|dividend_income
    name: text("name").notNull(),
    version: integer("version").default(1).notNull(),
    status: text("status").default("draft").notNull(), // draft|confirmed|archived
    notes: text("notes"),
    xrayJson: text("xray_json"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: text("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => ({
    uniqProviderCategoryNameVersion: unique("model_portfolios_p_c_n_v_idx").on(
      t.providerId,
      t.category,
      t.name,
      t.version,
    ),
  }),
);

export const modelPortfolioHoldings = pgTable(
  "model_portfolio_holdings",
  {
    id: serial("id").primaryKey(),
    portfolioId: integer("portfolio_id").references(() => modelPortfolios.id, { onDelete: "cascade" }).notNull(),
    fundId: integer("fund_id").references(() => funds.id).notNull(),
    weightBps: integer("weight_bps").notNull(),
  },
  (t) => ({
    uniqPortfolioFund: unique("mph_portfolio_fund_idx").on(t.portfolioId, t.fundId),
  }),
);

/* =========================================================
 * Auth.js (NextAuth v5) standard adapter tables
 * Drizzle adapter expects exactly this shape.
 * ========================================================= */

export const users = pgTable("user", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { withTimezone: true }),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (a) => ({
    pk: primaryKey({ columns: [a.provider, a.providerAccountId] }),
  }),
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

/* Type helpers */
export type Fund = typeof funds.$inferSelect;
export type NewFund = typeof funds.$inferInsert;
export type FundSnapshot = typeof fundSnapshots.$inferSelect;
export type FundAllocation = typeof fundAllocations.$inferSelect;
export type FundDocument = typeof fundDocuments.$inferSelect;
export type ModelPortfolio = typeof modelPortfolios.$inferSelect;
export type User = typeof users.$inferSelect;

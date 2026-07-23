/**
 * One-shot script: upsert the 16 HSBC funds that were missing from the DB
 * (12 SG-coded UOB/Schroder/Fullerton, 1 Ascend Asia, 2 FAM funds that
 * Morningstar's snapshot endpoint can't enrich, plus 1 IE Loomis Sayles
 * which Morningstar CAN enrich but wasn't in our seed previously).
 *
 * Data sources (per fund):
 *   - HSBC fund-centre scrape (name, fund house, currency, asset class,
 *     distribution, risk rating, NAV, NAV date, 3Y/5Y/10Y/since-launch
 *     returns) for 14 of 16
 *   - HTML-embedded data from the Studio prototype (1Y annualised
 *     return for all 16, plus name + asset class for 2 FAM funds where
 *     HSBC's search didn't return a match — likely delisted or renamed)
 *
 * Run once: `npm run upsert-hsbc-missing`
 * Idempotent: re-running upserts same data, no duplicates.
 */
import { config } from "dotenv";
import { join } from "node:path";
import { readFileSync } from "node:fs";
config({ path: join(process.cwd(), ".env.local") });
import { db } from "../lib/db/client";
import { sql } from "drizzle-orm";
import { getProviderId, upsertFund, upsertSnapshot } from "../lib/db/repo";
import type { NormalizedFund, NormalizedSnapshot } from "../lib/scrapers/types";

type MissingFundRecord = {
  isin: string;
  externalId: string;
  name: string;
  fundHouse: string | null;
  currency: string | null;
  assetClass: string | null;
  distributionType: string | null;
  riskRating: number | null;
  nav: number | null;
  navAsOf: string | null;
  ann1y: number | null;
  ann3y: number | null;
  ann5y: number | null;
  ann10y: number | null;
  source: string;
};

const RISK_LABELS: { [k: number]: string } = {
  1: "Very Low",
  2: "Low",
  3: "Below Average",
  4: "Balanced",
  5: "Above Average",
};

async function main() {
  const file = join(process.cwd(), "data/seed/hsbc-missing-16.json");
  const records = JSON.parse(readFileSync(file, "utf8")) as MissingFundRecord[];
  console.log(`Loaded ${records.length} records to upsert`);

  const providerId = await getProviderId("hsbc");
  console.log(`HSBC provider_id = ${providerId}`);

  const HSBC_DETAIL = (id: string) => `https://fundprices.insurance.hsbc.com.sg/detail?id=${id}`;

  let ok = 0;
  let failed = 0;
  for (const r of records) {
    try {
      const fund: NormalizedFund = {
        externalId: r.externalId,
        name: r.name,
        isin: r.isin,
        fundHouse: r.fundHouse,
        currency: r.currency,
        assetClass: r.assetClass,
        distributionType: r.distributionType,
        riskRating: r.riskRating,
        riskLabel: r.riskRating != null ? RISK_LABELS[r.riskRating] ?? null : null,
        shareClassInception: null,
        fundSize: null,
        fundSizeCurrency: null,
        fundSizeAsOf: null,
        dealingFrequency: null,
        benchmark: null,
        sfdrClassification: null,
        expenseRatio: null,
        managementFee: null,
        morningstarRating: null,
        investmentObjective: null,
        sourceUrl: HSBC_DETAIL(r.externalId),
      };
      const fundId = await upsertFund(providerId, fund);

      // Only upsert a snapshot if we have at least one useful number
      if (r.nav != null || r.ann1y != null || r.ann3y != null) {
        const snapshot: NormalizedSnapshot = {
          asOf: r.navAsOf ?? new Date().toISOString().slice(0, 10),
          nav: r.nav,
          currency: r.currency,
          changePct: null,
          ytd: null,
          ann1y: r.ann1y,
          ann3y: r.ann3y,
          ann5y: r.ann5y,
          ann10y: r.ann10y,
          annSince: null,
          alpha3y: null,
          beta3y: null,
          sharpe3y: null,
          stddev3y: null,
        };
        await upsertSnapshot(fundId, snapshot);
      }

      ok++;
      console.log(
        `  [${ok + failed}/${records.length}] [${r.source}] ${r.isin} → fund_id=${fundId} · ${r.name.slice(0, 50)}`,
      );
    } catch (e) {
      failed++;
      console.error(`  [${ok + failed}/${records.length}] ${r.isin} FAILED: ${(e as Error).message}`);
    }
  }
  console.log(`\n✓ upserted ${ok}/${records.length} (${failed} failed)`);

  // Verify
  const r = await db().execute(sql`
    SELECT COUNT(*)::int AS n
    FROM funds f JOIN providers p ON p.id = f.provider_id
    WHERE p.slug = 'hsbc'
  `);
  const rows = Array.isArray(r) ? r : (r as unknown as { rows: Array<{ n: number }> }).rows;
  console.log(`\nHSBC total funds in DB now: ${rows[0]?.n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

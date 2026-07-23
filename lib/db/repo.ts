import { db } from "./client";
import {
  providers,
  funds,
  fundSnapshots,
  fundAllocations,
  fundDocuments,
} from "./schema";
import { eq, sql, and } from "drizzle-orm";
import type {
  NormalizedFund,
  NormalizedSnapshot,
  NormalizedAllocation,
  NormalizedDocument,
} from "../scrapers/types";

export async function getProviderId(slug: string): Promise<number> {
  const rows = await db().select({ id: providers.id }).from(providers).where(eq(providers.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Provider not seeded: ${slug}`);
  return row.id;
}

export async function upsertFund(providerId: number, f: NormalizedFund): Promise<number> {
  const values = {
    providerId,
    externalId: f.externalId,
    name: f.name,
    isin: f.isin,
    fundHouse: f.fundHouse,
    currency: f.currency,
    assetClass: f.assetClass,
    distributionType: f.distributionType,
    riskRating: f.riskRating,
    riskLabel: f.riskLabel,
    shareClassInception: f.shareClassInception,
    fundSize: f.fundSize,
    fundSizeCurrency: f.fundSizeCurrency,
    fundSizeAsOf: f.fundSizeAsOf,
    dealingFrequency: f.dealingFrequency,
    benchmark: f.benchmark,
    sfdrClassification: f.sfdrClassification,
    expenseRatio: f.expenseRatio,
    managementFee: f.managementFee,
    morningstarRating: f.morningstarRating,
    investmentObjective: f.investmentObjective,
    sourceUrl: f.sourceUrl,
    lastScrapedAt: new Date(),
  };

  const result = await db()
    .insert(funds)
    .values(values)
    .onConflictDoUpdate({
      target: [funds.providerId, funds.externalId],
      set: {
        name: sql`excluded.name`,
        isin: sql`excluded.isin`,
        fundHouse: sql`excluded.fund_house`,
        currency: sql`excluded.currency`,
        assetClass: sql`excluded.asset_class`,
        distributionType: sql`excluded.distribution_type`,
        riskRating: sql`excluded.risk_rating`,
        riskLabel: sql`excluded.risk_label`,
        shareClassInception: sql`excluded.share_class_inception`,
        fundSize: sql`excluded.fund_size`,
        fundSizeCurrency: sql`excluded.fund_size_currency`,
        fundSizeAsOf: sql`excluded.fund_size_as_of`,
        dealingFrequency: sql`excluded.dealing_frequency`,
        benchmark: sql`excluded.benchmark`,
        sfdrClassification: sql`excluded.sfdr_classification`,
        expenseRatio: sql`excluded.expense_ratio`,
        managementFee: sql`excluded.management_fee`,
        morningstarRating: sql`excluded.morningstar_rating`,
        investmentObjective: sql`excluded.investment_objective`,
        sourceUrl: sql`excluded.source_url`,
        lastScrapedAt: sql`now()`,
      },
    })
    .returning({ id: funds.id });
  return result[0].id;
}

export async function upsertSnapshot(fundId: number, s: NormalizedSnapshot): Promise<void> {
  await db()
    .insert(fundSnapshots)
    .values({
      fundId,
      asOf: s.asOf,
      nav: s.nav,
      currency: s.currency,
      changePct: s.changePct,
      ann1y: s.ann1y,
      ann3y: s.ann3y,
      ann5y: s.ann5y,
      ann10y: s.ann10y,
      annSince: s.annSince,
      alpha3y: s.alpha3y,
      beta3y: s.beta3y,
      sharpe3y: s.sharpe3y,
      stddev3y: s.stddev3y,
    })
    .onConflictDoUpdate({
      target: [fundSnapshots.fundId, fundSnapshots.asOf],
      set: {
        nav: sql`excluded.nav`,
        currency: sql`excluded.currency`,
        changePct: sql`excluded.change_pct`,
        ann1y: sql`excluded.ann_1y`,
        ann3y: sql`excluded.ann_3y`,
        ann5y: sql`excluded.ann_5y`,
        ann10y: sql`excluded.ann_10y`,
        annSince: sql`excluded.ann_since`,
        alpha3y: sql`excluded.alpha_3y`,
        beta3y: sql`excluded.beta_3y`,
        sharpe3y: sql`excluded.sharpe_3y`,
        stddev3y: sql`excluded.stddev_3y`,
      },
    });
}

export async function replaceAllocations(fundId: number, allocs: NormalizedAllocation[]): Promise<void> {
  await db().delete(fundAllocations).where(eq(fundAllocations.fundId, fundId));
  if (allocs.length === 0) return;
  await db().insert(fundAllocations).values(
    allocs.map((a) => ({
      fundId,
      asOf: a.asOf,
      kind: a.kind,
      label: a.label,
      weightPct: a.weightPct,
    })),
  );
}

export async function upsertDocuments(fundId: number, docs: NormalizedDocument[]): Promise<void> {
  if (docs.length === 0) return;
  for (const d of docs) {
    await db()
      .insert(fundDocuments)
      .values({ fundId, type: d.type, label: d.label, sourceUrl: d.sourceUrl })
      .onConflictDoUpdate({
        target: [fundDocuments.fundId, fundDocuments.type],
        set: { label: sql`excluded.label`, sourceUrl: sql`excluded.source_url` },
      });
  }
}

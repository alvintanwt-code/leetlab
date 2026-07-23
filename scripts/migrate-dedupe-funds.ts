// One-shot migration to fix duplicate fund rows created by an evolving
// externalId. Old syncs stored external_id = ISIN when Morningstar returned
// nothing; new syncs (after the SG-screener fallback landed) store the real
// Morningstar secId. The (provider_id, external_id) unique index treated
// these as different funds, so we ended up with two rows per fund — one
// stale (ISIN key), one fresh (secId key), each with their own snapshots.
//
// Strategy: for each duplicate group, keep the OLDEST fund_id (that's what
// model_portfolio_holdings references). Reparent its snapshots/allocations/
// documents from the newer row to the older row, update the older row's
// external_id + refreshed metadata to point at the correct Morningstar
// secId, and delete the newer duplicate.
//
// Run with:
//   npx tsx scripts/migrate-dedupe-funds.ts           # dry run
//   npx tsx scripts/migrate-dedupe-funds.ts --apply   # actually mutate

import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const APPLY = process.argv.includes("--apply");

type Dupe = { provider_id: number; isin: string; keep_id: number; drop_id: number; keep_external: string; drop_external: string };

async function main() {
  const dupes = (await sql`
    SELECT
      f.provider_id,
      f.isin,
      MIN(f.id) AS keep_id,
      MAX(f.id) AS drop_id,
      (ARRAY_AGG(f.external_id ORDER BY f.id))[1] AS keep_external,
      (ARRAY_AGG(f.external_id ORDER BY f.id DESC))[1] AS drop_external
    FROM funds f
    WHERE f.isin IS NOT NULL
    GROUP BY f.provider_id, f.isin
    HAVING COUNT(*) > 1
  `) as unknown as Dupe[];

  console.log(`Found ${dupes.length} duplicate (provider, ISIN) groups.\n`);
  if (dupes.length === 0) return;

  for (const d of dupes) {
    console.log(`  provider=${d.provider_id}  isin=${d.isin}  keep=${d.keep_id} (ext=${d.keep_external})  drop=${d.drop_id} (ext=${d.drop_external})`);
  }

  if (!APPLY) {
    console.log(`\n(dry run — pass --apply to execute)`);
    return;
  }

  console.log(`\nApplying merges…`);
  for (const d of dupes) {
    // Move newer snapshot rows to the kept fund_id. Use conflict-safe upsert
    // shape by first deleting snapshots on the kept row that overlap the
    // drop row's as_of dates — the drop row's data is the fresher run.
    await sql`
      DELETE FROM fund_snapshots
      WHERE fund_id = ${d.keep_id}
        AND as_of IN (SELECT as_of FROM fund_snapshots WHERE fund_id = ${d.drop_id})
    `;
    await sql`UPDATE fund_snapshots SET fund_id = ${d.keep_id} WHERE fund_id = ${d.drop_id}`;
    await sql`
      DELETE FROM fund_allocations
      WHERE fund_id = ${d.keep_id}
        AND (as_of, kind, label) IN (
          SELECT as_of, kind, label FROM fund_allocations WHERE fund_id = ${d.drop_id}
        )
    `;
    await sql`UPDATE fund_allocations SET fund_id = ${d.keep_id} WHERE fund_id = ${d.drop_id}`;
    await sql`UPDATE fund_documents SET fund_id = ${d.keep_id} WHERE fund_id = ${d.drop_id}`;
    // Delete drop row FIRST so its external_id (the Morningstar secId) is
    // freed, then adopt it on the kept row. The unique (provider_id,
    // external_id) index otherwise blocks the update.
    await sql`DELETE FROM funds WHERE id = ${d.drop_id}`;
    await sql`
      UPDATE funds SET external_id = ${d.drop_external}
      WHERE id = ${d.keep_id}
    `;
    console.log(`  merged isin=${d.isin} (${d.drop_id} → ${d.keep_id})`);
  }
  console.log(`\n✓ merged ${dupes.length} duplicate groups`);
}

main().catch((e) => { console.error(e); process.exit(1); });

import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });
import { db } from "../lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db().execute(sql`
    SELECT p.slug,
           COUNT(*)::int AS n,
           COUNT(CASE WHEN s.ann_3y IS NOT NULL THEN 1 END)::int AS with_returns,
           COUNT(CASE WHEN f.isin IS NOT NULL THEN 1 END)::int AS with_isin,
           COUNT(CASE WHEN f.isin LIKE 'SG%' OR f.isin LIKE 'SGX%' THEN 1 END)::int AS mas_count
    FROM funds f
    JOIN providers p ON p.id = f.provider_id
    LEFT JOIN LATERAL (
      SELECT ann_3y FROM fund_snapshots WHERE fund_id = f.id ORDER BY as_of DESC LIMIT 1
    ) s ON true
    GROUP BY p.slug
    ORDER BY n DESC
  `);
  const rows = (Array.isArray(r) ? r : (r as unknown as { rows: Record<string, unknown>[] }).rows);
  console.log("\nProvider    total  w/3Y_ret  w/ISIN  SG-coded");
  for (const row of rows) {
    const slug = String(row.slug).padEnd(10);
    console.log(`${slug} ${String(row.n).padStart(6)}  ${String(row.with_returns).padStart(8)}  ${String(row.with_isin).padStart(6)}  ${String(row.mas_count).padStart(8)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });

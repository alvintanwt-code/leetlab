import { config } from "dotenv";
import { join } from "node:path";
import { readFileSync } from "node:fs";
config({ path: join(process.cwd(), ".env.local") });
import { db } from "../lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const ninetyTwo = JSON.parse(readFileSync("/tmp/hsbc-92.json", "utf8")) as Array<{
    name: string; isin: string; type: string;
  }>;
  const isinsWanted = new Set(ninetyTwo.map((f) => f.isin));
  console.log(`Target list: ${isinsWanted.size} ISINs (92 funds)`);

  const r = await db().execute(sql`
    SELECT f.isin, f.name, p.slug
    FROM funds f
    JOIN providers p ON p.id = f.provider_id
    WHERE p.slug = 'hsbc'
  `);
  const dbRows = (Array.isArray(r) ? r : (r as unknown as { rows: Record<string, unknown>[] }).rows) as Array<{ isin: string | null; name: string; slug: string }>;
  const dbIsins = new Set(dbRows.map((r) => r.isin).filter((i): i is string => !!i));
  console.log(`HSBC DB: ${dbRows.length} funds`);

  const intersect = [...isinsWanted].filter((i) => dbIsins.has(i));
  const missingFromDb = [...isinsWanted].filter((i) => !dbIsins.has(i));
  const extraInDb = [...dbIsins].filter((i) => !isinsWanted.has(i));

  console.log(`\nOverlap: ${intersect.length} of 92 already in DB`);
  console.log(`Missing from DB (in 92 list but not in DB): ${missingFromDb.length}`);
  if (missingFromDb.length > 0) {
    console.log(`\nMissing funds (need to add):`);
    for (const isin of missingFromDb) {
      const f = ninetyTwo.find((f) => f.isin === isin);
      const tag = isin.startsWith('SG') || isin.startsWith('SGX') ? '[SG-coded]' : '          ';
      console.log(`  ${tag} ${isin}  ${f?.name}`);
    }
  }
  console.log(`\nExtra in DB (not in 92 list — would be filtered out): ${extraInDb.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

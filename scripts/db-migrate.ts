import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });

import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "node:fs";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = neon(url);

  const dir = join(process.cwd(), "lib", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const f of files) {
    console.log(`▸ applying ${f}…`);
    const text = readFileSync(join(dir, f), "utf8");
    // Drizzle separates statements with the literal "--> statement-breakpoint"
    const statements = text
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      try {
        await sql.query(stmt);
      } catch (e) {
        const msg = (e as Error).message;
        // Idempotent re-runs: ignore "already exists" errors.
        if (/already exists/i.test(msg)) {
          console.log(`  · skipped (already exists): ${stmt.slice(0, 60)}…`);
          continue;
        }
        throw e;
      }
    }
    console.log(`  ✓ ${statements.length} statement(s)`);
  }

  // Seed providers
  await sql`INSERT INTO providers (slug, name, source_url) VALUES
    ('hsbc', 'HSBC Life Singapore', 'https://fundprices.insurance.hsbc.com.sg/'),
    ('tmls', 'Tokio Marine Life Singapore', 'https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundsearch.html'),
    ('fwd', 'FWD Singapore', 'https://www.fwd.com.sg/personalised-financial-advice/funds/'),
    ('gwm', 'GWM', 'internal')
  ON CONFLICT (slug) DO NOTHING`;

  const providers = await sql`SELECT slug, name FROM providers ORDER BY id`;
  console.log("✓ providers seeded:", providers);
}

main().catch((e) => { console.error(e); process.exit(1); });

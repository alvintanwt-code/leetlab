import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

(async () => {
  const sql = neon(process.env.DATABASE_URL!);
  const r = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
  console.log("tables on neon:", r);
})().catch((e) => { console.error(e); process.exit(1); });

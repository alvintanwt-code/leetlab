import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });
import { listFundsForPicker } from "../lib/db/queries";

async function main() {
  const all = await listFundsForPicker("hsbc");
  console.log(`Picker would show ${all.length} HSBC funds (after allowlist).`);
  console.log(`\nFirst 5:`);
  for (const f of all.slice(0, 5)) {
    console.log(`  ${f.id}  ${(f.name || "").slice(0, 60)}`);
  }
  console.log(`\nLast 5:`);
  for (const f of all.slice(-5)) {
    console.log(`  ${f.id}  ${(f.name || "").slice(0, 60)}`);
  }
  // Sanity check on a couple of the 16 we just upserted
  const sample = ["SGXZ58547654", "SG9999003412", "IE00B92R0G77"];
  console.log(`\nSpot-check the freshly upserted (look for these by name):`);
  for (const i of sample) {
    const found = all.find((f) => (f as { external_id: string }).external_id === i);
    console.log(`  ${i} → ${found ? `${found.name?.slice(0, 50)} (3Y=${found.ann_3y})` : "NOT IN PICKER"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

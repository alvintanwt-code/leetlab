import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });
import { fundsInspectorForProvider } from "../lib/db/queries";

async function main() {
  for (const slug of ["hsbc", "fwd", "tmls"]) {
    const rows = await fundsInspectorForProvider(slug);
    console.log(`${slug}: ${rows.length} funds (build-page picker)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

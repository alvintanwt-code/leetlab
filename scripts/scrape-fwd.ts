import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });

import { fwdAdapter } from "../lib/scrapers/fwd";
import {
  getProviderId,
  upsertFund,
  upsertSnapshot,
  replaceAllocations,
  upsertDocuments,
} from "../lib/db/repo";

function parseArgs(): { sample: number | null; force: boolean } {
  const args = process.argv.slice(2);
  let sample: number | null = null;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sample") sample = parseInt(args[i + 1] ?? "10", 10);
    if (args[i] === "--force") force = true;
  }
  return { sample, force };
}

async function main() {
  const { sample } = parseArgs();
  const providerId = await getProviderId("fwd");

  console.log(`▸ FWD scrape · ${sample ? `sample of ${sample}` : "all available"}`);
  const ids = await fwdAdapter.listFundIds();
  console.log(`  ${ids.length} IDs discovered from list pages`);

  const targetIds = sample ? ids.slice(0, sample) : ids;
  console.log(`  scraping ${targetIds.length} fund(s)…`);

  let okCount = 0;
  for (const [i, id] of targetIds.entries()) {
    try {
      const { fund, snapshot, allocations, documents } = await fwdAdapter.scrapeFund(id);
      const fundId = await upsertFund(providerId, fund);
      if (snapshot.nav != null) await upsertSnapshot(fundId, snapshot);
      await replaceAllocations(fundId, allocations);
      await upsertDocuments(fundId, documents);
      okCount++;
      console.log(
        `  [${i + 1}/${targetIds.length}] ${id} · ${fund.name.slice(0, 55)} · NAV ${snapshot.currency} ${snapshot.nav ?? "-"} · ISIN ${fund.isin ?? "-"}`,
      );
    } catch (e) {
      console.error(`  [${i + 1}/${targetIds.length}] ${id} FAILED:`, (e as Error).message);
    }
  }

  console.log(`✓ done. ${okCount}/${targetIds.length} succeeded.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

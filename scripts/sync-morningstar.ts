import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });

import { readFileSync } from "node:fs";
import { fetchUniverse, fetchFundSnapshot } from "../lib/morningstar/api";
import { parseMorningstarSnapshot } from "../lib/morningstar/parse";
import {
  getProviderId,
  upsertFund,
  upsertSnapshot,
  replaceAllocations,
} from "../lib/db/repo";

/**
 * Pull every fund from each provider's universe (or seed list) via the
 * Morningstar widget API, then for each ISIN fetch the full MFsnapshot and
 * upsert into our DB. No Firecrawl. Free.
 *
 * Usage:
 *   npm run sync                 — refresh all 3 providers
 *   npm run sync -- --only fwd   — refresh just one
 *   npm run sync -- --only tmls
 *   npm run sync -- --only hsbc
 *   npm run sync -- --sample 5   — first N funds per provider (smoke test)
 */

type Provider = {
  slug: string;
  label: string;
  detailUrl: (secId: string, isin: string) => string;
  // Either fetch IDs via Morningstar universe screener, or read from a seed file.
  source:
    | { kind: "universe"; universeId: string }
    | { kind: "seed"; file: string };
};

const PROVIDERS: Provider[] = [
  {
    slug: "hsbc",
    label: "HSBC Life",
    detailUrl: (secId) => `https://fundprices.insurance.hsbc.com.sg/detail?id=${secId}`,
    source: { kind: "seed", file: "data/seed/hsbc-funds.json" },
  },
  {
    slug: "fwd",
    label: "FWD Singapore",
    detailUrl: (secId) =>
      `https://www.fwd.com.sg/personalised-financial-advice/fund-report/?currencyId=SGD&languageId=en-GB&id=${secId}`,
    source: { kind: "universe", universeId: "FOALL$$ALL_5677" },
  },
  {
    slug: "tmls",
    label: "Tokio Marine Life Singapore",
    detailUrl: (secId) =>
      `https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundreport.html?universeid=FOALL$$ALL_4556&currencyId=SGD#?id=${secId}`,
    source: { kind: "universe", universeId: "FOALL$$ALL_4556" },
  },
];

type SeedFund = { name: string; isin: string; status: string };

type FundListEntry = { secId: string | null; isin: string; name: string };

async function discoverFunds(p: Provider): Promise<FundListEntry[]> {
  if (p.source.kind === "universe") {
    const rows = await fetchUniverse(p.source.universeId);
    return rows
      .filter((r) => r.Isin)
      .map((r) => ({ secId: r.secId, isin: r.Isin, name: r.Name ?? r.LegalName ?? r.Isin }));
  }
  // seed file — read deduped ISIN list from disk
  const raw = readFileSync(join(process.cwd(), p.source.file), "utf8");
  const seeds = JSON.parse(raw) as SeedFund[];
  return seeds.map((s) => ({ secId: null, isin: s.isin, name: s.name }));
}

function parseArgs(): { only: string | null; sample: number | null } {
  const args = process.argv.slice(2);
  let only: string | null = null;
  let sample: number | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only") only = args[i + 1] ?? null;
    if (args[i] === "--sample") sample = parseInt(args[i + 1] ?? "5", 10);
  }
  return { only, sample };
}

async function syncProvider(p: Provider, sample: number | null): Promise<void> {
  const providerId = await getProviderId(p.slug);
  console.log(`\n▸ ${p.label} (${p.slug}) — discovering funds…`);

  const all = await discoverFunds(p);
  console.log(`  ${all.length} funds discovered`);
  const targets = sample ? all.slice(0, sample) : all;
  if (sample) console.log(`  sample mode → fetching first ${targets.length}`);

  let ok = 0;
  let failed = 0;
  // 400ms throttle keeps us under Morningstar's free-tier ~3 req/s ceiling.
  const THROTTLE_MS = 400;
  for (const [i, entry] of targets.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS));
    try {
      const json = await fetchFundSnapshot(entry.isin);
      // The API returns {} for unknown ISINs — treat that as a soft failure.
      if (!json || Object.keys(json).length <= 2) {
        throw new Error("empty snapshot from Morningstar");
      }
      const externalId = (json as { Id?: string }).Id ?? entry.secId ?? entry.isin;
      const url = p.detailUrl(externalId, entry.isin);
      const { fund, snapshot, allocations } = parseMorningstarSnapshot(json, externalId, url);
      const fundId = await upsertFund(providerId, fund);
      if (snapshot.nav != null) await upsertSnapshot(fundId, snapshot);
      await replaceAllocations(fundId, allocations);
      ok++;
      console.log(
        `  [${i + 1}/${targets.length}] ${entry.isin} · ${fund.name.slice(0, 55)} · NAV ${snapshot.currency ?? "?"} ${snapshot.nav ?? "-"}`,
      );
    } catch (e) {
      failed++;
      console.error(`  [${i + 1}/${targets.length}] ${entry.isin} FAILED: ${(e as Error).message}`);
    }
  }
  console.log(`✓ ${p.slug}: ${ok}/${targets.length} succeeded (${failed} failed)`);
}

async function main() {
  const { only, sample } = parseArgs();
  const targets = only ? PROVIDERS.filter((p) => p.slug === only) : PROVIDERS;
  if (targets.length === 0) {
    console.error(`Unknown provider "${only}". Available: ${PROVIDERS.map((p) => p.slug).join(", ")}`);
    process.exit(1);
  }
  for (const p of targets) {
    await syncProvider(p, sample);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

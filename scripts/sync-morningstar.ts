import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });

import { readFileSync } from "node:fs";
import {
  fetchUniverse,
  fetchFundSnapshotByAny,
  fetchScreenerByIsin,
  type UniverseFund,
} from "../lib/morningstar/api";
import { parseMorningstarSnapshot, parseScreenerRow } from "../lib/morningstar/parse";
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
  {
    slug: "gwm",
    label: "GWM (POEMS / FAME)",
    detailUrl: (secId) =>
      `https://www.morningstar.com.sg/sg/funds/snapshot/snapshot.aspx?id=${secId}`,
    source: { kind: "seed", file: "data/seed/gwm-funds.json" },
  },
];

type SeedFund = { name: string; isin: string; status: string };

type FundListEntry = {
  secId: string | null;
  isin: string | null;
  name: string;
  // Original screener row when available — used as a fallback when MFsnapshot
  // returns empty (notably MAS-coded SG funds).
  screenerRow: UniverseFund | null;
};

async function discoverFunds(p: Provider): Promise<FundListEntry[]> {
  if (p.source.kind === "universe") {
    const rows = await fetchUniverse(p.source.universeId);
    return rows
      .filter((r) => r.Isin || r.secId)
      .map((r) => ({
        secId: r.secId,
        isin: r.Isin || null,
        name: r.Name ?? r.LegalName ?? r.Isin ?? r.secId ?? "(unnamed fund)",
        screenerRow: r,
      }));
  }
  // seed file — read deduped ISIN list from disk
  const raw = readFileSync(join(process.cwd(), p.source.file), "utf8");
  const seeds = JSON.parse(raw) as SeedFund[];
  return seeds.map((s) => ({ secId: null, isin: s.isin, name: s.name, screenerRow: null }));
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
  let okScreener = 0;
  let failed = 0;
  // 400ms throttle keeps us under Morningstar's free-tier ~3 req/s ceiling.
  const THROTTLE_MS = 400;
  for (const [i, entry] of targets.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS));
    const tag = entry.isin ?? entry.secId ?? "?";
    try {
      // Try MFsnapshot first — gives us NAV + allocations + per-fund detail.
      let snapshotJson: Record<string, unknown> = {};
      try {
        snapshotJson = await fetchFundSnapshotByAny(entry.isin, entry.secId);
      } catch {
        snapshotJson = {};
      }
      const hasSnapshot = snapshotJson && Object.keys(snapshotJson).length > 2;

      let parsed;
      let viaScreener = false;
      if (hasSnapshot) {
        const externalId =
          (snapshotJson as { Id?: string }).Id ?? entry.secId ?? entry.isin ?? "";
        const url = p.detailUrl(externalId, entry.isin ?? "");
        parsed = parseMorningstarSnapshot(snapshotJson, externalId, url);
      } else {
        // Fallback path: MAS-coded SG funds whose MFsnapshot returns []. Use
        // the extended screener row directly — gives us identity + returns +
        // risk + fund house. NAV and allocations stay null.
        //
        // For seed-mode providers the screener row isn't fetched upfront, so
        // we look it up lazily by ISIN against the SG country-of-sale universe.
        let screenerRow = entry.screenerRow;
        if (!screenerRow && entry.isin) {
          screenerRow = await fetchScreenerByIsin(entry.isin);
        }
        if (!screenerRow) {
          throw new Error("empty MFsnapshot and no screener fallback available");
        }
        const externalId = screenerRow.secId ?? entry.secId ?? entry.isin ?? "";
        const url = p.detailUrl(externalId, entry.isin ?? "");
        parsed = parseScreenerRow(screenerRow, externalId, url);
        viaScreener = true;
      }

      const fundId = await upsertFund(providerId, parsed.fund);
      const s = parsed.snapshot;
      if (s.nav != null || s.ann1y != null || s.ann3y != null) {
        await upsertSnapshot(fundId, s);
      }
      await replaceAllocations(fundId, parsed.allocations);

      if (viaScreener) okScreener++;
      else ok++;
      const navStr = s.nav != null ? `NAV ${s.currency ?? "?"} ${s.nav}` : "no NAV";
      const via = viaScreener ? "[screener]" : "          ";
      console.log(
        `  [${i + 1}/${targets.length}] ${via} ${tag} · ${parsed.fund.name.slice(0, 50)} · ${navStr}`,
      );
    } catch (e) {
      failed++;
      console.error(`  [${i + 1}/${targets.length}] ${tag} FAILED: ${(e as Error).message}`);
    }
  }
  console.log(
    `✓ ${p.slug}: ${ok + okScreener}/${targets.length} succeeded (${ok} MFsnapshot, ${okScreener} screener-only, ${failed} failed)`,
  );
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

// Loader for data/return-overrides.json — monthly cumulative-return series
// scraped from Morningstar's chart endpoint for MAS-coded SG funds where the
// MFsnapshot GrowthOf10K is empty (see scripts/scrape-mas-returns.ts).
//
// Synthesises a growth-of-10K series from the cumulative series so the runtime
// can drop it into the same blend code paths as ISIN-keyed funds.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ReturnOverride = {
  msid: string;
  asOf: string;
  ytd: number | null;
  ann1y: number | null;
  ann3y: number | null;
  ann5y: number | null;
  ann10y: number | null;
  calendar: Record<string, number>;
  // Monthly series is only available when sourced from Morningstar's chart
  // endpoint; TMLS-page-scraped entries omit it (the chart line will still
  // skip those funds, but the YTD / calendar / trailing fields resolve).
  series?: { d: string; cum: number }[];
  stddev3y?: number | null;
};

type OverridesFile = { overrides?: Record<string, ReturnOverride> };

let CACHE: Record<string, ReturnOverride> | null = null;

function load(): Record<string, ReturnOverride> {
  if (CACHE) return CACHE;
  const file = join(process.cwd(), "data", "return-overrides.json");
  if (!existsSync(file)) {
    CACHE = {};
    return CACHE;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as OverridesFile;
    CACHE = parsed.overrides ?? {};
  } catch {
    CACHE = {};
  }
  return CACHE;
}

export function getReturnOverride(isin: string): ReturnOverride | null {
  return load()[isin] ?? null;
}

/**
 * Synthesise a growth-of-10K series from an override's cumulative-return
 * series. Returns the same `{ d: "YYYY-MM", v: number }` shape that
 * Morningstar's MFsnapshot GrowthOf10K returns, so callers can use the same
 * blend code path for ISIN-bearing and MAS-coded funds.
 */
export function syntheticGrowth10K(isin: string): { d: string; v: number }[] {
  const ov = getReturnOverride(isin);
  if (!ov || !ov.series || ov.series.length < 2) return [];
  return ov.series.map((p) => ({
    d: p.d.slice(0, 7), // truncate "YYYY-MM-DD" → "YYYY-MM" to match Morningstar's bucket
    v: 10_000 * (1 + p.cum / 100),
  }));
}

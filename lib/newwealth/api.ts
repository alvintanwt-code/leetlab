// NewWealth Cloud — the fund-centre-as-a-service platform behind HSBC Life
// and Tokio Marine Life Singapore. Both expose a Typesense-backed fund
// catalog and a Morningstar-sourced NAV timeseries endpoint through their
// own domains. Their search-only Typesense key is fetched at runtime from
// an open `config/static?config_type=typesense_config` endpoint (no auth,
// no session) and, at the time of writing, is set to expire in year 4021
// — so we treat it as effectively permanent and cache in-process.
//
// Replaces the dead tools.morningstar.co.uk widget API for any fund
// present in HSBC (~232) or TMLS (~86) universes. LU/IE UCITS funds
// commonly appear on both insurers' shelves; we search HSBC first then
// TMLS and take the first hit.

type SeriesPoint = { d: string; v: number };

export type Tenant = "hsbc" | "tmls";

type TenantConfig = {
  /** Origin used for the tenant-scoped config + timeseries endpoints. */
  originHost: string;
  /** Prefix under the origin — differs between the two insurers. */
  apiPrefix: string;
  /** URL template for the timeseries endpoint; `{secId}` is substituted in. */
  tsPath: (secId: string, from: string, to: string) => string;
};

const TENANTS: Record<Tenant, TenantConfig> = {
  hsbc: {
    originHost: "fundprices.insurance.hsbc.com.sg",
    apiPrefix: "fund-center-api/hsbc",
    tsPath: (secId, from, to) =>
      `fund-center-api/hsbc/ts/external?code=${secId}&id_type=sec_id&from_date=${from}&currency_id=SGD&to_date=${to}&start_value=100&ts_type=nav`,
  },
  tmls: {
    originHost: "tmls-fundcenter.newwealth.cloud",
    apiPrefix: "product-center-api/tokio",
    // TMLS's timeseries endpoint lives under the shared /api/v2 path, not
    // the tenant-scoped prefix — matches what their SPA hits at runtime.
    tsPath: (secId, from, to) =>
      `product-center-api/api/v2/timeseries?code=${secId}&currency_id=SGD&id_type=sec_id&from_date=${from}&to_date=${to}&ts_type=nav&start_value=100&maximum=10000`,
  },
};

type TypesenseConfig = {
  host: string;
  key: string;
};

const FETCH_TIMEOUT_MS = 15_000;
const CONFIG_TTL_MS = 24 * 60 * 60 * 1000; // 24h — the key itself expires in year 4021
const SERIES_TTL_MS = 6 * 60 * 60 * 1000; // 6h — matches Morningstar module

const CONFIG_CACHE = new Map<Tenant, { ts: number; cfg: TypesenseConfig }>();
const SERIES_CACHE = new Map<
  string,
  { ts: number; source: Tenant; points: SeriesPoint[]; yield12m: number | null; distFreq: string | null }
>();

async function fetchTypesenseConfig(tenant: Tenant): Promise<TypesenseConfig | null> {
  const cached = CONFIG_CACHE.get(tenant);
  if (cached && Date.now() - cached.ts < CONFIG_TTL_MS) return cached.cfg;
  const t = TENANTS[tenant];
  const url = `https://${t.originHost}/${t.apiPrefix}/config/static?config_type=typesense_config`;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return null;
    const j = (await r.json()) as { typesense_host?: string; typesense_key?: { value?: string } };
    const host = j.typesense_host;
    const key = j.typesense_key?.value;
    if (!host || !key) return null;
    const cfg: TypesenseConfig = { host, key };
    CONFIG_CACHE.set(tenant, { ts: Date.now(), cfg });
    return cfg;
  } catch {
    return null;
  }
}

/**
 * Metadata pulled straight from the Typesense doc alongside the SecId
 * lookup. Same doc we already need to fetch to get the SecId — so no
 * extra network call. `yield12m` maps to Morningstar's Type-52 trailing
 * 12-month yield (that's how NewWealth's ETL derives `DividendYield`).
 */
type FundMeta = {
  secId: string;
  yield12m: number | null;
  distFreq: string | null;
};

/**
 * Look up a fund by ISIN in a tenant's Typesense `funds` collection.
 * Returns the Morningstar `SecId` needed for the NAV fetch plus the
 * yield/dist-frequency metadata (both used to be sourced from
 * Morningstar's MFsnapshot which is now dead). Null when the fund
 * isn't in that tenant's universe.
 */
async function searchIsinInTenant(tenant: Tenant, isin: string): Promise<FundMeta | null> {
  const cfg = await fetchTypesenseConfig(tenant);
  if (!cfg) return null;
  const url = `https://${cfg.host}/api/multi_search`;
  // Field is `ISIN` (all caps) in the collection schema. `q=*` +
  // `filter_by` gives an exact match — safer than a `query_by` text
  // search, which can return near-hits and would attribute another
  // fund's NAV to this ISIN.
  const body = JSON.stringify({
    searches: [
      {
        collection: "funds",
        q: "*",
        filter_by: `ISIN:=${isin}`,
        per_page: 1,
        include_fields: "SecId,ISIN,DividendYield,DividendDistributionFrequency",
      },
    ],
  });
  try {
    const r = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-typesense-api-key": cfg.key },
      body,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      results?: Array<{
        hits?: Array<{
          document?: {
            SecId?: string;
            ISIN?: string;
            DividendYield?: number;
            DividendDistributionFrequency?: string;
          };
        }>;
      }>;
    };
    const hit = j.results?.[0]?.hits?.[0]?.document;
    if (!hit || hit.ISIN !== isin || !hit.SecId) return null;
    // Accumulating funds legitimately report DividendYield: 0 — keep that
    // through so consumers can render "0.0%" rather than an unknown "—";
    // only drop the field when it's actually missing.
    const y = typeof hit.DividendYield === "number" ? hit.DividendYield : null;
    return {
      secId: hit.SecId,
      yield12m: y,
      distFreq: hit.DividendDistributionFrequency ?? null,
    };
  } catch {
    return null;
  }
}

type MonthlyPoint = SeriesPoint;

/**
 * Fetch daily NAV history from a tenant and downsample to end-of-month.
 * The Morningstar-facing SeriesPoint format uses `YYYY-MM` keys and one
 * value per month, so we keep the last daily observation per calendar
 * month to match. Windowed to the last ~10 years.
 */
async function fetchSeriesInTenant(tenant: Tenant, secId: string): Promise<MonthlyPoint[]> {
  const now = new Date();
  const from = `${now.getFullYear() - 10}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = now.toISOString().slice(0, 10);
  const t = TENANTS[tenant];
  const url = `https://${t.originHost}/${t.tsPath(secId, from, to)}`;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return [];
    const j = (await r.json()) as {
      TimeSeries?: { Security?: Array<{ HistoryDetail?: Array<{ EndDate?: string; Value?: number | string }> }> };
    };
    const hd = j.TimeSeries?.Security?.[0]?.HistoryDetail;
    if (!Array.isArray(hd) || hd.length === 0) return [];
    // HSBC returns Value as a string, TMLS as a number. Coerce; drop
    // anything that doesn't parse to a positive number.
    const byMonth = new Map<string, number>();
    for (const p of hd) {
      const d = String(p.EndDate ?? "").slice(0, 7); // YYYY-MM
      const v = typeof p.Value === "number" ? p.Value : parseFloat(String(p.Value ?? ""));
      if (!d || !Number.isFinite(v) || v <= 0) continue;
      // Later dates overwrite earlier ones within the same month → last daily
      // observation wins, i.e. end-of-month.
      byMonth.set(d, v);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([d, v]) => ({ d, v }));
  } catch {
    return [];
  }
}

export type NewWealthResult = {
  points: SeriesPoint[];
  source: Tenant;
  /** Trailing 12-month yield in percent — null when not populated. */
  yield12m: number | null;
  /** e.g. "Monthly" / "Quarterly" / "Annual" — null when unavailable. */
  distFreq: string | null;
} | null;

type SeriesCacheEntry = {
  ts: number;
  source: Tenant;
  points: SeriesPoint[];
  yield12m: number | null;
  distFreq: string | null;
};

/**
 * Top-level lookup: given an ISIN, search HSBC first (larger universe of
 * 232 funds), then TMLS (86), and return monthly NAV history from the
 * first tenant that has the fund. Result cached in-process for 6h; null
 * results are cached too so we don't retry every request for uncovered
 * ISINs within the window.
 */
export async function fetchByIsin(isin: string): Promise<NewWealthResult> {
  const cached = SERIES_CACHE.get(isin) as SeriesCacheEntry | undefined;
  if (cached && Date.now() - cached.ts < SERIES_TTL_MS) {
    return cached.points.length >= 2
      ? { points: cached.points, source: cached.source, yield12m: cached.yield12m, distFreq: cached.distFreq }
      : null;
  }
  for (const tenant of ["hsbc", "tmls"] as const) {
    const meta = await searchIsinInTenant(tenant, isin);
    if (!meta) continue;
    const points = await fetchSeriesInTenant(tenant, meta.secId);
    if (points.length >= 2) {
      SERIES_CACHE.set(isin, {
        ts: Date.now(),
        source: tenant,
        points,
        yield12m: meta.yield12m,
        distFreq: meta.distFreq,
      } as SeriesCacheEntry);
      return { points, source: tenant, yield12m: meta.yield12m, distFreq: meta.distFreq };
    }
  }
  // Negative cache so uncovered ISINs (POEMS-only, MAS-coded, etc.) don't
  // hammer both tenants on every render for the next 6h.
  SERIES_CACHE.set(isin, {
    ts: Date.now(),
    source: "hsbc",
    points: [],
    yield12m: null,
    distFreq: null,
  } as SeriesCacheEntry);
  return null;
}

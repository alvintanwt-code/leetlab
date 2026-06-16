// Morningstar widget API — used by FWD / TM / HSBC fund-centre pages.
// Single public key (klr5zyak8x) works across all providers' fund universes.

const API_KEY = "klr5zyak8x";
const BASE_URL = `https://tools.morningstar.co.uk/api/rest.svc/${API_KEY}`;
const FETCH_TIMEOUT_MS = 20_000;

export type UniverseFund = {
  secId: string;
  Name: string;
  Isin: string;
  LegalName?: string;
  Currency?: string;
  CategoryName?: string;
  InceptionDate?: string;
};

export type MorningstarSnapshot = Record<string, unknown>;

const RETRY_DELAYS_MS = [2000, 5000, 12000];

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 429) return res;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait == null) return res; // out of retries; let caller see the 429
    await new Promise((r) => setTimeout(r, wait));
  }
  // unreachable
  throw new Error("fetchWithRetry: exhausted attempts");
}

/**
 * Fetch all funds in a Morningstar universe (e.g. FOALL$$ALL_5677 for FWD).
 * Returns secId + ISIN + name + currency + category in a single call.
 */
export async function fetchUniverse(universeId: string): Promise<UniverseFund[]> {
  const params = new URLSearchParams({
    universeIds: universeId,
    languageId: "en-GB",
    outputType: "json",
    securityDataPoints: "secId,Name,Isin,LegalName,Currency,CategoryName,InceptionDate",
    top: "500",
    pageSize: "500",
  });
  const url = `${BASE_URL}/security/screener?${params}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Morningstar screener HTTP ${res.status} for universe ${universeId}`);
  const data = (await res.json()) as { rows?: UniverseFund[]; total?: number };
  return data.rows ?? [];
}

export type IdType = "isin" | "msid";

/**
 * Fetch the full MFsnapshot payload for one fund.
 *   idType="isin"  → standard ISIN (works for most LU/IE funds)
 *   idType="msid"  → Morningstar security ID (e.g. F00000XOR0) — required
 *                    for SG-prefixed local codes that aren't true ISINs.
 */
export async function fetchFundSnapshot(
  id: string,
  idType: IdType = "isin",
): Promise<MorningstarSnapshot> {
  const params = new URLSearchParams({
    idtype: idType,
    languageId: "en-GB",
    responseViewFormat: "json",
    viewId: "MFsnapshot",
  });
  const url = `${BASE_URL}/security_details/${encodeURIComponent(id)}?${params}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Morningstar snapshot HTTP ${res.status} for ${idType} ${id}`);
  const data = (await res.json()) as MorningstarSnapshot | MorningstarSnapshot[];
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Try ISIN first, fall back to Morningstar secId if the snapshot comes back empty
 * (Singapore-domiciled funds with MAS-issued SG9999... codes aren't indexed by
 * ISIN at Morningstar — they need msid).
 */
export async function fetchFundSnapshotByAny(
  isin: string,
  secId: string | null,
): Promise<MorningstarSnapshot> {
  if (isin) {
    const j = await fetchFundSnapshot(isin, "isin");
    if (j && Object.keys(j).length > 2) return j;
  }
  if (secId) {
    return fetchFundSnapshot(secId, "msid");
  }
  throw new Error(`No usable identifier (isin=${isin}, secId=${secId})`);
}

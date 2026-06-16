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

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Morningstar screener HTTP ${res.status} for universe ${universeId}`);
  const data = (await res.json()) as { rows?: UniverseFund[]; total?: number };
  return data.rows ?? [];
}

/**
 * Fetch the full MFsnapshot payload for one fund by ISIN.
 * Returns the raw JSON — pass to parseMorningstarSnapshot to map into ScrapedFund.
 */
export async function fetchFundSnapshot(isin: string): Promise<MorningstarSnapshot> {
  const params = new URLSearchParams({
    idtype: "isin",
    languageId: "en-GB",
    responseViewFormat: "json",
    viewId: "MFsnapshot",
  });
  const url = `${BASE_URL}/security_details/${encodeURIComponent(isin)}?${params}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Morningstar snapshot HTTP ${res.status} for ISIN ${isin}`);
  const data = (await res.json()) as MorningstarSnapshot | MorningstarSnapshot[];
  return Array.isArray(data) ? data[0] : data;
}

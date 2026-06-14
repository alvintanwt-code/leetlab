import { scrapeMarkdown } from "../firecrawl";

const LIST_URL = "https://fundprices.insurance.hsbc.com.sg/";

/**
 * Returns fund IDs visible on the list page.
 * Pagination is JS-driven; first scrape exposes only ~10 IDs.
 * For sample/MVP use this is fine; full-list pagination is a follow-up.
 */
export async function listFundIdsOnce(): Promise<string[]> {
  const { markdown } = await scrapeMarkdown(LIST_URL, { cacheKey: "hsbc/_list", waitFor: 8000 });
  const ids = new Set<string>();
  const re = /\/detail\?id=([A-Z0-9]+)/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

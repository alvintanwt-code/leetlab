import { scrapeMarkdown } from "../firecrawl";

const BASE_LIST_URL = "https://www.fwd.com.sg/personalised-financial-advice/funds/";

function pageHashUrl(page: number): string {
  // FWD's SPA reads page from the hash fragment; perPage is locked to 10 by the app.
  return `${BASE_LIST_URL}#?filtersSelectedValue=%7B%7D&page=${page}&perPage=10&sortField=FundName&sortOrder=asc&universeId=FOALL$$ALL_5677`;
}

function extractIds(markdown: string): string[] {
  const ids = new Set<string>();
  // Detail link: ...?currencyId=SGD&languageId=en-GB&id=F00000ME01
  const re = /id=(F[A-Z0-9]{6,})/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

/**
 * Page through the FWD fund list. perPage is forced to 10 by the FWD app
 * (URL hash overrides are ignored), so we walk pages until two consecutive
 * pages return no new IDs, capped at maxPages.
 */
export async function listFwdFundIds(opts: { maxPages?: number; force?: boolean } = {}): Promise<string[]> {
  const { maxPages = 10, force = false } = opts;
  const all = new Set<string>();
  let consecutiveEmpty = 0;
  for (let page = 1; page <= maxPages; page++) {
    const { markdown } = await scrapeMarkdown(pageHashUrl(page), {
      cacheKey: `fwd/_list_p${page}`,
      waitFor: 10000,
      force,
      onlyMainContent: true,
    });
    const ids = extractIds(markdown);
    const before = all.size;
    for (const id of ids) all.add(id);
    const added = all.size - before;
    if (added === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break;
    } else {
      consecutiveEmpty = 0;
    }
  }
  return Array.from(all);
}

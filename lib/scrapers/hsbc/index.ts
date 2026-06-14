import type { FundProviderAdapter, ScrapedFund } from "../types";
import { scrapeMarkdown } from "../firecrawl";
import { parseDetail } from "./parse";
import { listFundIdsOnce } from "./list";

export const hsbcAdapter: FundProviderAdapter = {
  slug: "hsbc",
  name: "HSBC Life Singapore",
  sourceUrl: "https://fundprices.insurance.hsbc.com.sg/",

  async listFundIds(): Promise<string[]> {
    return listFundIdsOnce();
  },

  async scrapeFund(externalId: string): Promise<ScrapedFund> {
    const url = `https://fundprices.insurance.hsbc.com.sg/detail?id=${externalId}`;
    const { markdown } = await scrapeMarkdown(url, {
      cacheKey: `hsbc/${externalId}`,
      waitFor: 6000,
    });
    return parseDetail(markdown, externalId);
  },
};

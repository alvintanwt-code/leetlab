import type { FundProviderAdapter, ScrapedFund } from "../types";
import { scrapeMarkdown } from "../firecrawl";
import {
  parseMorningstarExpandedDetail,
  EXPAND_ACCORDIONS_JS,
} from "../morningstar/parse";
import { listFwdFundIds } from "./list";

const DETAIL_URL = (id: string) =>
  `https://www.fwd.com.sg/personalised-financial-advice/fund-report/?currencyId=SGD&languageId=en-GB&id=${id}`;

export const fwdAdapter: FundProviderAdapter = {
  slug: "fwd",
  name: "FWD Singapore",
  sourceUrl: "https://www.fwd.com.sg/personalised-financial-advice/funds/",

  async listFundIds(): Promise<string[]> {
    return listFwdFundIds();
  },

  async scrapeFund(externalId: string): Promise<ScrapedFund> {
    const url = DETAIL_URL(externalId);
    const { markdown } = await scrapeMarkdown(url, {
      cacheKey: `fwd/${externalId}_expanded`,
      waitFor: 12000,
      onlyMainContent: true,
      actions: [
        { type: "wait", milliseconds: 6000 },
        { type: "executeJavascript", script: EXPAND_ACCORDIONS_JS },
        { type: "wait", milliseconds: 8000 },
      ],
    });
    return parseMorningstarExpandedDetail(markdown, externalId, url);
  },
};

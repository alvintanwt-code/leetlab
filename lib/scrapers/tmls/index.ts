import type { FundProviderAdapter, ScrapedFund } from "../types";
import { scrapeMarkdown } from "../firecrawl";
import {
  parseMorningstarExpandedDetail,
  EXPAND_ACCORDIONS_JS,
} from "../morningstar/parse";
import { listTmlsFundIds } from "./list";

const DETAIL_URL = (id: string) =>
  `https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundreport.html?universeid=FOALL$$ALL_4556&currencyId=SGD#?id=${id}`;

export const tmlsAdapter: FundProviderAdapter = {
  slug: "tmls",
  name: "Tokio Marine Life Singapore",
  sourceUrl: "https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundsearch.html",

  async scrapeFund(externalId: string): Promise<ScrapedFund> {
    const url = DETAIL_URL(externalId);
    // TM routes the fund off window.location.hash. Firecrawl drops the URL
    // bar's hash, so we re-set it via JS and dispatch hashchange first;
    // then we click every "Open" accordion header to reveal data.
    const { markdown } = await scrapeMarkdown(url, {
      cacheKey: `tmls/${externalId}_expanded`,
      waitFor: 12000,
      onlyMainContent: true,
      actions: [
        { type: "wait", milliseconds: 2500 },
        {
          type: "executeJavascript",
          script: `(function(){window.location.hash='?id=${externalId}&idCurrencyId=&idType=MSID&marketCode=';window.dispatchEvent(new HashChangeEvent('hashchange'));})();`,
        },
        { type: "wait", milliseconds: 7000 },
        { type: "executeJavascript", script: EXPAND_ACCORDIONS_JS },
        { type: "wait", milliseconds: 8000 },
      ],
    });
    return parseMorningstarExpandedDetail(markdown, externalId, url);
  },

  async listFundIds(): Promise<string[]> {
    return listTmlsFundIds();
  },
};

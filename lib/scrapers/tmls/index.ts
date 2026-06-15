import type { FundProviderAdapter, ScrapedFund } from "../types";
import { scrapeJson } from "../firecrawl";
import { buildTmlsScrapedFund, DETAIL_URL, type TmlsExtractJson } from "./parse";
import { listTmlsFundIds } from "./list";

const EXTRACT_PROMPT = `Extract fund detail from this Morningstar fund report page (Tokio Marine Life Singapore). Return JSON with these keys:
- name (full fund name as shown — includes any (CODE) suffix)
- latestNav (number, the Latest NAV value)
- navDate (ISO date YYYY-MM-DD, parsed from "Date of Latest NAV")
- isin (string)
- currency (3-letter code)
- fundHouse (manager / fund company)
- fundSize (raw text exactly as shown, e.g. "SGD 1.69b (29 May 2026)")
- benchmark
- morningstarCategory
- morningstarRating (1-5, null if not shown)
- assetClass (Equity / Fixed Income / Allocation / Real Assets / Alternative Strategies / Capital Preservation)
- riskRating (1-5, null if not shown)
- riskLabel (Low / Medium / High etc., null if not shown)
- investmentObjective
- expenseRatio (percent number, null if not shown)
- managementFee (percent number, null if not shown)
- shareClassInception (date string, null if not shown)
- distributionType (Accumulating / Distributing, null if not shown)
- ann1y, ann3y, ann5y, ann10y (annualised return percentages from the Performance section, null if not visible)
- assetAllocation, geographicAllocation, sectorAllocation, topHoldings (each an array of {label, weightPct}; [] if section is collapsed or absent)
Only extract what is actually shown on the page. Do not guess or invent values.`;

export const tmlsAdapter: FundProviderAdapter = {
  slug: "tmls",
  name: "Tokio Marine Life Singapore",
  sourceUrl: "https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundsearch.html",

  async listFundIds(): Promise<string[]> {
    return listTmlsFundIds();
  },

  async scrapeFund(externalId: string): Promise<ScrapedFund> {
    const url = DETAIL_URL(externalId);
    // TM's report widget routes off window.location.hash. Firecrawl's headless
    // browser sometimes drops or coalesces the hash from the URL bar, so we
    // re-set it via JS and dispatch hashchange to force the SPA to load this
    // specific fund.
    const { json } = await scrapeJson<TmlsExtractJson>(url, EXTRACT_PROMPT, {
      cacheKey: `tmls/${externalId}`,
      waitFor: 10000,
      actions: [
        { type: "wait", milliseconds: 2500 },
        {
          type: "executeJavascript",
          script: `(function(){window.location.hash='?id=${externalId}&idCurrencyId=&idType=MSID&marketCode=';window.dispatchEvent(new HashChangeEvent('hashchange'));})();`,
        },
        { type: "wait", milliseconds: 8000 },
      ],
    });
    return buildTmlsScrapedFund(externalId, json, url);
  },
};

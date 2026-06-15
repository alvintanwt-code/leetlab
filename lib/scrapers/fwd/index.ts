import type { FundProviderAdapter, ScrapedFund } from "../types";
import { scrapeJson } from "../firecrawl";
import { buildScrapedFund, DETAIL_URL, type FwdExtractJson } from "./parse";
import { listFwdFundIds } from "./list";

const EXTRACT_PROMPT = `Extract fund detail from this Morningstar fund report page (FWD Singapore). Return JSON with these keys:
- name (full fund name as shown in the title card)
- latestNav (number, the Latest NAV value)
- navDate (ISO date YYYY-MM-DD, parsed from "Date of Latest NAV")
- isin (string)
- currency (3-letter code)
- fundHouse (manager / fund company)
- fundSize (raw text exactly as shown, e.g. "8403.36M(12/06/2026)")
- benchmark
- morningstarCategory
- morningstarRating (1-5, null if not shown)
- assetClass (Equity / Fixed Income / Allocation / etc.)
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

export const fwdAdapter: FundProviderAdapter = {
  slug: "fwd",
  name: "FWD Singapore",
  sourceUrl: "https://www.fwd.com.sg/personalised-financial-advice/funds/",

  async listFundIds(): Promise<string[]> {
    return listFwdFundIds();
  },

  async scrapeFund(externalId: string): Promise<ScrapedFund> {
    const url = DETAIL_URL(externalId);
    const { json } = await scrapeJson<FwdExtractJson>(url, EXTRACT_PROMPT, {
      cacheKey: `fwd/${externalId}`,
      waitFor: 8000,
    });
    return buildScrapedFund(externalId, json, url);
  },
};

// TM detail JSON has the same shape as FWD's Morningstar widget extract, so
// the build function and FwdExtractJson type are reused.
export { buildScrapedFund as buildTmlsScrapedFund } from "../fwd/parse";
export type { FwdExtractJson as TmlsExtractJson } from "../fwd/parse";

export const DETAIL_URL = (id: string) =>
  `https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundreport.html?universeid=FOALL$$ALL_4556&currencyId=SGD#?id=${id}`;

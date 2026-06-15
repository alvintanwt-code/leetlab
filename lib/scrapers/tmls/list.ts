import { scrapeMarkdown, type FirecrawlAction } from "../firecrawl";

const LIST_URL = "https://www.tokiomarine.com/sg/en/life/resources/fund-centre/fundsearch.html";

// TM's pagination is a select dropdown — pushing its value to "100" and
// dispatching a change event re-renders the table with all rows.
const ROWS_TO_100: FirecrawlAction[] = [
  { type: "wait", milliseconds: 4000 },
  {
    type: "executeJavascript",
    script:
      "(function(){const sels=Array.from(document.querySelectorAll('select'));for(const s of sels){const opt=Array.from(s.options).find(o=>o.value==='100'||o.text==='100');if(opt){s.value=opt.value;s.dispatchEvent(new Event('change',{bubbles:true}));}}})();",
  },
  { type: "wait", milliseconds: 8000 },
];

function extractIds(markdown: string): string[] {
  const ids = new Set<string>();
  // TM renders each row prefixed with "Security F00000XXXX" plus a link `#?id=F00000XXXX`.
  const re = /(?:Security|[?&#]id=)\s*(F[A-Z0-9]{6,})/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

export async function listTmlsFundIds(opts: { force?: boolean } = {}): Promise<string[]> {
  const { force = false } = opts;
  const { markdown } = await scrapeMarkdown(LIST_URL, {
    cacheKey: "tmls/_list",
    waitFor: 10000,
    force,
    onlyMainContent: true,
    actions: ROWS_TO_100,
  });
  return extractIds(markdown);
}

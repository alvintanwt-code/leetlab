// Shared helper: load the return-proxy config and splice a proxy fund's earlier
// NAV history onto a target fund's own series, scaled to connect at the
// target's inception. Used by:
//   - lib/factsheet/build.ts (fact-sheet chart + monthly archive)
//   - app/api/performance/route.ts (portfolio detail page chart)
//
// A "proxy" here is a longer-history share class of the same underlying
// strategy (e.g. Amundi Idx MSCI World SGD → Infinity Global Stock Index USD).
// The trailing-return figures already borrow from the proxy; this module lets
// the chart do the same so the two views agree.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SeriesPoint = { d: string; v: number };
export type ProxyEntry = { proxy: string; reason?: string };
export type ProxyMap = Record<string, ProxyEntry>;

let PROXY_CACHE: ProxyMap | null = null;
export function loadProxies(): ProxyMap {
  if (PROXY_CACHE) return PROXY_CACHE;
  const file = join(process.cwd(), "data", "return-proxies.json");
  if (!existsSync(file)) return (PROXY_CACHE = {});
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { proxies?: ProxyMap };
    PROXY_CACHE = parsed.proxies ?? {};
  } catch {
    PROXY_CACHE = {};
  }
  return PROXY_CACHE;
}

/**
 * Concatenate a proxy fund's earlier NAV history to a target fund's real
 * history, scaled so the two connect continuously at the target's first
 * datapoint. When the target has no series at all the proxy is used
 * wholesale. Returns the target unchanged if the proxy carries nothing
 * useful (no overlap, zero-value anchor, etc.).
 */
export function spliceProxyPrefix(target: SeriesPoint[], proxy: SeriesPoint[]): SeriesPoint[] {
  if (target.length === 0) return proxy;
  if (proxy.length === 0) return target;
  const targetStart = target[0].d;
  const anchor = proxy.find((p) => p.d >= targetStart);
  if (!anchor || anchor.v === 0) return target;
  const scale = target[0].v / anchor.v;
  const prefix = proxy
    .filter((p) => p.d < targetStart)
    .map((p) => ({ d: p.d, v: p.v * scale }));
  return [...prefix, ...target];
}

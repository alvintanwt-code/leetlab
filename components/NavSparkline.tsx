"use client";

import { useEffect, useMemo, useState } from "react";

type Point = { d: string; v: number };

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonth(d: string): string {
  const m = d.match(/^(\d{4})-(\d{2})/);
  if (!m) return d;
  return `${MONTHS_SHORT[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/**
 * Compact NAV trajectory sparkline for the fund inspector. Fetches the
 * Morningstar growth-of-10k series via /api/performance (weight=1 means
 * model == single fund). Rendered as a clean SVG line, no axes, with a
 * crosshair on hover and a small caption row below for start / end /
 * terminal change.
 */
export function NavSparkline({
  isin,
  name,
  currency,
}: {
  isin: string;
  name: string;
  currency: string | null;
}) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPoints(null);
    (async () => {
      try {
        const res = await fetch("/api/performance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ components: [{ isin, weight: 1, name }] }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data?.error) throw new Error(data?.error ?? `HTTP ${res.status}`);
        // For a single component, funds[0].points is the rebased-to-100 series
        // we want to plot. terminal value already in data.
        const pts: Point[] | undefined = data?.funds?.[0]?.points;
        if (!pts || pts.length < 3) throw new Error("No history available");
        setPoints(pts);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isin, name]);

  if (loading) {
    return (
      <div className="mt-3 rounded-md border border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] px-3 py-4 text-center">
        <p className="t-caption text-[var(--color-ink-mute)]">Loading price history…</p>
      </div>
    );
  }
  if (error || !points) {
    return (
      <div className="mt-3 rounded-md border border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)] px-3 py-3 text-center">
        <p className="t-caption text-[var(--color-ink-mute)]">{error ?? "No price history."}</p>
      </div>
    );
  }

  return <Sparkline points={points} currency={currency} />;
}

function Sparkline({ points, currency }: { points: Point[]; currency: string | null }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 400;
  const H = 110;
  const PAD_L = 4;
  const PAD_R = 4;
  const PAD_T = 14;
  const PAD_B = 14;

  const stats = useMemo(() => {
    const values = points.map((p) => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.1 || 5;
    return {
      min: min - pad,
      max: max + pad,
      first: values[0],
      last: values[values.length - 1],
    };
  }, [points]);

  const X = (i: number) => PAD_L + ((W - PAD_L - PAD_R) * i) / Math.max(1, points.length - 1);
  const Y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - stats.min) / (stats.max - stats.min || 1));

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`)
    .join(" ");
  const area =
    `${path} L${X(points.length - 1).toFixed(1)},${(H - PAD_B).toFixed(1)} L${PAD_L.toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

  const change = stats.last - stats.first;
  const changePct = (change / stats.first) * 100;
  const isUp = change >= 0;
  const lineCls = isUp ? "var(--color-positive)" : "var(--color-negative)";
  const changeText = `${isUp ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%`;

  const showIdx = hoverIdx ?? points.length - 1;
  const hoverPoint = points[showIdx];

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const xRatio = (xPx / rect.width) * W;
    const closest = Math.max(
      0,
      Math.min(
        points.length - 1,
        Math.round(((xRatio - PAD_L) / (W - PAD_L - PAD_R)) * (points.length - 1)),
      ),
    );
    setHoverIdx(closest);
  }

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <p className="t-micro-cap">NAV history</p>
        <p className="t-caption text-[var(--color-ink-mute)]">
          {fmtMonth(points[0].d)} – {fmtMonth(points[points.length - 1].d)}
        </p>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: H }}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label="NAV trajectory"
        >
          <defs>
            <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineCls} stopOpacity="0.18" />
              <stop offset="100%" stopColor={lineCls} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#navFill)" />
          <path d={path} fill="none" stroke={lineCls} strokeWidth={1.5} strokeLinejoin="round" />
          {hoverIdx != null && (
            <>
              <line
                x1={X(hoverIdx)}
                x2={X(hoverIdx)}
                y1={PAD_T}
                y2={H - PAD_B}
                stroke="var(--color-ink-mute)"
                strokeWidth={0.5}
                strokeDasharray="2 2"
              />
              <circle cx={X(hoverIdx)} cy={Y(hoverPoint.v)} r={3} fill={lineCls} />
            </>
          )}
        </svg>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p className="t-caption text-[var(--color-ink-mute)]">
          {hoverIdx != null ? fmtMonth(hoverPoint.d) : `Growth of 100 ${currency ?? ""}`}
        </p>
        <p className={`num t-caption ${isUp ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
          {hoverIdx != null ? hoverPoint.v.toFixed(2) : changeText}
        </p>
      </div>
    </div>
  );
}

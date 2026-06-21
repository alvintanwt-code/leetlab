"use client";

import { useState } from "react";

type Point = { d: string; v: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonth(d: string): string {
  const m = d.match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[parseInt(m[2], 10) - 1]} '${m[1].slice(2)}` : d;
}

// Pick 2–3 "nice" tick values across a range. Snaps to {1, 2, 5} × 10ⁿ so the
// markers feel intentional (100 / 110 / 120 instead of 102.3 / 117.6).
function niceTicks(min: number, max: number, target = 3): number[] {
  const range = max - min;
  if (range <= 0) return [Math.round(min)];
  const rough = range / (target - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= rough) ?? 10) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/**
 * Editorial sparkline for /portfolios cards. Reads as a scaled-down growth-of-100
 * panel: a reserved header strip at the top of the SVG carries the terminal value
 * (right) and hover info (left); the chart body below holds the line, dashed
 * gridlines at nice round values, baseline-100 hairline, and hover crosshair.
 *
 * Labels live OUTSIDE the chart body, never overlap the line, never clip at the
 * viewBox edge regardless of value width.
 *
 * `compact` strips the header + Y-axis labels for the row view (~140px wide),
 * keeping just the line and hover dot.
 */
export function PortfolioMiniChart({
  points,
  width = 300,
  height = 100,
  compact = false,
}: {
  points: Point[];
  width?: number;
  height?: number;
  compact?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length < 3) {
    return (
      <div
        className="flex items-center justify-center border border-dashed border-[var(--color-hairline-2)] bg-[var(--color-canvas-soft)]"
        style={{ width, height }}
      >
        <p className="t-micro-cap">No history</p>
      </div>
    );
  }

  const values = points.map((p) => p.v);
  let mn = Math.min(...values);
  let mx = Math.max(...values);
  const pad = (mx - mn) * 0.12 || 2;
  mn -= pad;
  mx += pad;
  // Keep the 100 baseline in frame if it's anywhere close to the rendered range.
  if (mn > 100 - 1) mn = 100 - 1;
  if (mx < 100 + 1) mx = 100 + 1;

  // Header strip at the TOP of the SVG carries the terminal value + hover info.
  // Keeps text labels inside the viewBox — they never clip on wide values or
  // edge-aligned hover positions the way an end-of-line label can.
  const HEADER = compact ? 0 : 18;
  const PAD_L = compact ? 4 : 26;
  const PAD_R = compact ? 4 : 8;
  const PAD_T = HEADER + 4;
  const PAD_B = compact ? 6 : 8;

  const X = (i: number) =>
    PAD_L + ((width - PAD_L - PAD_R) * i) / Math.max(1, points.length - 1);
  const Y = (v: number) => PAD_T + (height - PAD_T - PAD_B) * (1 - (v - mn) / (mx - mn || 1));

  const ticks = compact ? [] : niceTicks(mn, mx, 3);
  // Guarantee the 100 baseline is in the tick list (it's the anchor of the rebased scale).
  const baselineInTicks = ticks.some((t) => Math.abs(t - 100) < 0.5);
  const finalTicks = !compact && !baselineInTicks ? [...ticks, 100].sort((a, b) => a - b) : ticks;

  const path = points
    .map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`)
    .join("");
  const terminal = points[points.length - 1];
  const isUp = terminal.v >= 100;
  const termColor = isUp ? "var(--color-positive)" : "var(--color-negative)";

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = ((e.clientX - rect.left) / rect.width) * width;
    const closest = Math.max(
      0,
      Math.min(
        points.length - 1,
        Math.round(((xRatio - PAD_L) / (width - PAD_L - PAD_R)) * (points.length - 1)),
      ),
    );
    setHoverIdx(closest);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height }}
      onMouseMove={onMove}
      onMouseLeave={() => setHoverIdx(null)}
      role="img"
      aria-label="3-year blended performance"
    >
      {/* Top header strip — hover info on left, terminal value on right.
          Skipped in compact mode (row view stays label-less). */}
      {!compact && (
        <g>
          {hoverPoint ? (
            <text
              x={PAD_L + 2}
              y={13}
              textAnchor="start"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fill="var(--color-ink)"
            >
              <tspan>{fmtMonth(hoverPoint.d)}</tspan>
              <tspan fill="var(--color-ink-mute)"> · </tspan>
              <tspan fontWeight="600">{hoverPoint.v.toFixed(1)}</tspan>
            </text>
          ) : (
            <text
              x={PAD_L + 2}
              y={13}
              textAnchor="start"
              fontSize="9"
              fontFamily="var(--font-mono)"
              fill="var(--color-ink-mute)"
              style={{ letterSpacing: "0.08em" }}
            >
              TRAILING 3Y
            </text>
          )}
          <text
            x={width - 4}
            y={13}
            textAnchor="end"
            fontSize="10"
            fontWeight="600"
            fontFamily="var(--font-mono)"
            fill={termColor}
          >
            {terminal.v.toFixed(1)}
          </text>
        </g>
      )}

      {/* gridlines + Y-axis labels */}
      {finalTicks.map((t) => {
        const isBase = Math.abs(t - 100) < 0.5;
        return (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={width - PAD_R}
              y1={Y(t)}
              y2={Y(t)}
              stroke={isBase ? "var(--color-hairline)" : "var(--color-hairline-2)"}
              strokeWidth="1"
              strokeDasharray={isBase ? undefined : "2 3"}
            />
            <text
              x={PAD_L - 5}
              y={Y(t) + 3}
              textAnchor="end"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
              fill="var(--color-ink-mute)"
              style={{ letterSpacing: "0.04em" }}
            >
              {Math.round(t)}
            </text>
          </g>
        );
      })}

      {/* line */}
      <path
        d={path}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="square"
      />

      {/* terminal dot — value label now lives in the header strip */}
      {!compact && (
        <circle
          cx={X(points.length - 1)}
          cy={Y(terminal.v)}
          r="2.4"
          fill="var(--color-canvas)"
          stroke="var(--color-ink)"
          strokeWidth="1.4"
        />
      )}

      {/* hover crosshair + dot */}
      {hoverPoint && hoverIdx != null && (
        <>
          <line
            x1={X(hoverIdx)}
            x2={X(hoverIdx)}
            y1={PAD_T}
            y2={height - PAD_B}
            stroke="var(--color-ink-mute)"
            strokeWidth="0.7"
            strokeDasharray="2 2"
          />
          <circle
            cx={X(hoverIdx)}
            cy={Y(hoverPoint.v)}
            r="2.6"
            fill="var(--color-canvas)"
            stroke="var(--color-ink)"
            strokeWidth="1.4"
          />
        </>
      )}
    </svg>
  );
}

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
 * panel: dashed gridlines at nice round values, baseline (100) emphasised, terminal
 * dot with value label, hover crosshair + tooltip.
 *
 * `compact` strips the Y-axis labels and terminal value for the row view, where
 * width is tight (~140px).
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

  const PAD_L = compact ? 4 : 26;
  const PAD_R = compact ? 4 : 32;
  const PAD_T = 6;
  const PAD_B = compact ? 6 : 14;

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

  // Place the terminal label so it stays readable when up vs down.
  const termLabelY = Y(terminal.v) + 3;
  const hoverLabelX = hoverIdx != null ? X(hoverIdx) : 0;
  // Keep hover label inside the SVG bounds.
  const hoverLabelAnchor =
    hoverIdx != null && hoverLabelX < PAD_L + 36
      ? "start"
      : hoverIdx != null && hoverLabelX > width - PAD_R - 36
        ? "end"
        : "middle";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height }}
      onMouseMove={onMove}
      onMouseLeave={() => setHoverIdx(null)}
      role="img"
      aria-label="3-year blended performance"
    >
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

      {/* terminal dot + value label */}
      {!compact && (
        <>
          <circle
            cx={X(points.length - 1)}
            cy={Y(terminal.v)}
            r="2.4"
            fill="var(--color-canvas)"
            stroke="var(--color-ink)"
            strokeWidth="1.4"
          />
          <text
            x={X(points.length - 1) + 5}
            y={termLabelY}
            fontSize="9.5"
            fontWeight="600"
            fontFamily="var(--font-mono)"
            fill={termColor}
          >
            {terminal.v.toFixed(1)}
          </text>
        </>
      )}

      {/* hover crosshair + tooltip */}
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
          {!compact && (
            <text
              x={hoverLabelX}
              y={height - 3}
              textAnchor={hoverLabelAnchor}
              fontSize="8.5"
              fontFamily="var(--font-mono)"
              fill="var(--color-ink)"
            >
              <tspan>{fmtMonth(hoverPoint.d)}</tspan>
              <tspan fill="var(--color-ink-mute)"> · </tspan>
              <tspan fontWeight="600">{hoverPoint.v.toFixed(1)}</tspan>
            </text>
          )}
        </>
      )}
    </svg>
  );
}

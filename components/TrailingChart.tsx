"use client";

type SeriesPoint = { d: string; v: number };
type FundOut = { isin: string; name: string; weight: number; points: SeriesPoint[]; terminal: number };
type ModelOut = { points: SeriesPoint[]; terminal: number };

const PAL = ["#2D72D2", "#1C6E42", "#C8102E", "#946638", "#634DBF", "#C8810A", "#0F9960", "#DB2C6F", "#00A396", "#7961DB", "#D9822B", "#5F6B7C"];

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonth(d: string): string {
  const m = d.match(/^(\d{4})-(\d{2})/);
  if (!m) return d;
  return `${MONTHS_SHORT[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

export function TrailingChart({
  funds,
  model,
  commonStart,
  commonEnd,
  skipped,
}: {
  funds: FundOut[];
  model: ModelOut;
  commonStart: string;
  commonEnd: string;
  skipped: number;
}) {
  const W = 1200, H = 360, L = 56, R = 16, T = 16, B = 32;
  const drawn = funds.slice(0, 12);
  const all = drawn.flatMap((f) => f.points.map((p) => p.v)).concat(model.points.map((p) => p.v));
  let mn = Math.min(...all);
  let mx = Math.max(...all);
  const pad = (mx - mn) * 0.06 || 5;
  mn -= pad;
  mx += pad;

  const dates = model.points.map((p) => p.d);
  const X = (j: number) => L + ((W - L - R) * j) / Math.max(1, dates.length - 1);
  const Y = (v: number) => T + (H - T - B) * (1 - (v - mn) / (mx - mn || 1));
  const line = (pts: SeriesPoint[]) => pts.map((p, j) => `${j ? "L" : "M"}${X(j).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");

  // gridlines
  const gridLines = [0, 1, 2, 3, 4].map((i) => {
    const v = mn + ((mx - mn) * i) / 4;
    return { v, y: Y(v) };
  });

  // year ticks
  let lastYr = "";
  const xTicks: { x: number; year: string }[] = [];
  dates.forEach((d, j) => {
    const yr = d.slice(0, 4);
    if (yr !== lastYr) {
      lastYr = yr;
      xTicks.push({ x: X(j), year: yr });
    }
  });

  return (
    <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="t-micro-cap">Trailing performance &middot; growth of 100</p>
          <p className="t-caption mt-0.5 text-[var(--color-ink-mute)]">
            common period <span className="num">{fmtMonth(commonStart)}</span> – <span className="num">{fmtMonth(commonEnd)}</span>,
            monthly, fund-ccy total return
          </p>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label="Trailing performance chart">
        {/* gridlines + y labels */}
        {gridLines.map(({ v, y }) => (
          <g key={v.toFixed(2)}>
            <line x1={L} y1={y} x2={W - R} y2={y} stroke="rgba(13,37,61,0.06)" />
            <text x={L - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--color-ink-mute)" fontFamily="var(--font-mono)">
              {v.toFixed(0)}
            </text>
          </g>
        ))}

        {/* year ticks */}
        {xTicks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={T} x2={t.x} y2={H - B} stroke="rgba(13,37,61,0.03)" />
            <text x={t.x} y={H - B + 16} textAnchor="middle" fontSize="10" fill="var(--color-ink-mute)" fontFamily="var(--font-mono)">
              {t.year}
            </text>
          </g>
        ))}

        {/* component lines */}
        {drawn.map((f, i) => (
          <path
            key={f.isin}
            d={line(f.points)}
            fill="none"
            stroke={PAL[i % PAL.length]}
            strokeWidth="1.2"
            opacity="0.6"
          />
        ))}

        {/* model line */}
        <path d={line(model.points)} fill="none" stroke="#0d253d" strokeWidth="2.4" />

        {/* baseline */}
        <line x1={L} y1={Y(100)} x2={W - R} y2={Y(100)} stroke="rgba(13,37,61,0.20)" strokeDasharray="3 3" />
      </svg>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 t-caption text-[var(--color-ink-2)]">
          <span className="inline-block h-[3px] w-3.5 rounded bg-[#0d253d]" />
          Model portfolio <b className="num font-medium">{model.terminal.toFixed(1)}</b>
        </span>
        {drawn.map((f, i) => (
          <span key={f.isin} className="flex items-center gap-2 t-caption text-[var(--color-ink-mute)]">
            <span className="inline-block h-[3px] w-3.5 rounded" style={{ background: PAL[i % PAL.length] }} />
            {f.name.length > 30 ? f.name.slice(0, 28) + "…" : f.name}{" "}
            <b className="num font-medium">{f.terminal.toFixed(1)}</b>
          </span>
        ))}
      </div>

      <p className="mt-4 t-caption text-[var(--color-ink-mute)]">
        Each line is rebased to 100 at the start of the longest period shared by all charted components;
        the dark line is the weight-blended model (fixed weights, monthly, no rebalancing drift modelled).
        {skipped > 0 && ` ${skipped} component(s) without a public Morningstar series are excluded from the chart but not from the weights of other panels.`}
      </p>
    </div>
  );
}

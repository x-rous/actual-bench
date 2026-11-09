import { useId } from "react";
import type { MonthStatus, Shape } from "@/lib/financial-insights/progress";
import { FONT_STACK } from "../../lib/progressPalette";
import { CHART_HEIGHT, CHART_WIDTH, LABEL, M, XLabels, rootProps, type Common } from "./ShapeChart";

/**
 * Where the squares go: one row for up to 12 months; beyond that as many columns as it takes for the rows to fit the chart, so a long
 * history is smaller squares on several lines. The smallest number of columns that fits is used, so the squares are as large as they can be.
 */
export function stripLayout(n: number, width: number, height: number): { columns: number; size: number; gap: number; rows: number } {
  const gap = 4;
  const first = Math.min(n, 12);
  for (let columns = first; columns <= n; columns++) {
    const size = Math.min(56, (width - gap * (columns - 1)) / columns);
    const rows = Math.ceil(n / columns);
    if (rows * size + (rows - 1) * gap <= height) return { columns, size, gap, rows };
  }
  const size = (width - gap * (n - 1)) / n;
  return { columns: n, size, gap, rows: 1 };
}

/**
 * One square for each month: saved (a tick on green), short (a dash on red) or no income (an empty outline). The mark inside each square
 * says it, so the colour is never the only signal. A long history wraps onto several lines, each labelled with the month it starts at.
 * Nothing here is an amount.
 */
export function StripChart({ strip, xLabels, palette, ariaLabel, frame }: Common & { strip: readonly MonthStatus[]; xLabels: readonly string[] }) {
  const n = strip.length;
  const right = CHART_WIDTH - M.r;
  const wrapped = n > 12;
  // Several lines have a margin on the left for the month each line starts at.
  const left = wrapped ? 74 : 14;
  const layout = stripLayout(n, right - left, wrapped ? 226 : 56);
  const { columns, size, gap, rows } = layout;
  const rowWidth = Math.min(n, columns) * size + (Math.min(n, columns) - 1) * gap;
  const start = wrapped ? left : left + (right - left - rowWidth) / 2;
  const top = wrapped ? (CHART_HEIGHT - (rows * size + (rows - 1) * gap)) / 2 : 88;
  const at = (i: number) => ({ x: start + (i % columns) * (size + gap), y: top + Math.floor(i / columns) * (size + gap) });
  const mark = { fill: "none", stroke: palette.surface, strokeWidth: Math.max(1.4, size / 14), strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} {...rootProps(ariaLabel, frame)} style={{ display: "block" }}>
      {strip.map((status, i) => {
        const { x, y } = at(i);
        return (
          <g key={i}>
            {status === "none"
              ? <rect x={x + 0.75} y={y + 0.75} width={size - 1.5} height={size - 1.5} rx={size / 7} fill="none" stroke={palette.muted} strokeWidth={1.25} strokeDasharray="3 2" />
              : <rect x={x} y={y} width={size} height={size} rx={size / 7} fill={status === "saved" ? palette.good : palette.bad} />}
            {status === "saved" && <path d={`M${x + size * 0.28},${y + size * 0.52} L${x + size * 0.44},${y + size * 0.68} L${x + size * 0.74},${y + size * 0.34}`} {...mark} />}
            {status === "short" && <path d={`M${x + size * 0.3},${y + size * 0.5} H${x + size * 0.7}`} {...mark} />}
          </g>
        );
      })}
      {wrapped
        ? (
          <g fill={palette.muted} {...LABEL} textAnchor="end">
            {Array.from({ length: rows }, (_, r) => <text key={r} x={left - 8} y={top + r * (size + gap) + size / 2 + 4}>{xLabels[r * columns]}</text>)}
          </g>
        )
        : <XLabels labels={xLabels} xs={strip.map((_, i) => at(i).x + size / 2)} palette={palette} left={start} right={start + rowWidth} />}
    </svg>
  );
}

/** Two bars, Start and the end, each 100% of what you own split into types, with a key: shares of the whole, never amounts. */
export function CompositionBars({ classes, startName, endName, start, end, palette, ariaLabel, frame }: Common & { classes: readonly string[]; startName: string; endName: string; start: readonly Shape[]; end: readonly Shape[] }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const left = 14, width = CHART_WIDTH - left - M.r, barH = 44;
  const bar = (shares: readonly Shape[], y: number) => {
    let x = left;
    return shares.map((share, i) => {
      const w = share * width;
      const segment = w > 0 ? <rect key={i} x={x} y={y} width={w} height={barH} fill={palette.classes[i]} stroke={palette.surface} strokeWidth={2} /> : null;
      x += w;
      return segment;
    });
  };
  // The key: a swatch and a name for each type, each placed after the one before by the length of its name.
  const keyXs = classes.reduce<number[]>((xs, _name, i) => [...xs, i === 0 ? left : xs[i - 1] + 28 + classes[i - 1].length * 7.5 + 22], []);
  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} {...rootProps(ariaLabel, frame)} style={{ display: "block" }}>
      <text x={left} y={42} fill={palette.ink} fontFamily={FONT_STACK} fontSize={14} fontWeight={600}>{startName}</text>
      <clipPath id={`${id}-a`}><rect x={left} y={52} width={width} height={barH} rx={8} /></clipPath>
      <g clipPath={`url(#${id}-a)`}>{bar(start, 52)}</g>
      <text x={left} y={134} fill={palette.ink} fontFamily={FONT_STACK} fontSize={14} fontWeight={600}>{endName}</text>
      <clipPath id={`${id}-b`}><rect x={left} y={144} width={width} height={barH} rx={8} /></clipPath>
      <g clipPath={`url(#${id}-b)`}>{bar(end, 144)}</g>
      <g {...LABEL} fill={palette.muted}>
        {classes.map((name, i) => <g key={name}><rect x={keyXs[i]} y={226} width={12} height={12} rx={3} fill={palette.classes[i]} /><text x={keyXs[i] + 18} y={237}>{name}</text></g>)}
      </g>
    </svg>
  );
}

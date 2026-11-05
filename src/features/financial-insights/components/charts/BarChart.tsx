"use client";

import { useRef, type ReactNode } from "react";
import { compactAxis, labelMoney } from "../../format";
import { tickLabel } from "./labels";
import { useTip, useWidth } from "./Tip";

export type BarSeries = { key: string; label: string; colour: string; values: (number | null)[] };

const MARGIN = { l: 46, r: 8, t: 10, b: 22 };
/** A line drawn over the bars on the same axis. */
export type BarOverlay = { label: string; colour: string; values: (number | null)[] };
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Value-axis ticks and the y scale for a range that may cross zero. */
export function scaleY(lo: number, hi: number, height: number, top: number, bottom: number, ticks = 4) {
  const span = hi - lo || 1;
  const y = (v: number) => top + ((hi - v) / span) * (height - top - bottom);
  const step = niceStep(span / ticks);
  const marks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) marks.push(v);
  return { y, marks };
}

/**
 * Bars by month, side by side or stacked. Negative values hang below the zero line. The partial month is drawn lighter with a
 * dashed outline and an asterisk, so it is never mistaken for a full month. Hovering shows the tooltip for the month; selecting
 * a bar or segment reports the month and the series, so the figure and the transactions behind it can be opened together.
 */
/** The narrowest a month's slot may be for its total to be written above the bar without touching its neighbours'. */
const TOTAL_MIN_SLOT = 38;

export function BarChart({ labels, partialIndex, series, stacked = false, height = 230, tip, onSelect, ariaLabel, topLabel, totals = false, valueLabels = false, overlayLabels = false, overlay, base }: {
  labels: string[];
  partialIndex: number | readonly number[] | null;
  series: BarSeries[];
  stacked?: boolean;
  height?: number;
  tip: (index: number, seriesIndex: number | null) => ReactNode;
  onSelect?: (index: number, seriesIndex: number) => void;
  ariaLabel: string;
  /** Text above the top of a month's stack (stacked bars only), for example one segment's amount; nothing when null. */
  topLabel?: (index: number) => { text: string; colour?: string } | null;
  /**
   * Stacked bars only: each month's total above its stack, so the height can be read without the axis. Left out when the
   * months are too narrow for it, and for a month that totals nothing; the tooltip and table still give every figure.
   */
  totals?: boolean;
  /**
   * Side-by-side bars only: each bar's own value above it (below it for a negative one), for a chart whose bars are few or
   * single: a bar whose slot is too narrow for the figure goes without, and a bar of nothing has none.
   */
  valueLabels?: boolean;
  /** With an `overlay`: each marker's value above it, or above the stack when the stack reaches higher. */
  overlayLabels?: boolean;
  /** A line with a marker per month on the same axis as the bars. */
  overlay?: BarOverlay;
  /**
   * Stacked bars only: where each month's stack starts (for example the opening balance), so the stack floats on the axis, with
   * increases above and decreases below it. The axis then fits the stacks and the line instead of running through zero.
   */
  base?: (number | null)[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  const { show, hide } = useTip();
  const n = labels.length;
  let hi = 0, lo = 0;
  let anchored = false;
  for (let i = 0; i < n; i++) {
    const start = base ? base[i] : 0;
    if (start === null || start === undefined) continue;
    let up = start, down = start;
    for (const s of series) {
      const v = s.values[i] ?? 0;
      if (stacked) { if (v >= 0) up += v; else down += v; } else { hi = Math.max(hi, v); lo = Math.min(lo, v); }
    }
    if (stacked) { if (base && !anchored) { hi = up; lo = down; anchored = true; } else { hi = Math.max(hi, up); lo = Math.min(lo, down); } }
  }
  for (const v of overlay?.values ?? []) if (v !== null) { if (base && !anchored) { hi = lo = v; anchored = true; } hi = Math.max(hi, v); lo = Math.min(lo, v); }
  if (base) { const room = (hi - lo) * 0.08 || 1; hi += room; lo -= room; if (lo < 0 && lo + room >= 0) lo = 0; }
  else { hi = hi * 1.06 || 1; lo = lo * 1.06; }
  const { y, marks } = scaleY(lo, hi, height, MARGIN.t, MARGIN.b);
  const axis = compactAxis(marks);
  const slot = (width - MARGIN.l - MARGIN.r) / Math.max(1, n);
  // On a long period the slots are only a few pixels: the gaps shrink with them (never past a quarter of the slot) so a bar keeps a width.
  const pad = Math.min(Math.max(3, slot * 0.16), slot * 0.25);
  // A bar keeps a pixel where it can, but never more than its own slot, so neighbouring months never overlap.
  const inner = Math.min(slot, Math.max(1, slot - pad * 2));
  // Where each month's stack reaches above its start, so a label can clear it.
  const stackTops = labels.map((_, i) => (stacked ? series.reduce((top, s) => top + Math.max(0, s.values[i] ?? 0), base?.[i] ?? 0) : 0));
  // A label that would fall outside the drawing (a stack that reaches the very top or bottom) stays inside it.
  const inside = (labelY: number) => Math.min(height - MARGIN.b - 2, Math.max(MARGIN.t + 2, labelY));
  const style = (colour: string, partial: boolean) => ({ fill: colour, fillOpacity: partial ? 0.38 : 1, stroke: partial ? colour : "none", strokeDasharray: partial ? "3 2" : undefined, strokeWidth: partial ? 1.2 : 0 });
  return (
    <div ref={host} className="w-full">
      <svg width={width} height={height} role="group" aria-label={ariaLabel}>
        {marks.map((v, k) => (
          <g key={v}><line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity={0.6} /><text x={MARGIN.l - 6} y={y(v) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10.5px]">{axis[k]}</text></g>
        ))}
        {lo < 0 && <line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1.2} />}
        {labels.map((label, i) => {
          const x0 = MARGIN.l + i * slot;
          const partial = Array.isArray(partialIndex) ? partialIndex.includes(i) : i === partialIndex;
          const bars: ReactNode[] = [];
          let stackTop = 0;
          let stackBottom = 0;
          let stackTotal = 0;
          if (stacked) {
            let up = base?.[i] ?? 0, down = base?.[i] ?? 0;
            series.forEach((s, k) => {
              const v = s.values[i] ?? 0;
              if (!v) return;
              const a = v >= 0 ? up : down, b = a + v;
              if (v >= 0) up = b; else down = b;
              bars.push(<rect key={s.key} x={x0 + pad} y={Math.min(y(a), y(b))} width={inner} height={Math.max(1, Math.abs(y(a) - y(b)) - 1.5)} rx={2} {...style(s.colour, partial)}
                className={onSelect ? "cursor-pointer" : undefined} onClick={onSelect ? () => onSelect(i, k) : undefined} onMouseMove={(e) => show(tip(i, k), e)} onMouseLeave={hide}
                role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? `${s.label}, ${label}` : undefined}
                onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i, k); } } : undefined} />);
            });
            stackTop = up;
            stackBottom = down;
            stackTotal = series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
          } else {
            const w = inner / series.length;
            series.forEach((s, k) => {
              // A value that is not known draws no bar, so there is nothing to focus or select for it.
              const known = s.values[i];
              if (known === null || known === undefined) return;
              const v = known;
              if (valueLabels && v !== 0 && w >= TOTAL_MIN_SLOT * 0.9) bars.push(<text key={`${s.key}-value`} x={x0 + pad + k * w + w / 2} y={v > 0 ? y(v) - 4 : y(v) + 12} textAnchor="middle" className="fill-foreground text-[10.5px] font-medium" aria-hidden>{labelMoney(v)}</text>);
              bars.push(<rect key={s.key} x={x0 + pad + k * w + (w > 4 ? 1 : 0)} y={Math.min(y(0), y(v))} width={w > 4 ? Math.max(2, w - 3) : w} height={Math.max(v === 0 ? 0 : 1, Math.abs(y(0) - y(v)))} rx={3} {...style(s.colour, partial)}
                className={onSelect ? "cursor-pointer" : undefined} onClick={onSelect ? () => onSelect(i, k) : undefined} onMouseMove={(e) => show(tip(i, k), e)} onMouseLeave={hide}
                role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? `${s.label}, ${label}` : undefined}
                onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i, k); } } : undefined} />);
            });
          }
          return (
            <g key={label + i}>
              <rect x={x0} y={MARGIN.t} width={slot} height={height - MARGIN.t - MARGIN.b} fill="transparent" onMouseMove={(e) => show(tip(i, null), e)} onMouseLeave={hide} />
              {bars}
              {stacked && totals && slot >= TOTAL_MIN_SLOT && stackTotal !== 0 && <text x={x0 + slot / 2} y={inside(stackTotal > 0 ? y(stackTop) - 4 : y(stackBottom) + 12)} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold" aria-hidden>{labelMoney(stackTotal)}</text>}
              {stacked && topLabel?.(i) && <text x={x0 + slot / 2} y={y(stackTop) - 4} textAnchor="middle" className="text-[10.5px] font-semibold" style={{ fill: topLabel(i)?.colour ?? "var(--foreground)" }} aria-hidden>{topLabel(i)?.text}</text>}
              <text x={x0 + slot / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{tickLabel(label, i, slot)}{partial ? "*" : ""}</text>
            </g>
          );
        })}
        {overlay && (() => {
          const cx = (i: number) => MARGIN.l + (i + 0.5) * slot;
          const runs: string[][] = [];
          overlay.values.forEach((v, i) => { if (v === null) { runs.push([]); return; } if (!runs.length) runs.push([]); runs[runs.length - 1].push(`${cx(i)},${y(v)}`); });
          return (
            <g pointerEvents="none">
              {runs.filter((r) => r.length > 1).map((r, k) => <polyline key={k} fill="none" stroke={overlay.colour} strokeWidth={2.25} strokeLinejoin="round" points={r.join(" ")} />)}
              {overlayLabels && slot >= TOTAL_MIN_SLOT && overlay.values.map((v, i) => v === null ? null : <text key={`label-${i}`} x={cx(i)} y={inside(Math.min(y(v) - 9, stacked ? y(stackTops[i]) - 4 : Infinity))} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold" aria-hidden>{labelMoney(v)}</text>)}
              {overlay.values.map((v, i) => v === null ? null : <circle key={i} cx={cx(i)} cy={y(v)} r={3.5} fill="var(--card)" stroke={overlay.colour} strokeWidth={2} strokeDasharray={i === partialIndex ? "2 1.5" : undefined} />)}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

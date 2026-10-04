import type { WaterfallSegment } from "./varianceWaterfall";

/**
 * Chart geometry for the dialog's SVG charts, kept out of the components so the
 * scales can be tested without a DOM.
 */

/** Round tick values up to 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceTicks(max: number, count: number): number[] {
  if (!(max > 0) || count < 1) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const step =
    (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) *
    magnitude;
  const ticks: number[] = [];
  for (let value = 0; ; value += step) {
    ticks.push(value);
    if (value >= max) break;
  }
  return ticks;
}

export type WaterfallAxis = {
  /** Value at the bottom of the plot. Zero unless the axis is cut. */
  min: number;
  /** Value at the top of the plot. */
  max: number;
  ticks: number[];
  /** The axis starts above zero so small drivers are visible. */
  truncated: boolean;
};

/** A waterfall whose steps are under this share of its level is cut to show them. */
export const TRUNCATE_BELOW_SPAN_SHARE = 0.25;

/**
 * The value range for a waterfall.
 *
 * Budget and actual are tall, drivers are short, and on a zero baseline a 4%
 * overspend is a few pixels. When the whole walk stays within a narrow band the
 * axis starts below that band instead, and the chart says so. The numbers on
 * every bar are unchanged.
 */
export function waterfallAxis(
  segments: readonly WaterfallSegment[],
  tickCount = 4
): WaterfallAxis {
  const levels = segments.flatMap((s) => (s.kind === "total" ? [s.to] : [s.from, s.to]));
  const top = Math.max(0, ...levels);
  const bottom = Math.min(...levels);
  const span = top - bottom;
  if (top > 0 && span / top < TRUNCATE_BELOW_SPAN_SHARE && segments.length > 2) {
    const room = Math.max(span, 1);
    const low = Math.max(0, bottom - room * 1.4);
    const high = top + room * 0.4;
    const step = niceTicks((high - low) / tickCount, 1)[1] ?? 1;
    const min = Math.floor(low / step) * step;
    const ticks: number[] = [];
    for (let v = min; ; v += step) {
      ticks.push(v);
      if (v >= high) break;
    }
    return { min, max: ticks[ticks.length - 1], ticks, truncated: min > 0 };
  }
  const ticks = niceTicks(top * 1.06, tickCount);
  return { min: 0, max: ticks[ticks.length - 1], ticks, truncated: false };
}

export type BarsAxis = {
  /** Tick values above zero, ascending (excluding zero). */
  up: number[];
  /** Tick values below zero as positive magnitudes, ascending. */
  down: number[];
  /** Units from zero to the top and to the bottom of the plot. */
  upMax: number;
  downMax: number;
};

/**
 * The range for a chart drawn around a zero line, with one scale above and
 * below. Both sides use the same step so bars compare honestly, and the lesser
 * side keeps a minimum share of the height so it never collapses to nothing.
 */
export function barsAxis(positive: number, negative: number): BarsAxis {
  const high = Math.max(1, positive);
  const low = Math.max(0, negative);
  const step = niceTicks(Math.max(high, low) * 1.15, 3)[1] ?? 1;
  const upCount = Math.max(1, Math.ceil((high * 1.12) / step));
  const downCount = Math.max(1, Math.ceil(Math.max(low * 1.12, high * 0.18) / step));
  return {
    up: Array.from({ length: upCount }, (_, i) => (i + 1) * step),
    down: Array.from({ length: downCount }, (_, i) => (i + 1) * step),
    upMax: upCount * step,
    downMax: downCount * step,
  };
}

/** The smallest drawn bar, so a tiny variance stays visible. The true value stays in the tooltip. */
export const MIN_BAR_PX = 3;

export function barLength(valuePerPx: number, value: number): number {
  return value === 0 ? 0 : Math.max(MIN_BAR_PX, Math.abs(value) / valuePerPx);
}

/** Split a label into at most `lines` lines of at most `max` characters, ending in an ellipsis if cut. */
export function wrapLabel(label: string, max: number, lines = 2): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= max) current = `${current} ${word}`;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  const kept = out.slice(0, lines).map((line) => (line.length > max ? `${line.slice(0, Math.max(1, max - 1))}…` : line));
  if (out.length > lines) kept[lines - 1] = `${kept[lines - 1].replace(/…$/, "")}…`;
  return kept;
}

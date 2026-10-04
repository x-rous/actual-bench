import { addMonths } from "@/lib/budget/monthMath";
import { median } from "./varianceMath";
import { aggregateFor, type VarianceModel } from "./varianceViewModel";

/**
 * Historical context: what these categories typically cost per month.
 *
 * Explanatory only. Nothing here feeds a variance figure.
 *
 * Priority:
 *   1. The same months a year earlier, when every one of them is closed and
 *      loaded.
 *   2. The median of the closed months just before the period.
 * Either needs at least three months, or nothing is shown.
 */

export const MIN_HISTORY_MONTHS = 3;
const MEDIAN_WINDOW = 6;

export type Baseline = {
  kind: "year-ago" | "median";
  /** The months the figure was built from, oldest first. */
  months: string[];
  /** Typical actual per month, minor units. Not rounded. */
  typicalPerMonth: number;
};

/** The months a baseline could read, so the caller can load them first. */
export function historyMonths(months: readonly string[]): string[] {
  if (months.length === 0) return [];
  const yearAgo = months.map((m) => addMonths(m, -12));
  const before = Array.from({ length: MEDIAN_WINDOW }, (_, i) =>
    addMonths(months[0], -(i + 1))
  ).reverse();
  return [...new Set([...yearAgo, ...before])].sort();
}

export function buildBaseline(args: {
  model: VarianceModel;
  categoryIds: readonly string[];
  months: readonly string[];
  /** Only closed months are history; the open month is still moving. */
  isClosed: (month: string) => boolean;
}): Baseline | null {
  const { model, categoryIds, months, isClosed } = args;
  if (months.length === 0 || categoryIds.length === 0) return null;
  const usable = (m: string) => model.statesByMonth.has(m) && isClosed(m);

  const yearAgo = months.map((m) => addMonths(m, -12));
  if (months.length >= MIN_HISTORY_MONTHS && yearAgo.every(usable)) {
    const total = aggregateFor(model, categoryIds, yearAgo).actual;
    return { kind: "year-ago", months: yearAgo, typicalPerMonth: total / yearAgo.length };
  }

  const before = Array.from({ length: MEDIAN_WINDOW }, (_, i) =>
    addMonths(months[0], -(MEDIAN_WINDOW - i))
  ).filter(usable);
  if (before.length >= MIN_HISTORY_MONTHS) {
    const monthly = aggregateFor(model, categoryIds, before).actualByMonth;
    return { kind: "median", months: before, typicalPerMonth: median(monthly) };
  }
  return null;
}

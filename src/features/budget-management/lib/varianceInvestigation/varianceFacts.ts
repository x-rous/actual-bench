import { addMonths } from "@/lib/budget/monthMath";
import type { Baseline } from "./varianceBaseline";
import { selectedCategoryIds, selectedDrivers } from "./varianceSelection";
import {
  aggregateFor,
  type Aggregate,
  type Driver,
  type VarianceModel,
} from "./varianceViewModel";

/**
 * What the investigation panel says about the selected drivers.
 *
 * Figures come from the monthly payload. Wording that sounds like judgement is
 * limited to counts and thresholds that can be stated: "over in 6 of 8
 * months", never "excessive".
 */

export type PatternTag = "repeated" | "unusual" | "budget-below-typical";

/** Over in this share of the months, with at least three of them, is a repeat. */
export const REPEAT_SHARE = 0.6;
/** A budget under this share of typical spending reads as low. */
export const LOW_BUDGET_SHARE = 0.9;
/** The window used when the period is too short to show a pattern. */
export const RECENT_WINDOW = 6;

export function recentMonths(
  periodMonths: readonly string[],
  window: number = RECENT_WINDOW
): string[] {
  if (periodMonths.length === 0) return [];
  const last = periodMonths[periodMonths.length - 1];
  return Array.from({ length: window }, (_, i) => addMonths(last, -(window - 1 - i)));
}

export type SelectionFacts = {
  drivers: Driver[];
  categoryIds: string[];
  aggregate: Aggregate;
  /** Share of overspend / shortfall the selected unfavourable drivers hold. */
  shareUnfavourable: number | null;
  /** Share of savings / surplus the selected favourable drivers hold. */
  shareFavourable: number | null;
  /** `actual / budget`; `null` when there is no budget. */
  budgetUsed: number | null;
  /** Largest member category by variance, when the selection has several. */
  topCategory: { name: string; share: number } | null;
  peakMonth: { month: string; variance: number } | null;
  /** The months the pattern was judged over, and how many were over. */
  pattern: { months: number; over: number; tags: PatternTag[] };
};

export function buildSelectionFacts(args: {
  model: VarianceModel;
  driverIds: readonly string[];
  baseline: Baseline | null;
  /** Used for the pattern when the period has fewer than three months. */
  context?: readonly string[];
}): SelectionFacts {
  const { model, driverIds, baseline } = args;
  const drivers = selectedDrivers(model, driverIds);
  const categoryIds = selectedCategoryIds(model, driverIds);
  const aggregate = aggregateFor(model, categoryIds, model.months);

  const heldUnfavourable = drivers
    .filter((d) => d.variance > 0)
    .reduce((t, d) => t + d.variance, 0);
  const heldFavourable = drivers
    .filter((d) => d.variance < 0)
    .reduce((t, d) => t - d.variance, 0);

  // Top category: the biggest contributor in the direction the selection went.
  let topCategory: SelectionFacts["topCategory"] = null;
  if (categoryIds.length > 1 && aggregate.variance !== 0) {
    const sign = aggregate.variance > 0 ? 1 : -1;
    const parts = categoryIds
      .map((id) => ({
        name: model.categories.find((c) => c.id === id)?.name ?? id,
        value: aggregateFor(model, [id], model.months).variance * sign,
      }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);
    const sum = parts.reduce((t, p) => t + p.value, 0);
    if (parts.length > 0 && sum > 0) {
      topCategory = { name: parts[0].name, share: parts[0].value / sum };
    }
  }

  let peakMonth: SelectionFacts["peakMonth"] = null;
  aggregate.varianceByMonth.forEach((variance, k) => {
    if (!peakMonth || Math.abs(variance) > Math.abs(peakMonth.variance)) {
      peakMonth = { month: aggregate.months[k], variance };
    }
  });

  // Judge a pattern over the period when it is long enough, else over the
  // recent months, so a single month is read in context.
  const patternAggregate =
    aggregate.months.length >= 3
      ? aggregate
      : aggregateFor(model, categoryIds, args.context ?? recentMonths(model.months));
  const envelope = patternAggregate.envelope;
  const over = envelope ? envelope.deficitMonths : patternAggregate.monthsOver;
  const considered = patternAggregate.monthsPresent;
  const unfavourableNow = envelope
    ? (aggregate.envelope?.deficit ?? 0) > 0
    : aggregate.variance > 0;

  const tags: PatternTag[] = [];
  if (unfavourableNow && considered >= 3 && over / considered >= REPEAT_SHARE) {
    tags.push("repeated");
  } else if (unfavourableNow && over <= 1) {
    tags.push("unusual");
  }
  const months = aggregate.months.length;
  if (
    !envelope &&
    unfavourableNow &&
    baseline &&
    months > 0 &&
    aggregate.budget / months < LOW_BUDGET_SHARE * baseline.typicalPerMonth
  ) {
    tags.push("budget-below-typical");
  }

  return {
    drivers,
    categoryIds,
    aggregate,
    shareUnfavourable: heldUnfavourable > 0 && model.gross.unfavourable > 0
      ? heldUnfavourable / model.gross.unfavourable
      : null,
    shareFavourable: heldFavourable > 0 && model.gross.favourable > 0
      ? heldFavourable / model.gross.favourable
      : null,
    budgetUsed: aggregate.budget > 0 ? aggregate.actual / aggregate.budget : null,
    topCategory,
    peakMonth,
    pattern: { months: considered, over, tags },
  };
}

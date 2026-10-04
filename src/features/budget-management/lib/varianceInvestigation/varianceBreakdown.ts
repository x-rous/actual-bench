import { aggregateCategories, type Aggregate, type VarianceModel } from "./varianceViewModel";

/**
 * The by-category and by-month breakdown of a selected driver, from the
 * monthly budget payload, with a short list of checkable signals per row.
 */

export type BreakdownSignal =
  | "unbudgeted"
  | "net-refund"
  | "repeated"
  | "deficit"
  | "covered"
  | "carryover"
  | "largest-month";

export const BREAKDOWN_SIGNAL_LABELS: Record<BreakdownSignal, string> = {
  unbudgeted: "Unbudgeted",
  "net-refund": "Net refund",
  repeated: "Repeated overspend",
  deficit: "Deficit",
  covered: "Covered by balance",
  carryover: "Carryover on",
  "largest-month": "Largest month",
};

export type BreakdownRow = {
  key: string;
  label: string;
  /** Set on a by-month row. */
  month: string | null;
  hidden: boolean;
  aggregate: Aggregate;
  signals: BreakdownSignal[];
};

/** Over in this share of three or more months reads as a repeat. */
export const REPEAT_ROW_SHARE = 0.75;
const MAX_SIGNALS = 2;

function rowSignals(
  model: VarianceModel,
  aggregate: Aggregate,
  options: { category: boolean; largestMonth: boolean }
): BreakdownSignal[] {
  const out: BreakdownSignal[] = [];
  const envelope = aggregate.envelope;
  if (aggregate.budget === 0 && aggregate.actual > 0) out.push("unbudgeted");
  if (model.side === "expense" && aggregate.actual < 0) out.push("net-refund");
  if (envelope) {
    if (envelope.closing < 0) out.push("deficit");
    else if (aggregate.variance > 0) out.push("covered");
    if (options.category && envelope.carryoverCount > 0) out.push("carryover");
  } else if (
    options.category &&
    aggregate.monthsPresent >= 3 &&
    aggregate.variance > 0 &&
    aggregate.monthsOver / aggregate.monthsPresent >= REPEAT_ROW_SHARE
  ) {
    out.push("repeated");
  }
  if (options.largestMonth) out.push("largest-month");
  return out.slice(0, MAX_SIGNALS);
}

/** One row per category, each summed over `months`. Rows with nothing in them are left out. */
export function buildCategoryBreakdown(
  model: VarianceModel,
  categoryIds: readonly string[],
  months: readonly string[]
): BreakdownRow[] {
  const wanted = new Set(categoryIds);
  return model.categories
    .filter((c) => wanted.has(c.id))
    .map((category) => {
      const aggregate = aggregateCategories([category], months, model.side, model.mode);
      return {
        key: category.id,
        label: category.name,
        month: null,
        hidden: category.hidden,
        aggregate,
        signals: rowSignals(model, aggregate, { category: true, largestMonth: false }),
      };
    })
    .filter((row) => row.aggregate.budget !== 0 || row.aggregate.actual !== 0);
}

/** One row per month, summed over the chosen categories. */
export function buildMonthBreakdown(
  model: VarianceModel,
  categoryIds: readonly string[],
  months: readonly string[]
): BreakdownRow[] {
  const wanted = new Set(categoryIds);
  const categories = model.categories.filter((c) => wanted.has(c.id));
  const aggregates = months.map((month) =>
    aggregateCategories(categories, [month], model.side, model.mode)
  );
  const largest = Math.max(0, ...aggregates.map((a) => a.variance));
  return months
    .map((month, k): BreakdownRow => {
      const aggregate = aggregates[k];
      return {
        key: month,
        label: month,
        month,
        hidden: false,
        aggregate,
        signals: rowSignals(model, aggregate, {
          category: false,
          largestMonth:
            !aggregate.envelope && months.length > 1 && aggregate.variance > 0 && aggregate.variance === largest,
        }),
      };
    })
    .filter((row) => row.aggregate.budget !== 0 || row.aggregate.actual !== 0);
}

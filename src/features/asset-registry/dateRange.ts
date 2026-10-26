import { resolveDateRange, type PickerFilterState } from "@/components/transactions/transactionPickerQuery";
import { yearsBetween } from "@/lib/asset-registry/yields";

/** The date range a table and its KPI strip share: the same value the transaction picker's Date filter holds. */
export type AssetRange = PickerFilterState["date"];
/** The default for every table: the whole history. */
export const ALL_TIME: AssetRange = { preset: "all" };
export const isAllTime = (range: AssetRange): boolean => range.preset === "all";

/**
 * The inclusive dates a range means, for the KPI strip. An open start is the first date of the asset's history and an
 * open end is today; a range never reaches into the future (there is no dated value to report on) or before the history.
 * `years` is the length of that span, for the yearly yields.
 */
export function effectiveRange(range: AssetRange, today: string, firstDate: string): { from: string; to: string; years: number } {
  const { from, to } = resolveDateRange(range, today);
  const end = to && to < today ? to : today;
  const start = from && from > firstDate ? from : firstDate;
  const years = start < end ? yearsBetween(start, end) : 0;
  return { from: start, to: end, years };
}

/** Whether a date falls inside the range as the table filters it (open ends are unbounded). */
export function inRange(range: AssetRange, today: string, date: string): boolean {
  const { from, to } = resolveDateRange(range, today);
  return (!from || date >= from) && (!to || date <= to);
}

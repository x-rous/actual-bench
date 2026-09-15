import { downloadCsv } from "@/lib/csv";
import { firstDayOfMonth, lastDayOfMonth } from "@/lib/budget/monthMath";
import type { BudgetTransactionCategoryOption } from "../../lib/budgetTransactionBrowser";
import type { BudgetTransactionRow } from "../../lib/budgetTransactionsQuery";

/**
 * The dialog's accent, chosen by the side being shown.
 *
 * Money out and money in are the same shapes in the same layout, and a shared
 * accent left the two reading as one screen - the only thing separating them
 * was the copy. Colour does that work before the words are read. Expense keeps
 * the app's `primary`; income borrows the emerald already used for favourable
 * figures across this feature, so nothing new enters the palette.
 */
export type Accent = {
  /** Solid fill for a selected bar or a full progress track. */
  solid: string;
  /** Resting fill - present but quieter than `solid`. */
  soft: string;
  /** Tint behind a selected breakdown row. */
  tint: string;
  /** Ring around a selected element. */
  ring: string;
  /** Text and icon colour on the dialog ground. */
  text: string;
  /** Border colour for the chart's average line and its label chip. */
  border: string;
  /** Text colour for a label sitting on top of `solid`. */
  onSolid: string;
  /**
   * Fill for the stretch of the budget bar beyond the plan.
   *
   * Passing the plan is a failure on the expense side and a success on the
   * income side, so the two cannot share a colour. The bar used to paint both
   * in the destructive tone, which told anyone beating their income target that
   * something had gone wrong.
   */
  over: string;
  /** Text colour for a label sitting on top of `over`. */
  onOver: string;
};

export const EXPENSE_ACCENT: Accent = {
  solid: "bg-primary",
  soft: "bg-primary/55",
  tint: "bg-primary/10",
  ring: "ring-primary/30",
  text: "text-primary",
  border: "border-primary/45",
  onSolid: "text-primary-foreground",
  over: "bg-destructive",
  onOver: "text-white",
};

export const INCOME_ACCENT: Accent = {
  solid: "bg-emerald-600 dark:bg-emerald-500",
  soft: "bg-emerald-600/55 dark:bg-emerald-500/55",
  tint: "bg-emerald-500/10",
  ring: "ring-emerald-500/30",
  text: "text-emerald-700 dark:text-emerald-400",
  border: "border-emerald-500/45",
  onSolid: "text-white",
  // Deeper than `solid`, so beating the target reads as more of the same
  // good thing rather than as a different state.
  over: "bg-emerald-800 dark:bg-emerald-300",
  onOver: "text-white dark:text-emerald-950",
};

// ─── formatting ──────────────────────────────────────────────────────────────

export function amountTone(amount: number): string {
  if (amount < 0) return "text-destructive";
  if (amount > 0) return "text-emerald-700 dark:text-emerald-400";
  return "text-muted-foreground";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

export function optionKey(option: BudgetTransactionCategoryOption): string {
  return `${option.entity}:${option.id}`;
}

/**
 * The rows on screen, as a CSV.
 *
 * Exports what is *visible* - after the search, the breakdown selection and the
 * time bucket - rather than everything fetched. The figures beside it describe
 * the filtered set, and a file that disagreed with them would be worse than no
 * file.
 *
 * Amounts keep their cents here even though the dialog rounds. A spreadsheet is
 * where someone goes to do arithmetic, and rounding on the way out would make
 * their totals drift from the ones they came for.
 */
export function exportTransactionsCsv(
  rows: BudgetTransactionRow[],
  title: string,
  monthLabel: string
): void {
  const header = ["Date", "Payee", "Category", "Notes", "Amount"];
  const body = rows.map((row) => [
    row.date,
    row.payeeName ?? "",
    row.categoryName ?? "",
    row.notes ?? "",
    (row.amount / 100).toFixed(2),
  ]);
  const slug = `${title} ${monthLabel}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  downloadCsv(`transactions-${slug || "export"}.csv`, [header, ...body]);
}

// ─── row bucketing ───────────────────────────────────────────────────────────

/**
 * Days the range has actually run for, so a rate divides by time that happened.
 *
 * Dividing by the range's full calendar length would count days that have not
 * arrived: a drill-through opened on the 3rd of the month would read as a
 * thirtieth of the real burn rate, and then climb all month as the denominator
 * caught up with the numerator. Capping at today makes the figure answer "how
 * fast am I spending" for the period being lived in, which is the only period
 * where the question is urgent. A range wholly in the past is unaffected - its
 * last day is already behind us, so the cap never binds.
 */
export function elapsedDaysInRange(
  monthStart: string,
  monthEnd: string,
  today: Date = new Date()
): number {
  return elapsedDaysBetween(monthStart, monthEnd, today);
}

function elapsedDaysBetween(monthStart: string, monthEnd: string, today: Date): number {
  const start = Date.parse(`${firstDayOfMonth(monthStart)}T00:00:00Z`);
  const end = Date.parse(`${lastDayOfMonth(monthEnd)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;

  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const last = Math.min(end, todayUtc);
  if (last < start) return 0;
  // Inclusive of both ends: a range that started today has run for one day, not
  // zero, and a zero here would make the rate infinite.
  return Math.floor((last - start) / 86_400_000) + 1;
}

/**
 * Which bucket of the "when" panel a row belongs to.
 *
 * It has to answer in the same vocabulary the panel is currently charting, and
 * that vocabulary changes with the range: a single month is bucketed by week
 * (`week-3`), a range of months by month (`2026-03`). Getting this wrong is
 * silent - the ids simply never match, every row is filtered out, and the table
 * reads as "no transactions" rather than as a bug.
 */
export function rowTimeBucketId(date: string, byMonth: boolean): string {
  if (byMonth) return date.slice(0, 7);
  const day = Number(date.slice(-2)) || 1;
  const week = Math.min(5, Math.max(1, Math.floor((day - 1) / 7) + 1));
  return `week-${week}`;
}

export type BreakdownDimension = "group" | "category" | "payee";

/**
 * The bucket a row falls into, in the vocabulary of the list on screen.
 *
 * The vocabulary is which list is being drawn, not what kind of thing was
 * drilled into. It used to be the latter, which was the same answer back when a
 * group could only ever show categories - but a group can show payees now, and
 * the bucket id was then matched against the row's category name. No category
 * is called "Carrefour", so every payee click on a group emptied the table.
 *
 * A transaction carries its category's name and nothing above it, so the group
 * dimension needs the category-to-group map to resolve one; without it every
 * row answers "Ungrouped", which at least fails visibly rather than silently.
 */
export function rowBucketLabel(
  row: BudgetTransactionRow,
  dimension: BreakdownDimension,
  groupByCategoryName: Map<string, string> | null
): string {
  if (dimension === "payee") return row.payeeName?.trim() || "No payee";
  const categoryName = row.categoryName?.trim() || "Uncategorized";
  if (dimension === "category") return categoryName;
  return groupByCategoryName?.get(categoryName) ?? "Ungrouped";
}

/**
 * The next selection after a click on a breakdown row or a chart bar.
 *
 * A plain click replaces, because that is what clicking a chart means
 * everywhere; Ctrl or Cmd adds and removes, so several buckets can be compared
 * without hunting for a parent that contains exactly them. A plain click on a
 * sole selection clears it, which makes every click its own undo - but a plain
 * click on one of several narrows to it rather than clearing, since throwing
 * the others away is not what clicking a highlighted bar means.
 */
export function nextBucketSelection(
  current: string[],
  id: string,
  additive: boolean
): string[] {
  if (additive) {
    return current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id];
  }
  return current.length === 1 && current[0] === id ? [] : [id];
}

/**
 * Elapsed days across a set of months that need not be adjacent.
 *
 * Summed per month rather than measured from the first to the last, because the
 * set can have holes in it: picking January and March out of a year spans
 * ninety days but only sixty of them were selected, and dividing the spend of
 * two months by the length of three understates the rate by a third. It also
 * left the per-day figure disagreeing with the per-month average beside it,
 * which divides by the count.
 */
export function elapsedDaysInMonths(months: string[], today: Date = new Date()): number {
  let total = 0;
  for (const month of months) total += elapsedDaysBetween(month, month, today);
  return total;
}

/**
 * Calendar arithmetic on YYYY-MM month strings.
 *
 * Six near-identical inline implementations of "add N months" lived across
 * `BudgetManagementView`, `BudgetToolbar`, `useBulkAction`, `BudgetDraftPanel`,
 * `BudgetExportDialog`, and inline date math in `BudgetWorkspace`. Each had
 * its own default-on-parse-failure value and was a year-rotation away from
 * silently producing wrong results. This module is the single source of truth.
 *
 * All functions accept `YYYY-MM` strings (or `null`/`undefined` for the
 * formatters that report a placeholder). On malformed input, parsing falls
 * back to the first month of the current year — callers should validate up
 * front with `isValidMonth` if strictness matters.
 */

/** Strict check that `s` matches `YYYY-MM`. */
export function isValidMonth(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(s);
}

/** Parse a YYYY-MM string into a [year, month] tuple (1-indexed month). */
export function parseMonth(month: string): [number, number] {
  const [y, m] = month.split("-");
  const year = parseInt(y ?? "", 10);
  const mo = parseInt(m ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(mo)) {
    const now = new Date();
    return [now.getFullYear(), 1];
  }
  return [year, mo];
}

/** Format a Date back to YYYY-MM. */
function fromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The current calendar month as `YYYY-MM`, in the viewer's local time. */
export function currentMonth(): string {
  return fromDate(new Date());
}

/**
 * Fraction of `month` that has elapsed as of `now`, in [0, 1].
 *
 * `0` if `now` is at/before the month's first instant, `1` if the month has
 * fully passed, otherwise the elapsed time within the month divided by the
 * month's length. Timestamp-based, so leap years and month lengths are handled
 * by `Date`. Used to show "where are we in the month?" on the current-month
 * column (RD-067). An invalid `now` (e.g. `new Date("")`) falls back to `0`.
 */
export function monthElapsedFraction(month: string, now: Date): number {
  const t = now.getTime();
  if (!Number.isFinite(t)) return 0; // invalid Date → treat as "not started"
  const [year, mo] = parseMonth(month);
  const start = new Date(year, mo - 1, 1).getTime();
  const end = new Date(year, mo, 1).getTime(); // first instant of the next month
  if (t <= start) return 0;
  if (t >= end) return 1;
  return (t - start) / (end - start);
}

/** Add `delta` months (may be negative) to `month`. */
export function addMonths(month: string, delta: number): string {
  const [year, mo] = parseMonth(month);
  return fromDate(new Date(year, mo - 1 + delta, 1));
}

/** Subtract `delta` months from `month`. Equivalent to `addMonths(month, -delta)`. */
export function subtractMonths(month: string, delta: number): string {
  return addMonths(month, -delta);
}

/** Returns the YYYY-MM string for the month immediately before `month`. */
export function prevMonth(month: string): string {
  return addMonths(month, -1);
}

/** Returns the YYYY-MM string for the month immediately after `month`. */
export function nextMonth(month: string): string {
  return addMonths(month, 1);
}

/**
 * The first day of `month`, as `YYYY-MM-DD`.
 *
 * Trivial, but paired with `lastDayOfMonth` it keeps both ends of a date range
 * being built the same way rather than one being a template literal at the call
 * site and the other a function.
 */
export function firstDayOfMonth(month: string): string {
  const [year, mo] = parseMonth(month);
  return `${year}-${String(mo).padStart(2, "0")}-01`;
}

/**
 * The last day of `month`, as `YYYY-MM-DD`.
 *
 * Derived rather than looked up, so February and leap years need no table:
 * day zero of the *next* month is the last day of this one.
 *
 *   lastDayOfMonth("2026-01") // → "2026-01-31"
 *   lastDayOfMonth("2026-02") // → "2026-02-28"
 *   lastDayOfMonth("2028-02") // → "2028-02-29"
 *   lastDayOfMonth("2026-04") // → "2026-04-30"
 */
export function lastDayOfMonth(month: string): string {
  const [year, mo] = parseMonth(month);
  const day = new Date(year, mo, 0).getDate();
  return `${year}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Every month from `start` to `end` inclusive, oldest first.
 *
 * Returns an empty list when the range runs backwards - a caller that has them
 * the wrong way round is asking for nothing, and silently swapping them would
 * hide the mistake.
 */
/** `YYYY-MM`, the only shape the month arithmetic here can reason about. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthId(month: string): boolean {
  return MONTH_PATTERN.test(month);
}

export function monthsInRange(start: string, end: string): string[] {
  /*
   * Both ends have to be real months, or the walk below never terminates.
   *
   * `compareMonths` compares the strings, so "x" sorts below "z" and the loop
   * starts; `nextMonth("x")` goes through `parseMonth`, which falls back to the
   * current year and January rather than failing, and every month it then
   * produces still sorts below "z". The condition is never false and the tab
   * hangs. Months reach this from drilldown fields that are built, not typed,
   * so this is a guard rather than a validation path - but a wrong month should
   * cost an empty list, not the page.
   */
  if (!isMonthId(start) || !isMonthId(end)) return [];
  if (compareMonths(start, end) > 0) return [];
  const months: string[] = [];
  for (let month = start; compareMonths(month, end) <= 0; month = nextMonth(month)) {
    months.push(month);
  }
  return months;
}

/**
 * Lexicographic compare for YYYY-MM strings — works because the format is
 * fixed-width zero-padded. Returns negative / zero / positive.
 */
export function compareMonths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Format a YYYY-MM string for display, e.g. "Apr 2026" (`"long"`) or
 * "Apr '26" (`"short"`, default).
 */
export function formatMonthLabel(
  month: string,
  fmt: "short" | "long" = "short"
): string {
  const [year, mo] = parseMonth(month);
  return new Date(year, mo - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: fmt === "long" ? "numeric" : "2-digit",
  });
}

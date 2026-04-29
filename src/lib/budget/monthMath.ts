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
function parseMonth(month: string): [number, number] {
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

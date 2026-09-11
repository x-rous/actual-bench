/**
 * A month absent from `/months` has no budget month behind it, in either
 * direction.
 *
 * This used to apply only to months *before* the current one, on the assumption
 * that a future month could still be written to and would be created on demand.
 * It cannot: `PATCH /months/{month}/categories/{id}` answers
 * `404 "No budget exists for month"` for a month beyond the budget's range just
 * as it does for one before it (verified against a live server). Treating future
 * gaps as editable let the grid stage edits that could never save.
 *
 * Such months stay visible - a 12-month window should not develop holes - but
 * they carry no values and accept no edits.
 */
export function isReadOnlyMissingBudgetMonth(
  month: string,
  availableMonths: readonly string[]
): boolean {
  return !availableMonths.includes(month);
}

export function buildReadOnlyMissingBudgetMonthSet(
  months: readonly string[],
  availableMonths: readonly string[]
): Set<string> {
  return new Set(
    months.filter((month) => isReadOnlyMissingBudgetMonth(month, availableMonths))
  );
}

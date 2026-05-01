function currentMonthString(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Months before the current month that are absent from `/months` are historical
 * gaps, not plan months. They should remain visible in a 12-month window, but
 * budget values cannot be edited because the API has no budget month to write.
 */
export function isReadOnlyMissingBudgetMonth(
  month: string,
  availableMonths: readonly string[],
  now: Date = new Date()
): boolean {
  return month < currentMonthString(now) && !availableMonths.includes(month);
}

export function buildReadOnlyMissingBudgetMonthSet(
  months: readonly string[],
  availableMonths: readonly string[],
  now: Date = new Date()
): Set<string> {
  return new Set(
    months.filter((month) =>
      isReadOnlyMissingBudgetMonth(month, availableMonths, now)
    )
  );
}

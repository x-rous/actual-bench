/**
 * Plain-number sum, or null when a value or running total leaves the safe-integer range. Adding
 * safe integers whose result is safe is exact in IEEE doubles, so this equals the BigInt sum.
 */
export function safeIntegerSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

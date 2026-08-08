import type { ParsedAmount, ParsedGroup } from "./parseBudgetMonth";

/**
 * Shared amount-role helpers. Keep financial meaning here, never `Math.abs()` to
 * infer it. Display magnitudes are presentation-only and must never feed formulas.
 */

/**
 * Read an amount that the mode's contract guarantees is present. `null` collapses
 * to 0 (a genuinely absent required field is a parser concern, not a formula one).
 */
export function required(a: ParsedAmount): number {
  return a ?? 0;
}

/** Positive display magnitude of a signed value. Presentation only. */
export function displayMagnitude(a: ParsedAmount): number {
  return Math.abs(a ?? 0);
}

/** Visible (non-hidden) groups of one side. */
export function visibleGroups(
  groups: readonly ParsedGroup[],
  side: "income" | "expense"
): ParsedGroup[] {
  const wantIncome = side === "income";
  return groups.filter((g) => g.isIncome === wantIncome && !g.hidden);
}

/**
 * Lender statement interest allocation vocabulary (RD-084 P1.6 T283). Kept
 * free of imports so the config parser and the allocation can both use it.
 * The calculation is in ./statementAllocation.ts.
 */

export const INTEREST_ALLOCATIONS = ["as-calculated", "accrued-to-due-date"] as const;
export type InterestAllocation = (typeof INTEREST_ALLOCATIONS)[number];
export const DEFAULT_INTEREST_ALLOCATION: InterestAllocation = "as-calculated";

export type LenderStatementSettings = { interestAllocation: InterestAllocation };

import { isLargeChange, isIncomeBlocked, LARGE_CHANGE_THRESHOLD } from "./budgetValidation";
import type { LoadedCategory } from "../types";

function cat(overrides: Partial<LoadedCategory> = {}): LoadedCategory {
  return {
    id: "c1",
    name: "Cat",
    groupId: "g1",
    groupName: "Group",
    isIncome: false,
    hidden: false,
    budgeted: 0,
    actuals: 0,
    balance: 0,
    carryover: false,
    ...overrides,
  };
}

describe("isLargeChange", () => {
  it("treats a zero delta as not large", () => {
    expect(isLargeChange(10000, 10000)).toBe(false);
  });

  it("treats a delta exactly equal to the threshold as not large", () => {
    expect(isLargeChange(0, LARGE_CHANGE_THRESHOLD)).toBe(false);
  });

  it("treats a delta one minor unit above the threshold as large", () => {
    expect(isLargeChange(0, LARGE_CHANGE_THRESHOLD + 1)).toBe(true);
  });

  it("treats negative deltas symmetrically", () => {
    expect(isLargeChange(LARGE_CHANGE_THRESHOLD + 1, 0)).toBe(true);
    expect(isLargeChange(LARGE_CHANGE_THRESHOLD, 0)).toBe(false);
  });
});

describe("isIncomeBlocked", () => {
  it("blocks income categories in envelope mode", () => {
    expect(isIncomeBlocked(cat({ isIncome: true }), "envelope")).toBe(true);
  });

  it("does not block income categories in tracking mode", () => {
    expect(isIncomeBlocked(cat({ isIncome: true }), "tracking")).toBe(false);
  });

  it("does not block income categories in unidentified mode", () => {
    expect(isIncomeBlocked(cat({ isIncome: true }), "unidentified")).toBe(false);
  });

  it("never blocks expense categories regardless of mode", () => {
    for (const mode of ["envelope", "tracking", "unidentified"] as const) {
      expect(isIncomeBlocked(cat({ isIncome: false }), mode)).toBe(false);
    }
  });
});

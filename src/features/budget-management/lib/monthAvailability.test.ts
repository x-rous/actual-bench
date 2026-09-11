import {
  buildReadOnlyMissingBudgetMonthSet,
  isReadOnlyMissingBudgetMonth,
} from "./monthAvailability";

const availableMonths = ["2026-03", "2026-04"];

describe("isReadOnlyMissingBudgetMonth", () => {
  it("marks a missing past month as read-only", () => {
    expect(isReadOnlyMissingBudgetMonth("2026-01", availableMonths)).toBe(true);
  });

  it("marks a missing future month as read-only too", () => {
    // The API answers 404 "No budget exists for month" to a write beyond the
    // budget's range exactly as it does to one before it, so a future gap is
    // no more editable than a historical one. Treating it as editable let the
    // grid stage edits that could never save.
    expect(isReadOnlyMissingBudgetMonth("2026-06", availableMonths)).toBe(true);
  });

  it("leaves available months editable, past or future", () => {
    expect(isReadOnlyMissingBudgetMonth("2026-03", availableMonths)).toBe(false);
    expect(isReadOnlyMissingBudgetMonth("2026-04", availableMonths)).toBe(false);
  });
});

describe("buildReadOnlyMissingBudgetMonthSet", () => {
  it("returns every unavailable month in the visible window", () => {
    expect([
      ...buildReadOnlyMissingBudgetMonthSet(
        ["2026-01", "2026-02", "2026-03", "2026-05", "2026-06"],
        ["2026-03"]
      ),
    ]).toEqual(["2026-01", "2026-02", "2026-05", "2026-06"]);
  });

  it("is empty when every visible month exists", () => {
    expect(
      buildReadOnlyMissingBudgetMonthSet(["2026-03", "2026-04"], availableMonths).size
    ).toBe(0);
  });
});

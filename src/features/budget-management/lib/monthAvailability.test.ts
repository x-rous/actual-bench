import {
  buildReadOnlyMissingBudgetMonthSet,
  isReadOnlyMissingBudgetMonth,
} from "./monthAvailability";

const now = new Date("2026-05-15T12:00:00Z");

describe("isReadOnlyMissingBudgetMonth", () => {
  it("marks missing past months as read-only", () => {
    expect(
      isReadOnlyMissingBudgetMonth("2026-01", ["2026-03", "2026-04"], now)
    ).toBe(true);
  });

  it("does not mark available past months as read-only", () => {
    expect(
      isReadOnlyMissingBudgetMonth("2026-03", ["2026-03", "2026-04"], now)
    ).toBe(false);
  });

  it("does not mark missing current or future months as read-only", () => {
    const availableMonths = ["2026-03", "2026-04"];
    expect(isReadOnlyMissingBudgetMonth("2026-05", availableMonths, now)).toBe(
      false
    );
    expect(isReadOnlyMissingBudgetMonth("2026-06", availableMonths, now)).toBe(
      false
    );
  });
});

describe("buildReadOnlyMissingBudgetMonthSet", () => {
  it("returns only unavailable past months in the visible window", () => {
    expect(
      [...buildReadOnlyMissingBudgetMonthSet(
        ["2026-01", "2026-02", "2026-03", "2026-05", "2026-06"],
        ["2026-03"],
        now
      )]
    ).toEqual(["2026-01", "2026-02"]);
  });
});

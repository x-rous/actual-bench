import {
  addMonths,
  subtractMonths,
  prevMonth,
  nextMonth,
  compareMonths,
  formatMonthLabel,
  isValidMonth,
  monthElapsedFraction,
} from "./monthMath";

describe("monthElapsedFraction", () => {
  it("is 0 before the month and 1 after it", () => {
    expect(monthElapsedFraction("2026-06", new Date(2026, 4, 20))).toBe(0); // May, before June
    expect(monthElapsedFraction("2026-06", new Date(2026, 6, 3))).toBe(1); // July, after June
  });

  it("is 0 at the first instant of the month", () => {
    expect(monthElapsedFraction("2026-06", new Date(2026, 5, 1, 0, 0, 0))).toBe(0);
  });

  it("is ~0.5 at mid-month", () => {
    // June has 30 days; midday of the 16th is ~half elapsed.
    const f = monthElapsedFraction("2026-06", new Date(2026, 5, 16, 0, 0, 0));
    expect(f).toBeGreaterThan(0.48);
    expect(f).toBeLessThan(0.52);
  });

  it("handles a leap-year February (29 days)", () => {
    // 2028 is a leap year; end-of-day Feb 15 ≈ just over half of 29 days.
    const f = monthElapsedFraction("2028-02", new Date(2028, 1, 15, 12, 0, 0));
    expect(f).toBeGreaterThan(0.48);
    expect(f).toBeLessThan(0.55);
    // The 29th exists and is within the month (fraction < 1).
    expect(monthElapsedFraction("2028-02", new Date(2028, 1, 29, 0, 0, 0))).toBeLessThan(1);
  });
});

describe("isValidMonth", () => {
  it.each([
    ["2026-01", true],
    ["2026-12", true],
    ["1999-06", true],
    ["2026-00", false],
    ["2026-13", false],
    ["2026-1", false],
    ["26-01", false],
    ["2026/01", false],
    ["", false],
  ])("isValidMonth(%j) → %s", (input, expected) => {
    expect(isValidMonth(input)).toBe(expected);
  });

  it("rejects null and undefined", () => {
    expect(isValidMonth(null)).toBe(false);
    expect(isValidMonth(undefined)).toBe(false);
  });
});

describe("addMonths", () => {
  it("adds months within a year", () => {
    expect(addMonths("2026-03", 2)).toBe("2026-05");
  });

  it("rolls over year boundary forward", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
  });

  it("rolls over year boundary backward with negative delta", () => {
    expect(addMonths("2026-02", -3)).toBe("2025-11");
  });

  it("returns the same month when delta is zero", () => {
    expect(addMonths("2026-04", 0)).toBe("2026-04");
  });

  it("handles +12 as a one-year jump", () => {
    expect(addMonths("2026-04", 12)).toBe("2027-04");
  });
});

describe("subtractMonths / prevMonth / nextMonth", () => {
  it("subtractMonths is the inverse of addMonths", () => {
    expect(subtractMonths("2026-04", 3)).toBe(addMonths("2026-04", -3));
  });

  it("prevMonth steps back one", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
  });

  it("nextMonth steps forward one", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
});

describe("compareMonths", () => {
  it("returns negative when a < b", () => {
    expect(compareMonths("2026-01", "2026-02")).toBeLessThan(0);
  });

  it("returns positive when a > b", () => {
    expect(compareMonths("2026-12", "2025-01")).toBeGreaterThan(0);
  });

  it("returns zero on equal months", () => {
    expect(compareMonths("2026-04", "2026-04")).toBe(0);
  });

  it("sorts an array correctly", () => {
    const months = ["2026-12", "2024-03", "2025-06"];
    expect([...months].sort(compareMonths)).toEqual(["2024-03", "2025-06", "2026-12"]);
  });
});

describe("formatMonthLabel", () => {
  it("defaults to short 2-digit year", () => {
    // toLocaleString output for 2-digit year is "Apr 26" in en-US.
    expect(formatMonthLabel("2026-04")).toBe("Apr 26");
  });

  it("supports long year format (Apr 2026)", () => {
    expect(formatMonthLabel("2026-04", "long")).toBe("Apr 2026");
  });
});

import {
  addMonths,
  compareMonths,
  firstDayOfMonth,
  formatMonthLabel,
  isValidMonth,
  lastDayOfMonth,
  monthElapsedFraction,
  monthsInRange,
  nextMonth,
  prevMonth,
  subtractMonths,
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

  it("falls back to 0 for an invalid Date", () => {
    expect(monthElapsedFraction("2026-06", new Date(""))).toBe(0);
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

/*
 * A month range becomes a date range for the transactions query, so the ends
 * have to be exact: a February that stops on the 28th in a leap year silently
 * drops a day of transactions, and the figure stops matching the one clicked.
 */
describe("month boundaries as dates", () => {
  it("gives the first day", () => {
    expect(firstDayOfMonth("2026-01")).toBe("2026-01-01");
    expect(firstDayOfMonth("2026-11")).toBe("2026-11-01");
  });

  it("gives the last day for every month length", () => {
    expect(lastDayOfMonth("2026-01")).toBe("2026-01-31");
    expect(lastDayOfMonth("2026-04")).toBe("2026-04-30");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
  });

  it("handles February in common and leap years", () => {
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28");
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
    // Century rule: 1900 was not a leap year, 2000 was.
    expect(lastDayOfMonth("1900-02")).toBe("1900-02-28");
    expect(lastDayOfMonth("2000-02")).toBe("2000-02-29");
  });
});

describe("monthsInRange", () => {
  it("includes both ends", () => {
    expect(monthsInRange("2026-01", "2026-04")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("returns the single month when the ends are the same", () => {
    expect(monthsInRange("2026-07", "2026-07")).toEqual(["2026-07"]);
  });

  it("crosses a year boundary", () => {
    expect(monthsInRange("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("returns nothing when the range runs backwards", () => {
    // Asking for nothing, rather than silently swapping and hiding the mistake.
    expect(monthsInRange("2026-04", "2026-01")).toEqual([]);
  });
});

/*
 * `monthsInRange` walks from one month to the next until it passes the end, and
 * the comparison is on the strings. A malformed endpoint therefore starts a
 * walk that can never finish: "x" sorts below "z", and every `YYYY-MM` the walk
 * produces still sorts below "z". The cost of getting this wrong is a hung tab,
 * not a wrong number, so it is guarded rather than trusted.
 */
describe("monthsInRange - malformed input", () => {
  it("returns an empty list rather than looping forever", () => {
    expect(monthsInRange("x", "z")).toEqual([]);
    expect(monthsInRange("2026-01", "z")).toEqual([]);
    expect(monthsInRange("", "2026-03")).toEqual([]);
  });

  it("rejects month numbers that are not months", () => {
    expect(monthsInRange("2026-00", "2026-03")).toEqual([]);
    expect(monthsInRange("2026-13", "2026-14")).toEqual([]);
    expect(monthsInRange("2026-1", "2026-03")).toEqual([]);
  });

  it("still walks a well-formed range", () => {
    expect(monthsInRange("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

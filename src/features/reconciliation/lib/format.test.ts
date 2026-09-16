import { amountRatio, datesSpanYears, formatShortDate } from "./format";

describe("amountRatio", () => {
  it("reports the factor when a recorded amount is a bad conversion", () => {
    // Real case: SAR65 posted as -66.15, recorded as -24.38 by an automation
    // that applied the wrong currency factor. Seeing 0.375 recur across rows
    // points at the converter rather than at individual transactions.
    expect(amountRatio(-6615, -2438)).toBe("0.369");
  });

  it("reports a factor above one", () => {
    expect(amountRatio(-2036, -7504)).toBe("3.69");
  });

  it("says nothing when the amounts are close enough to be rounding", () => {
    expect(amountRatio(-6615, -6600)).toBeNull();
  });

  it("says nothing when the sign flips, where a quotient is meaningless", () => {
    expect(amountRatio(-6615, 2438)).toBeNull();
  });

  it("says nothing about a zero statement amount", () => {
    expect(amountRatio(0, -2438)).toBeNull();
  });
});

/*
 * The workbench date columns are compact because a statement period is normally
 * one month. The moment two years are in play that compactness lies: "03 Jan"
 * beside "30 Dec" reads as three days apart when it is a year, and the two
 * columns sit side by side precisely so they can be compared.
 */
describe("formatShortDate", () => {
  it("omits the year by default", () => {
    expect(formatShortDate("2026-07-03")).toBe("03 Jul");
  });

  it("includes the year when asked", () => {
    expect(formatShortDate("2025-12-30", true)).toBe("30 Dec 2025");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatShortDate("not-a-date")).toBe("not-a-date");
    expect(formatShortDate("not-a-date", true)).toBe("not-a-date");
  });

  it("reads the date as UTC, so a day never shifts under a timezone", () => {
    expect(formatShortDate("2026-01-01")).toBe("01 Jan");
    expect(formatShortDate("2026-12-31")).toBe("31 Dec");
  });
});

describe("datesSpanYears", () => {
  it("is false for dates that share a year", () => {
    expect(datesSpanYears(["2026-01-05", "2026-07-30", "2026-12-31"])).toBe(false);
  });

  it("is true as soon as two years appear", () => {
    expect(datesSpanYears(["2025-12-30", "2026-01-03"])).toBe(true);
  });

  it("ignores entries that carry no date", () => {
    // A row with no statement side contributes nothing. Counting the empty
    // string as a year would switch the years on for a table not needing them.
    expect(datesSpanYears(["2026-01-05", undefined, null, ""])).toBe(false);
    expect(datesSpanYears([null, undefined])).toBe(false);
  });

  it("is false for a single date, and for none at all", () => {
    expect(datesSpanYears(["2026-01-05"])).toBe(false);
    expect(datesSpanYears([])).toBe(false);
  });
});

import {
  addDays,
  addMonths,
  compareDates,
  dateInMonth,
  daysBetween,
  daysInMonth,
  daysInYear,
  endOfMonth,
  fromDayNumber,
  isIsoDate,
  isLastDayOfFebruary,
  isLastDayOfMonth,
  isLeapYear,
  parseIsoDate,
  toDayNumber,
} from "./dates";

describe("leap years and month lengths", () => {
  it.each([
    [2023, false],
    [2024, true],
    [1900, false],
    [2000, true],
    [2100, false],
  ])("%i leap: %s", (year, leap) => {
    expect(isLeapYear(year)).toBe(leap);
    expect(daysInYear(year)).toBe(leap ? 366 : 365);
    expect(daysInMonth(year, 2)).toBe(leap ? 29 : 28);
  });

  it("knows every month's length", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2025, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
  });
});

describe("parsing", () => {
  it("accepts real dates, including 29 Feb in a leap year", () => {
    expect(parseIsoDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it.each(["2023-02-29", "2024-04-31", "2024-13-01", "2024-00-10", "2024-1-5", "20240105", "2024-01-05T00:00"])(
    "rejects %j",
    (bad) => {
      expect(() => parseIsoDate(bad)).toThrow(RangeError);
      expect(isIsoDate(bad)).toBe(false);
    }
  );
});

describe("day numbers", () => {
  it("anchors at the Unix epoch", () => {
    expect(toDayNumber("1970-01-01")).toBe(0);
    expect(fromDayNumber(0)).toBe("1970-01-01");
    expect(toDayNumber("1969-12-31")).toBe(-1);
  });

  it("round-trips every day across 1899–2101", () => {
    for (let n = toDayNumber("1899-01-01"); n <= toDayNumber("2101-12-31"); n++) {
      expect(toDayNumber(fromDayNumber(n))).toBe(n);
    }
  });

  it("agrees with UTC milliseconds for spot dates", () => {
    for (const date of ["2000-02-29", "2024-02-29", "2100-03-01", "1904-02-29"]) {
      const [y, m, d] = date.split("-").map(Number);
      expect(toDayNumber(date)).toBe(Date.UTC(y, m - 1, d) / 86_400_000);
    }
  });
});

describe("day counts (start inclusive, end exclusive)", () => {
  it.each([
    ["2024-02-28", "2024-03-01", 2], // through 29 Feb
    ["2023-02-28", "2023-03-01", 1],
    ["2023-12-31", "2024-01-01", 1], // one day across a year end
    ["2024-01-01", "2025-01-01", 366],
    ["2023-01-01", "2024-01-01", 365],
    ["2024-01-31", "2024-02-29", 29],
    ["2024-03-01", "2024-02-28", -2],
    ["2024-06-15", "2024-06-15", 0],
  ])("%s → %s is %i days", (a, b, n) => {
    expect(daysBetween(a, b)).toBe(n);
    expect(addDays(a, n)).toBe(b);
  });

  it("orders dates", () => {
    expect(compareDates("2024-02-29", "2024-03-01")).toBe(-1);
    expect(compareDates("2024-03-01", "2024-03-01")).toBe(0);
  });
});

describe("month arithmetic with clamp-to-last-calendar-day", () => {
  it.each([
    ["2024-01-31", 1, "2024-02-29"],
    ["2023-01-31", 1, "2023-02-28"],
    ["2024-01-31", 2, "2024-03-31"], // the anchor day survives February
    ["2024-01-30", 1, "2024-02-29"],
    ["2024-01-29", 1, "2024-02-29"],
    ["2023-01-29", 1, "2023-02-28"],
    ["2024-03-31", 1, "2024-04-30"],
    ["2024-12-31", 2, "2025-02-28"],
    ["2024-02-29", 12, "2025-02-28"],
    ["2024-02-29", 48, "2028-02-29"],
    ["2024-03-31", -1, "2024-02-29"],
    ["2025-01-15", -13, "2023-12-15"],
  ])("%s + %i months = %s", (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });

  it("places an explicit anchor day in short months", () => {
    expect(addMonths("2024-02-29", 1, 31)).toBe("2024-03-31");
    expect(dateInMonth(2024, 4, 31)).toBe("2024-04-30");
    expect(dateInMonth(2023, 2, 30)).toBe("2023-02-28");
    expect(() => dateInMonth(2024, 2, 32)).toThrow(RangeError);
    expect(() => dateInMonth(2024, 2, 15, "roll-forward" as never)).toThrow(RangeError);
  });

  it("finds month ends and the last day of February", () => {
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
    expect(isLastDayOfMonth("2024-04-30")).toBe(true);
    expect(isLastDayOfFebruary("2024-02-28")).toBe(false);
    expect(isLastDayOfFebruary("2024-02-29")).toBe(true);
    expect(isLastDayOfFebruary("2023-02-28")).toBe(true);
  });
});

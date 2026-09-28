import { dec, toDecString } from "../../money/kernel";
import { actual360 } from "./act360";
import { actual365Fixed } from "./act365f";
import { actualActualCalendar } from "./actact";
import { monthly30360ActualDayAllocation } from "./monthly-30-360-alloc";
import { periodInterest, yearFraction, yearFractionExact, type DayCountConvention } from "./types";

const frac = (c: DayCountConvention, a: string, b: string) => {
  const { numerator, denominator } = yearFractionExact(c, a, b);
  return `${numerator}/${denominator}`;
};

describe("Actual/365 Fixed", () => {
  it("keeps 365 on 29 February and across a leap year", () => {
    expect(frac(actual365Fixed, "2024-02-29", "2024-03-01")).toBe("1/365");
    expect(frac(actual365Fixed, "2024-01-01", "2025-01-01")).toBe("366/365");
    expect(actual365Fixed.dailyDenominator("2024-02-29")).toBe(365);
  });

  it("counts one-day, year-crossing and month-end periods", () => {
    expect(frac(actual365Fixed, "2023-12-31", "2024-01-01")).toBe("1/365");
    expect(frac(actual365Fixed, "2024-01-31", "2024-02-29")).toBe("29/365");
    expect(actual365Fixed.segments("2024-05-05", "2024-05-05")).toEqual([]);
  });
});

describe("Actual/Actual (calendar)", () => {
  it("splits at the year end with each year's own denominator", () => {
    expect(actualActualCalendar.segments("2023-12-01", "2024-02-01")).toEqual([
      { from: "2023-12-01", to: "2024-01-01", days: 31, denominator: 365 },
      { from: "2024-01-01", to: "2024-02-01", days: 31, denominator: 366 },
    ]);
    expect(actualActualCalendar.segments("2024-12-01", "2025-02-01")).toEqual([
      { from: "2024-12-01", to: "2025-01-01", days: 31, denominator: 366 },
      { from: "2025-01-01", to: "2025-02-01", days: 31, denominator: 365 },
    ]);
  });

  it("makes a whole leap year exactly one year, and 29 February 1/366", () => {
    expect(frac(actualActualCalendar, "2024-01-01", "2025-01-01")).toBe("1/1");
    expect(frac(actualActualCalendar, "2023-07-01", "2025-07-01")).toBe("2/1");
    expect(frac(actualActualCalendar, "2024-02-29", "2024-03-01")).toBe("1/366");
    expect(actualActualCalendar.dailyDenominator("2023-02-28")).toBe(365);
  });
});

describe("Actual/360", () => {
  it("uses actual days, not 30-day months", () => {
    expect(frac(actual360, "2024-03-01", "2024-04-01")).toBe("31/360");
    expect(frac(actual360, "2023-02-01", "2023-03-01")).toBe("7/90") // 28/360, reduced;
    expect(frac(actual360, "2024-01-01", "2025-01-01")).toBe("61/60");
    expect(actual360.dailyDenominator("2024-07-31")).toBe(360);
  });
});

describe("Monthly 30/360 with actual-day allocation", () => {
  it("gives every whole month exactly 1/12, whatever its length", () => {
    for (const [a, b] of [
      ["2024-02-01", "2024-03-01"],
      ["2023-02-01", "2023-03-01"],
      ["2024-03-01", "2024-04-01"],
      ["2024-04-01", "2024-05-01"],
    ]) {
      expect(frac(monthly30360ActualDayAllocation, a, b)).toBe("1/12");
    }
    expect(frac(monthly30360ActualDayAllocation, "2024-01-01", "2025-01-01")).toBe("1/1");
  });

  it("splits part months at month ends and differs from Actual/360", () => {
    expect(monthly30360ActualDayAllocation.segments("2024-01-20", "2024-02-10")).toEqual([
      { from: "2024-01-20", to: "2024-02-01", days: 12, denominator: 372 },
      { from: "2024-02-01", to: "2024-02-10", days: 9, denominator: 348 },
    ]);
    expect(monthly30360ActualDayAllocation.dailyDenominator("2024-02-10")).toBe(348);
    const alloc = periodInterest(dec("100000"), dec("0.06"), monthly30360ActualDayAllocation, "2024-03-01", "2024-04-01", 2, "half-up");
    const a360 = periodInterest(dec("100000"), dec("0.06"), actual360, "2024-03-01", "2024-04-01", 2, "half-up");
    expect([toDecString(alloc), toDecString(a360)]).toEqual(["500.00", "516.67"]);
  });

  it("crosses a year end", () => {
    expect(monthly30360ActualDayAllocation.segments("2024-12-31", "2025-01-02")).toEqual([
      { from: "2024-12-31", to: "2025-01-01", days: 1, denominator: 372 },
      { from: "2025-01-01", to: "2025-01-02", days: 1, denominator: 372 },
    ]);
  });
});

describe("shared behavior", () => {
  it.each([actual365Fixed, actualActualCalendar, actual360, monthly30360ActualDayAllocation])("%# refuses a reversed period", (c) => {
    expect(() => c.segments("2024-03-01", "2024-02-01")).toThrow(RangeError);
  });

  it("rounds the year fraction once at the requested scale", () => {
    expect(toDecString(yearFraction(actual365Fixed, "2024-01-01", "2024-01-02", 10))).toBe("0.0027397260");
    expect(toDecString(yearFraction(actualActualCalendar, "2003-11-01", "2004-05-01", 8))).toBe("0.49772438");
  });

  it("keeps long allocation periods exact without runaway denominators", () => {
    const { numerator, denominator } = yearFractionExact(monthly30360ActualDayAllocation, "1990-01-01", "2030-01-01");
    expect(`${numerator}/${denominator}`).toBe("40/1");
  });
});

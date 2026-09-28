import { add, dec, decInt, div, mul, round, sub, toDecString, toMinor, WORKING_SCALE, type Dec } from "../money/kernel";
import { actual365Fixed } from "./daycount/act365f";
import { periodInterest } from "./daycount/types";

/*
 * Precision behaviors (FR-046, FR-155, V3 §40.3) on a balance chosen to expose
 * cent errors: $123,456.78 at 5.37%, Actual/365 Fixed, so one day's interest
 * is 18.1633673589…
 *
 * Expected figures are from Python `fractions` (exact) with half-up ties.
 * None comes from this code.
 */

const P = dec("123456.78");
const R = dec("0.0537");
const DAILY = div(mul(P, R), decInt(365), WORKING_SCALE, "half-even");
const sum = (xs: Dec[]) => xs.reduce(add, dec("0"));
const days = (n: number, value: Dec) => Array.from({ length: n }, () => value);

describe("repeated accrual", () => {
  it("rounds a month of full-precision daily interest once, at posting", () => {
    expect(toDecString(round(sum(days(31, DAILY)), 2, "half-up"))).toBe("563.06");
    // The same figure straight from the day count, rounded once.
    expect(toDecString(periodInterest(P, R, actual365Fixed, "2024-01-01", "2024-02-01", 2, "half-up"))).toBe("563.06");
  });

  it("shows why rounding each day early is wrong: ten cents lost in a month", () => {
    const early = sum(days(31, round(DAILY, 2, "half-up")));
    expect(toDecString(early)).toBe("562.96");
  });

  it("supports a 5-place daily scale (a lender profile), then rounds at posting", () => {
    const fivePlace = sum(days(31, round(DAILY, 5, "half-up")));
    expect(toDecString(round(fivePlace, 2, "half-up"))).toBe("563.06");
  });
});

describe("carried sub-minor remainder", () => {
  // Three monthly postings (31, 29 and 31 days) on an unchanged balance.
  const months = [31, 29, 31];

  it("carries the remainder so the postings add up to the rounded total", () => {
    let carry = dec("0");
    const posted: string[] = [];
    for (const n of months) {
      const accrued = add(mul(DAILY, decInt(n)), carry);
      const posting = round(accrued, 2, "half-up");
      carry = sub(accrued, posting);
      posted.push(toDecString(posting));
    }
    expect(posted).toEqual(["563.06", "526.74", "563.07"]);
    const total = round(mul(DAILY, decInt(91)), 2, "half-up");
    expect(toDecString(total)).toBe("1652.87");
    expect(toMinor(sum(posted.map(dec)), 2, "down")).toBe(toMinor(total, 2, "down"));
    // What is left is under half a cent, kept at full precision for the next period.
    expect(toDecString(round(carry, 6, "half-even"))).toBe("-0.003570");
  });

  it("without the carry, a cent goes missing over the quarter", () => {
    const posted = months.map((n) => round(mul(DAILY, decInt(n)), 2, "half-up"));
    expect(posted.map(toDecString)).toEqual(["563.06", "526.74", "563.06"]);
    expect(toDecString(sum(posted))).toBe("1652.86");
  });
});

describe("exact final conversion", () => {
  it("converts to minor units once, by the posting mode, keeping the sign", () => {
    const quarter = mul(DAILY, decInt(91));
    expect(toMinor(quarter, 2, "half-up")).toBe(165287);
    expect(toMinor(quarter, 2, "down")).toBe(165286);
    expect(toMinor(sub(dec("0"), quarter), 2, "half-up")).toBe(-165287);
  });

  it("distinguishes half-up from half-even exactly at a half cent", () => {
    // 0.005 of interest: 1 day on $36.50 at 5%, Actual/365 Fixed.
    const half = periodInterest(dec("36.50"), dec("0.05"), actual365Fixed, "2024-06-01", "2024-06-02", 3, "down");
    expect(toDecString(half)).toBe("0.005");
    expect(toMinor(half, 2, "half-up")).toBe(1);
    expect(toMinor(half, 2, "half-even")).toBe(0);
  });
});

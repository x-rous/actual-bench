import { averageYearlyYield, netYieldOnValue, yearlyNetYield, yearsBetween } from "./yields";

it("spreads the all-time yield over the years held, and is unknown for a short history", () => {
  expect(yearsBetween("2020-11-26", "2026-10-26")).toBeCloseTo(5.92, 1);
  expect(averageYearlyYield(38.21, 5.92)).toBe(6.45);
  expect(averageYearlyYield(38.21, 0.3)).toBeNull();
  expect(averageYearlyYield(null, 5)).toBeNull();
});
it("compares an operating result with today's value, and is unknown without a positive value", () => {
  expect(netYieldOnValue(15621472, 305000000)).toBe(5.12);
  expect(netYieldOnValue(15621472, 0)).toBeNull();
  expect(netYieldOnValue(null, 100)).toBeNull();
  expect(netYieldOnValue(-500, 10000)).toBe(-5);
});
it("scales a long period to a year, leaves a short one as it is, and goes negative when costs exceed income", () => {
  expect(yearlyNetYield(15621472, 305000000, 5.92)).toEqual({ percent: 0.86, annualized: true });
  expect(yearlyNetYield(2000000, 100000000, 1)).toEqual({ percent: 2, annualized: true });
  expect(yearlyNetYield(2000000, 100000000, 0.1)).toEqual({ percent: 2, annualized: false });
  expect(yearlyNetYield(-300000, 10000000, 1)).toEqual({ percent: -3, annualized: true });
  expect(yearlyNetYield(100, 0, 1)).toBeNull();
});

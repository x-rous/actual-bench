import { daysBetween, type IsoDate } from "../../calendar/dates";
import { assertPeriod, type DayCountConvention } from "./types";

/**
 * Actual/365 Fixed: actual days over 365, including in leap years, so
 * 29 February earns a full day and a leap year earns 366/365 of a year
 * (FR-038; sources in __fixtures__/act365f/SOURCES.md).
 */
export const ACT365F_VERSION = "daycount-act365f@1";

export const actual365Fixed: DayCountConvention = {
  id: "actual-365-fixed",
  version: ACT365F_VERSION,
  segments(start: IsoDate, end: IsoDate) {
    assertPeriod(start, end);
    const days = daysBetween(start, end);
    return days === 0 ? [] : [{ from: start, to: end, days, denominator: 365 }];
  },
  dailyDenominator() {
    return 365;
  },
};

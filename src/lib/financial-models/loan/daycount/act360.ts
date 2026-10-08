import { daysBetween, type IsoDate } from "../../calendar/dates";
import { assertPeriod, type DayCountConvention } from "./types";

/**
 * Actual/360: actual calendar days over a 360-day year (FR-038; Fannie Mae
 * Multifamily Guide 204.02A, sources in __fixtures__/act360/SOURCES.md). Not
 * 30/360: a 31-day month earns 31/360.
 */
export const ACT360_VERSION = "daycount-act360@1";

export const actual360: DayCountConvention = {
  id: "actual-360",
  version: ACT360_VERSION,
  segments(start: IsoDate, end: IsoDate) {
    assertPeriod(start, end);
    const days = daysBetween(start, end);
    return days === 0 ? [] : [{ from: start, to: end, days, denominator: 360 }];
  },
  dailyDenominator() {
    return 360;
  },
};

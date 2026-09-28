import { compareDates, daysBetween, daysInMonth, formatIsoDate, parseIsoDate, type IsoDate } from "../../calendar/dates";
import { assertPeriod, type DayCountConvention, type DayCountSegment } from "./types";

/**
 * Monthly 30/360 with actual-day allocation: every calendar month earns
 * exactly 1/12 of a year, spread evenly over its actual days, so a day in
 * February 2024 counts 1/(12 × 29) of a year and a day in March 1/(12 × 31)
 * (FR-038, V3 §10.3). Distinct from Actual/360 and from 30/360 day counting.
 *
 * Implemented and checked against the independent oracle, but **not
 * selectable**: no verified published source exists for it yet
 * (__fixtures__/monthly-alloc/SOURCES.md).
 */
export const MONTHLY_ALLOC_VERSION = "daycount-monthly-alloc@1";

export const monthly30360ActualDayAllocation: DayCountConvention = {
  id: "monthly-30-360-actual-day-allocation",
  version: MONTHLY_ALLOC_VERSION,
  segments(start: IsoDate, end: IsoDate) {
    assertPeriod(start, end);
    const out: DayCountSegment[] = [];
    let from = start;
    while (compareDates(from, end) < 0) {
      const { year, month } = parseIsoDate(from);
      const monthEnd = month === 12 ? formatIsoDate({ year: year + 1, month: 1, day: 1 }) : formatIsoDate({ year, month: month + 1, day: 1 });
      const to = compareDates(monthEnd, end) < 0 ? monthEnd : end;
      out.push({ from, to, days: daysBetween(from, to), denominator: 12 * daysInMonth(year, month) });
      from = to;
    }
    return out;
  },
  dailyDenominator(date: IsoDate) {
    const { year, month } = parseIsoDate(date);
    return 12 * daysInMonth(year, month);
  },
};

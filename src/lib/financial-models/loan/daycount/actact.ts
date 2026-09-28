import { compareDates, daysBetween, daysInYear, formatIsoDate, parseIsoDate, type IsoDate } from "../../calendar/dates";
import { assertPeriod, type DayCountConvention, type DayCountSegment } from "./types";

/**
 * Actual/Actual (calendar), the ISDA method: each day counts over the length
 * of its own calendar year, 366 in a leap year and 365 otherwise, so a period
 * crossing a year end is split there (FR-038; ISDA 1998 memo, sources in
 * __fixtures__/actact/SOURCES.md). Not the ICMA/ISMA or AFB variants.
 */
export const ACTACT_VERSION = "daycount-actact-calendar@1";

export const actualActualCalendar: DayCountConvention = {
  id: "actual-actual-calendar",
  version: ACTACT_VERSION,
  segments(start: IsoDate, end: IsoDate) {
    assertPeriod(start, end);
    const out: DayCountSegment[] = [];
    let from = start;
    while (compareDates(from, end) < 0) {
      const year = parseIsoDate(from).year;
      const yearEnd = formatIsoDate({ year: year + 1, month: 1, day: 1 });
      const to = compareDates(yearEnd, end) < 0 ? yearEnd : end;
      out.push({ from, to, days: daysBetween(from, to), denominator: daysInYear(year) });
      from = to;
    }
    return out;
  },
  dailyDenominator(date: IsoDate) {
    return daysInYear(parseIsoDate(date).year);
  },
};

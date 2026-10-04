import { addDays, compareDates, isIsoDate, parseIsoDate, toDayNumber, type IsoDate } from "./dates";

/**
 * Scheduled-date business-day adjustment (RD-084 P1.6 T281).
 *
 * A contractual date that falls on a non-business day moves by the loan's
 * convention. Non-business days are the configured weekdays plus explicit
 * holiday dates saved with the loan, so a stored revision always reproduces
 * the same dates: nothing is fetched at run time and no country calendar is
 * built in.
 *
 * - `following`: the next business day.
 * - `modified-following`: the next business day, unless that is in the next
 *   month; then the previous business day.
 * - `preceding`: the previous business day.
 * - `modified-preceding`: the previous business day, unless that is in the
 *   previous month; then the next business day.
 *
 * Only scheduled dates move. Accrual still runs on every calendar day.
 */

export const BUSINESS_DAYS_VERSION = "business-days@1";

export const BUSINESS_DAY_ADJUSTMENTS = ["none", "following", "modified-following", "preceding", "modified-preceding"] as const;
export type BusinessDayAdjustment = (typeof BUSINESS_DAY_ADJUSTMENTS)[number];

/** ISO weekday numbers: 1 = Monday … 7 = Sunday. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

export type BusinessDayConvention = {
  adjustment: BusinessDayAdjustment;
  nonBusinessWeekdays: IsoWeekday[];
  /** Explicit non-business dates, ascending and unique. */
  holidays: IsoDate[];
};

/** The longest run of non-business days searched before giving up (a misconfiguration, not a calendar). */
export const MAX_NON_BUSINESS_RUN = 31;

export function isoWeekday(date: IsoDate): IsoWeekday {
  // Day 0 of the day-number epoch (1970-01-01) is a Thursday (ISO 4).
  return ((((toDayNumber(date) + 3) % 7) + 7) % 7 + 1) as IsoWeekday;
}

export function isBusinessDay(date: IsoDate, convention: BusinessDayConvention, holidays: ReadonlySet<IsoDate> = new Set(convention.holidays)): boolean {
  return !convention.nonBusinessWeekdays.includes(isoWeekday(date)) && !holidays.has(date);
}

export type BusinessDayProblem = { field: "nonBusinessWeekdays" | "holidays"; message: string };

/** Structural rules the parser cannot express: unique sorted holidays and at least one business weekday. */
export function businessDayProblem(convention: BusinessDayConvention): BusinessDayProblem | null {
  const weekdays = new Set(convention.nonBusinessWeekdays);
  if (weekdays.size !== convention.nonBusinessWeekdays.length) return { field: "nonBusinessWeekdays", message: "Each non-business weekday is listed once." };
  if (weekdays.size >= 7) return { field: "nonBusinessWeekdays", message: "At least one weekday must be a business day." };
  for (let i = 0; i < convention.holidays.length; i++) {
    if (!isIsoDate(convention.holidays[i])) return { field: "holidays", message: `${convention.holidays[i]} is not a date.` };
    if (i > 0 && convention.holidays[i] <= convention.holidays[i - 1]) return { field: "holidays", message: "Holiday dates are listed once, in date order." };
  }
  return null;
}

function step(date: IsoDate, direction: 1 | -1, convention: BusinessDayConvention, holidays: ReadonlySet<IsoDate>): IsoDate {
  let current = date;
  for (let i = 0; i <= MAX_NON_BUSINESS_RUN; i++) {
    if (isBusinessDay(current, convention, holidays)) return current;
    current = addDays(current, direction);
  }
  throw new RangeError(`No business day within ${MAX_NON_BUSINESS_RUN} days of ${date}.`);
}

const sameMonth = (a: IsoDate, b: IsoDate) => {
  const x = parseIsoDate(a);
  const y = parseIsoDate(b);
  return x.year === y.year && x.month === y.month;
};

/** The adjusted date for one scheduled date. Pure and deterministic. */
export function adjustBusinessDay(date: IsoDate, convention: BusinessDayConvention, holidays: ReadonlySet<IsoDate> = new Set(convention.holidays)): IsoDate {
  switch (convention.adjustment) {
    case "none":
      return date;
    case "following":
      return step(date, 1, convention, holidays);
    case "preceding":
      return step(date, -1, convention, holidays);
    case "modified-following": {
      const next = step(date, 1, convention, holidays);
      return sameMonth(next, date) ? next : step(date, -1, convention, holidays);
    }
    case "modified-preceding": {
      const previous = step(date, -1, convention, holidays);
      return sameMonth(previous, date) ? previous : step(date, 1, convention, holidays);
    }
  }
}

/** Adjust a schedule; dates that collide after adjustment are kept once, in order. */
export function adjustSchedule(dates: readonly IsoDate[], convention: BusinessDayConvention | null | undefined): IsoDate[] {
  if (!convention || convention.adjustment === "none") return [...dates];
  const holidays = new Set(convention.holidays);
  const out: IsoDate[] = [];
  for (const date of dates) {
    const adjusted = adjustBusinessDay(date, convention, holidays);
    if (out.length === 0 || compareDates(adjusted, out[out.length - 1]) > 0) out.push(adjusted);
  }
  return out;
}

export function isActiveConvention(convention: BusinessDayConvention | null | undefined): convention is BusinessDayConvention {
  return !!convention && convention.adjustment !== "none";
}

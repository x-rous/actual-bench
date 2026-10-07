/**
 * ISO calendar dates as pure integer math (FR-049, FR-040).
 *
 * Dates are `YYYY-MM-DD` strings with no time and no zone. Arithmetic runs on
 * a day number (days since 1970-01-01, proleptic Gregorian) computed with
 * integer formulas, never through `Date`, so a result cannot shift with the
 * host's time zone or daylight saving.
 *
 * Periods are half-open unless a function says otherwise: `daysBetween(a, b)`
 * counts the days from `a` inclusive to `b` exclusive, the convention every
 * day-count rule here uses.
 */

export const CALENDAR_VERSION = "calendar@1";

export type IsoDate = string;
export type DateParts = { year: number; month: number; day: number };

/** How a day-of-month that a month lacks (29–31) is placed. Only the default exists in v1. */
export type ShortMonthPolicy = "clamp-to-last-calendar-day";
export const SHORT_MONTH_POLICIES: readonly ShortMonthPolicy[] = ["clamp-to-last-calendar-day"];
export const DEFAULT_SHORT_MONTH_POLICY: ShortMonthPolicy = "clamp-to-last-calendar-day";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): 365 | 366 {
  return isLeapYear(year) ? 366 : 365;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`Month out of range: ${month}`);
  return month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
}

export function parseIsoDate(date: IsoDate): DateParts {
  const match = typeof date === "string" ? ISO_RE.exec(date) : null;
  if (!match) throw new RangeError(`Not an ISO date: ${JSON.stringify(date)}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`No such date: ${date}`);
  }
  return { year, month, day };
}

export function isIsoDate(date: unknown): date is IsoDate {
  try {
    parseIsoDate(date as string);
    return true;
  } catch {
    return false;
  }
}

export function formatIsoDate({ year, month, day }: DateParts): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days since 1970-01-01 (Hinnant's `days_from_civil`). */
export function toDayNumber(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date `n` days after 1970-01-01 (Hinnant's `civil_from_days`). */
export function fromDayNumber(n: number): IsoDate {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Day number must be an integer, got ${n}`);
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return formatIsoDate({ year, month, day });
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isSafeInteger(days)) throw new RangeError(`Days must be an integer, got ${days}`);
  return fromDayNumber(toDayNumber(date) + days);
}

/** Days from `start` (inclusive) to `end` (exclusive); negative when `end` is earlier. */
export function daysBetween(start: IsoDate, end: IsoDate): number {
  return toDayNumber(end) - toDayNumber(start);
}

export function compareDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  const diff = toDayNumber(a) - toDayNumber(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/**
 * Day `anchorDay` of the given month, placed by the short-month policy when
 * the month is shorter (31 → 30 April, 29–31 → 28 or 29 February).
 */
export function dateInMonth(
  year: number,
  month: number,
  anchorDay: number,
  policy: ShortMonthPolicy = DEFAULT_SHORT_MONTH_POLICY
): IsoDate {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new RangeError(`Day of month out of range: ${anchorDay}`);
  }
  if (policy !== "clamp-to-last-calendar-day") throw new RangeError(`Unsupported short-month policy: ${String(policy)}`);
  return formatIsoDate({ year, month, day: Math.min(anchorDay, daysInMonth(year, month)) });
}

/**
 * `months` calendar months after `date`, keeping `date`'s day of month (or
 * `anchorDay` when given) and clamping it in shorter months. The anchor is
 * never lost: 31 Jan + 1 → 29 Feb 2024, + 2 → 31 Mar.
 */
export function addMonths(
  date: IsoDate,
  months: number,
  anchorDay?: number,
  policy: ShortMonthPolicy = DEFAULT_SHORT_MONTH_POLICY
): IsoDate {
  if (!Number.isSafeInteger(months)) throw new RangeError(`Months must be an integer, got ${months}`);
  const { year, month, day } = parseIsoDate(date);
  const index = year * 12 + (month - 1) + months;
  return dateInMonth(Math.floor(index / 12), (index % 12) + 1, anchorDay ?? day, policy);
}

export function startOfMonth(date: IsoDate): IsoDate {
  const { year, month } = parseIsoDate(date);
  return formatIsoDate({ year, month, day: 1 });
}

export function endOfMonth(date: IsoDate): IsoDate {
  const { year, month } = parseIsoDate(date);
  return formatIsoDate({ year, month, day: daysInMonth(year, month) });
}

export function isLastDayOfMonth(date: IsoDate): boolean {
  const { year, month, day } = parseIsoDate(date);
  return day === daysInMonth(year, month);
}

export function isLastDayOfFebruary(date: IsoDate): boolean {
  const { year, month, day } = parseIsoDate(date);
  return month === 2 && day === daysInMonth(year, 2);
}

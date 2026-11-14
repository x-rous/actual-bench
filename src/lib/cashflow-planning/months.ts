import type { Month } from "./types";

/** Month arithmetic on `YYYY-MM` strings. Pure; no clock, no time zones. */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is Month {
  return typeof value === "string" && MONTH_RE.test(value);
}

/** Months since year 0, so months can be compared and subtracted as integers. */
export function monthIndex(month: Month): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

export function monthFromIndex(index: number): Month {
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String(index - year * 12 + 1).padStart(2, "0")}`;
}

export function addMonths(month: Month, count: number): Month {
  return monthFromIndex(monthIndex(month) + count);
}

/** `to - from` in months. */
export function monthsBetween(from: Month, to: Month): number {
  return monthIndex(to) - monthIndex(from);
}

export function monthRange(start: Month, count: number): Month[] {
  const first = monthIndex(start);
  return Array.from({ length: count }, (_, i) => monthFromIndex(first + i));
}

export const yearOf = (month: Month): number => Number(month.slice(0, 4));

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar". */
export const monthShort = (month: Month): string => SHORT[Number(month.slice(5, 7)) - 1];

/** "Mar 2026". */
export const monthLabel = (month: Month): string => `${monthShort(month)} ${month.slice(0, 4)}`;

/** The last day of the month, `YYYY-MM-DD`. */
export function monthEnd(month: Month): string {
  const year = yearOf(month), m = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}

import { format, isValid, parse } from "date-fns";

/**
 * Dates typed as free text, the way Actual reads them.
 *
 * Ported from Actual's date field (`desktop-client/.../select/DateSelect.tsx`
 * and `loot-core/src/shared/months.ts`), so a date typed here is read exactly
 * as Actual would read it:
 * - in the budget's own date format (Settings → Formatting), e.g. `dd/MM/yyyy`;
 * - day and month only (`15/8`) means this year;
 * - a two-digit year (`15/8/26`) is read as this century's;
 * - and, added here, a pasted ISO date (`2026-08-15`) is always understood.
 *
 * Dates are stored as ISO `yyyy-MM-dd` whatever the display format is.
 */

/** Actual's default date format, used when no budget says otherwise. */
export const DEFAULT_DATE_FORMAT = "MM/dd/yyyy";

/** The formats Actual offers in Settings → Formatting. */
const KNOWN_FORMATS = new Set(["MM/dd/yyyy", "dd/MM/yyyy", "yyyy-MM-dd", "MM.dd.yyyy", "dd.MM.yyyy"]);

/** A budget's date format, or Actual's default for anything unexpected. */
export function normalizeDateFormat(value: string | null | undefined): string {
  return value && KNOWN_FORMATS.has(value) ? value : DEFAULT_DATE_FORMAT;
}

function dayMonthFormat(dateFormat: string): string {
  return dateFormat.replace(/y+/g, "").replace(/[^\w]$/, "").replace(/^[^\w]/, "");
}

function dayMonthRegex(dateFormat: string): RegExp {
  const regex = dayMonthFormat(dateFormat).replace(/d+/g, "\\d{1,2}").replace(/M+/g, "\\d{1,2}");
  return new RegExp("^" + regex + "$");
}

function shortYearFormat(dateFormat: string): string {
  return dateFormat.replace(/y+/g, "yy");
}

function shortYearRegex(dateFormat: string): RegExp {
  const regex = dateFormat
    .replace(/[^\w]$/, "")
    .replace(/^[^\w]/, "")
    .replace(/d+/g, "\\d{1,2}")
    .replace(/M+/g, "\\d{1,2}")
    .replace(/y+/g, "\\d{2}");
  return new RegExp("^" + regex + "$");
}

const ISO = /^\d{4}-\d{1,2}-\d{1,2}$/;

/**
 * Read a typed date. Returns ISO `yyyy-MM-dd`, or null when the text is not a
 * date (including one that does not exist, like 31/02).
 */
export function parseTypedDate(text: string, dateFormat: string, now: Date = new Date()): string | null {
  const value = text.trim();
  if (!value) return null;
  const pattern = dayMonthRegex(dateFormat).test(value)
    ? dayMonthFormat(dateFormat)
    : shortYearRegex(dateFormat).test(value)
      ? shortYearFormat(dateFormat)
      : ISO.test(value)
        ? "yyyy-MM-dd"
        : dateFormat;
  const date = parse(value, pattern, now);
  return isValid(date) ? format(date, "yyyy-MM-dd") : null;
}

/** Show a stored ISO date in the budget's format; anything else as it is. */
export function formatTypedDate(iso: string | null | undefined, dateFormat: string): string {
  if (!iso) return "";
  const date = parse(iso, "yyyy-MM-dd", new Date());
  return isValid(date) ? format(date, dateFormat) : iso;
}

/** The format as a hint a person can read: `dd/MM/yyyy` → `dd/mm/yyyy`. */
export function dateFormatHint(dateFormat: string): string {
  return dateFormat.toLowerCase();
}

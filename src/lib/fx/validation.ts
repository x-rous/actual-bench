import { FxError } from "./errors";

/** Currency/date validation for FX (RD-056 / PR-025a). */

const CURRENCY_RE = /^[A-Z]{3}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize + validate an ISO 4217 code. Throws INVALID_CURRENCY. */
export function normalizeCurrency(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!CURRENCY_RE.test(upper)) {
    throw new FxError("INVALID_CURRENCY", `Not an ISO 4217 currency code: ${code}`);
  }
  return upper;
}

export function isValidCurrency(code: string): boolean {
  return CURRENCY_RE.test(code.trim().toUpperCase());
}

/** Validate a YYYY-MM-DD calendar date. Throws INVALID_DATE. */
export function assertValidDate(date: string): string {
  if (!ISO_DATE_RE.test(date)) {
    throw new FxError("INVALID_DATE", `Not an ISO date (YYYY-MM-DD): ${date}`);
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new FxError("INVALID_DATE", `Invalid calendar date: ${date}`);
  }
  return date;
}

export function isValidDate(date: string): boolean {
  try {
    assertValidDate(date);
    return true;
  } catch {
    return false;
  }
}

/** True when `date` is strictly after `today` (both YYYY-MM-DD). */
export function isFutureDate(date: string, today: string): boolean {
  return date > today;
}

/** Today's date (UTC) as YYYY-MM-DD, optionally shifted forward by `graceDays`. */
export function todayIso(nowMs = Date.now(), graceDays = 0): string {
  const d = new Date(nowMs);
  if (graceDays) d.setUTCDate(d.getUTCDate() + graceDays);
  return d.toISOString().slice(0, 10);
}

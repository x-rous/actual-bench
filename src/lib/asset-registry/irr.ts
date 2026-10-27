/** A dated cash flow: negative is money you put in, positive is money you got back (and the closing value on the last day). Signed integer minor units. */
export type DatedFlow = { date: string; amountMinor: number };
const DAY = 86_400_000;
const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY;

/**
 * The money-weighted annual return (XIRR, actual/365): the yearly rate at which every flow, discounted to the first date,
 * sums to zero. Null when it cannot be told: no money in or none back, or a span under `minDays`, where annualizing is noise.
 * Float math is fine here: this is a display ratio, never persisted money.
 */
export function xirr(flows: DatedFlow[], minDays = 180): number | null {
  const sorted = flows.filter((f) => f.amountMinor !== 0).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2 || !sorted.some((f) => f.amountMinor < 0) || !sorted.some((f) => f.amountMinor > 0)) return null;
  const start = sorted[0].date;
  if (days(start, sorted[sorted.length - 1].date) < minDays) return null;
  const value = (rate: number) => sorted.reduce((sum, f) => sum + f.amountMinor / Math.pow(1 + rate, days(start, f.date) / 365), 0);
  let lo = -0.99, hi = 10;
  if (value(lo) * value(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (value(lo) * value(mid) <= 0) hi = mid; else lo = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100;
}

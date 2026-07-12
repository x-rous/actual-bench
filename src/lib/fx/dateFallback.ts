/**
 * Weekend/holiday fallback (RD-056 / PR-025a, FX doc §3.2). Reference rates may
 * not exist on the exact date; select the latest available rate on or before the
 * requested date, searching a bounded window back. Never use a rate after the
 * requested date.
 */

export const FX_FALLBACK_DAYS = 10;

/** The earliest date to search from, `days` calendar days before `requestedDate`. */
export function fallbackFromDate(requestedDate: string, days = FX_FALLBACK_DAYS): string {
  const d = new Date(`${requestedDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pick the effective rate: the entry with the greatest `date` that is still
 * `<= requestedDate`. Returns null when nothing qualifies.
 */
export function pickEffectiveRate<T extends { date: string }>(
  rates: readonly T[],
  requestedDate: string
): T | null {
  let best: T | null = null;
  for (const r of rates) {
    if (r.date <= requestedDate && (best === null || r.date > best.date)) {
      best = r;
    }
  }
  return best;
}

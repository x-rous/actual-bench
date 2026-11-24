import type { SqliteDatabase } from "@/lib/app-db/types";
import { FxError } from "../errors";
import { normalizeCurrency, assertValidDate } from "../validation";
import { findActiveFxRate, insertFxRate } from "../repositories/fxRateRepository";
import type { FxRateProvider } from "../providers/fxRateProvider";

/**
 * Pre-fetch a continuous daily rate series for a pair and store each day
 * (RD-056 / PR-025e "Fill range"). Skips dates that already have an active rate
 * (never overwrites a manual/upload override). Provider-sourced only.
 */

const RETRY_DELAY_MS = 250;

/** `[from, to]` split into consecutive spans of at most a year. */
function yearChunks(from: string, to: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  let start = from;
  while (start <= to) {
    const next = new Date(`${start}T00:00:00Z`);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    next.setUTCDate(next.getUTCDate() - 1);
    const lastOfSpan = next.toISOString().slice(0, 10);
    const end = lastOfSpan < to ? lastOfSpan : to;
    chunks.push({ from: start, to: end });
    const after = new Date(`${end}T00:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    start = after.toISOString().slice(0, 10);
  }
  return chunks;
}

/** One more try after a timeout or an unavailable provider; other errors are final. */
async function fetchWithRetry(
  provider: FxRateProvider,
  input: { baseCurrency: string; quoteCurrency: string; from: string; to: string }
): Promise<{ date: string; rate: string }[]> {
  try {
    return await provider.getRateSeries!(input);
  } catch (err) {
    if (!(err instanceof FxError) || (err.code !== "PROVIDER_TIMEOUT" && err.code !== "PROVIDER_UNAVAILABLE")) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return provider.getRateSeries!(input);
  }
}

export type FillFxRateRangeResult = { fetched: number; inserted: number; skipped: number };

export async function fillFxRateRange(
  db: SqliteDatabase,
  input: { baseCurrency: string; quoteCurrency: string; from: string; to: string },
  provider: FxRateProvider
): Promise<FillFxRateRangeResult> {
  const base = normalizeCurrency(input.baseCurrency);
  const quote = normalizeCurrency(input.quoteCurrency);
  assertValidDate(input.from);
  assertValidDate(input.to);
  if (base === quote) throw new FxError("INVALID_CURRENCY", "Base and quote currencies must differ.");
  if (!provider.getRateSeries) throw new FxError("PROVIDER_UNAVAILABLE", "The provider cannot fetch a date range.");

  let fetched = 0;
  let inserted = 0;
  let skipped = 0;
  let firstFailure: unknown = null;
  // One request per year at most. A long first sync then survives a slow or failed
  // request: what arrived is kept, and only the failed part stays missing.
  for (const chunk of yearChunks(input.from, input.to)) {
    let series: { date: string; rate: string }[];
    try {
      series = await fetchWithRetry(provider, { baseCurrency: base, quoteCurrency: quote, ...chunk });
    } catch (err) {
      firstFailure ??= err;
      continue;
    }
    fetched += series.length;
    // One commit for the whole series instead of one per date.
    const store = db.transaction(() => {
      let added = 0;
      for (const { date, rate } of series) {
        if (findActiveFxRate(db, { baseCurrency: base, quoteCurrency: quote, requestedDate: date })) continue;
        insertFxRate(db, { baseCurrency: base, quoteCurrency: quote, requestedDate: date, effectiveDate: date, rate, source: "frankfurter", provider: provider.name });
        added++;
      }
      return added;
    });
    const added = store() as number;
    inserted += added;
    skipped += series.length - added;
  }
  if (firstFailure) throw firstFailure;
  return { fetched, inserted, skipped };
}

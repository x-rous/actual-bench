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

  const series = await provider.getRateSeries({ baseCurrency: base, quoteCurrency: quote, from: input.from, to: input.to });
  let inserted = 0;
  let skipped = 0;
  for (const { date, rate } of series) {
    if (findActiveFxRate(db, { baseCurrency: base, quoteCurrency: quote, requestedDate: date })) {
      skipped++;
      continue;
    }
    insertFxRate(db, { baseCurrency: base, quoteCurrency: quote, requestedDate: date, effectiveDate: date, rate, source: "frankfurter", provider: provider.name });
    inserted++;
  }
  return { fetched: series.length, inserted, skipped };
}

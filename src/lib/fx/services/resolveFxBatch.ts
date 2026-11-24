import type { SqliteDatabase } from "@/lib/app-db/types";
import { FxError, type FxRateErrorCode } from "../errors";
import { fallbackFromDate } from "../dateFallback";
import { resolveFxRate, type ResolveFxRateDeps } from "./resolveFxRate";
import { fillFxRateRange } from "./fillFxRateRange";
import type { FxRateResult } from "../types";

/**
 * Resolve many (base, quote, date) needs in one pass (RD-056 / PR-025b). The
 * preview collects every distinct pair+date it needs and resolves them together.
 * "Pending" outcomes (no usable/future rate, provider down) are returned
 * per-need rather than thrown, so one unresolved rate routes a single item to
 * review instead of failing the whole preview.
 */

export type FxNeed = { baseCurrency: string; quoteCurrency: string; date: string };
export type FxPending = { code: FxRateErrorCode; message: string };

export type FxBatchResult = {
  resolved: Record<string, FxRateResult>;
  pending: Record<string, FxPending>;
};

/** Stable key for a need, used by callers to look up its resolved rate. */
export function fxNeedKey(need: FxNeed): string {
  return `${need.baseCurrency.toUpperCase()}:${need.quoteCurrency.toUpperCase()}:${need.date}`;
}

function distinct(needs: readonly FxNeed[]): FxNeed[] {
  const seen = new Map<string, FxNeed>();
  for (const n of needs) if (!seen.has(fxNeedKey(n))) seen.set(fxNeedKey(n), n);
  return [...seen.values()];
}

export async function resolveFxBatch(
  db: SqliteDatabase,
  needs: readonly FxNeed[],
  deps: ResolveFxRateDeps = {}
): Promise<FxBatchResult> {
  const out: FxBatchResult = { resolved: {}, pending: {} };
  const distinctNeeds = distinct(needs);

  // Phase 1: the registry's rate for the exact date. With a provider available,
  // an earlier date's rate is not accepted yet: it would hide the real rate.
  const registryOnly: ResolveFxRateDeps = { ...deps, provider: undefined, exactDateOnly: !!deps.provider };
  const needProvider: FxNeed[] = [];
  const resolveOne = async (need: FxNeed) => {
    const key = fxNeedKey(need);
    try {
      out.resolved[key] = await resolveFxRate(db, need, registryOnly);
      return true;
    } catch (err) {
      if (err instanceof FxError && err.code === "RATE_NOT_FOUND" && deps.provider) return false;
      out.pending[key] = err instanceof FxError
        ? { code: err.code, message: err.message }
        : { code: "DATABASE_ERROR", message: err instanceof Error ? err.message : "FX resolution failed." };
      return true;
    }
  };
  for (const need of distinctNeeds) {
    if (!(await resolveOne(need))) needProvider.push(need);
  }

  // Phase 2: one provider range fetch per pair covering all missing dates (turns
  // N per-date calls into one), then retry those from the now-populated registry.
  if (deps.provider && needProvider.length > 0) {
    const byPair = new Map<string, FxNeed[]>();
    for (const n of needProvider) {
      // Group case-insensitively (matching fxNeedKey) so mixed-case inputs don't
      // trigger duplicate range fetches for the same pair.
      const gkey = `${n.baseCurrency.toUpperCase()}:${n.quoteCurrency.toUpperCase()}`;
      byPair.set(gkey, [...(byPair.get(gkey) ?? []), n]);
    }
    const failedPairs = new Map<string, FxPending>();
    for (const [gkey, pairNeeds] of byPair) {
      const dates = pairNeeds.map((n) => n.date).sort();
      try {
        await fillFxRateRange(db, { baseCurrency: pairNeeds[0].baseCurrency, quoteCurrency: pairNeeds[0].quoteCurrency, from: fallbackFromDate(dates[0]), to: dates[dates.length - 1] }, deps.provider);
      } catch (err) {
        failedPairs.set(gkey, err instanceof FxError
          ? { code: err.code, message: err.message }
          : { code: "PROVIDER_UNAVAILABLE", message: "Could not reach the FX rate provider." });
      }
    }
    for (const need of needProvider) {
      const key = fxNeedKey(need);
      const failure = failedPairs.get(`${need.baseCurrency.toUpperCase()}:${need.quoteCurrency.toUpperCase()}`);
      try {
        // After a failed fetch the real rate is unknown, so the row waits rather
        // than locking in an older date's rate. A date the provider answered
        // without a rate (no publication that day) may use the latest earlier one.
        out.resolved[key] = await resolveFxRate(db, need, { ...deps, provider: undefined, exactDateOnly: !!failure });
      } catch (err) {
        out.pending[key] = failure ?? (err instanceof FxError ? { code: err.code, message: err.message } : { code: "DATABASE_ERROR", message: "FX resolution failed." });
      }
    }
  }

  return out;
}

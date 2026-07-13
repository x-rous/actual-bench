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

  // Phase 1: resolve from the registry only (no provider). Records rate hits and
  // collects the dates that would otherwise need a per-date provider fetch.
  const registryOnly: ResolveFxRateDeps = { ...deps, provider: undefined };
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
    for (const n of needProvider) byPair.set(`${n.baseCurrency}:${n.quoteCurrency}`, [...(byPair.get(`${n.baseCurrency}:${n.quoteCurrency}`) ?? []), n]);
    for (const pairNeeds of byPair.values()) {
      const dates = pairNeeds.map((n) => n.date).sort();
      try {
        await fillFxRateRange(db, { baseCurrency: pairNeeds[0].baseCurrency, quoteCurrency: pairNeeds[0].quoteCurrency, from: fallbackFromDate(dates[0]), to: dates[dates.length - 1] }, deps.provider);
      } catch {
        // Provider unavailable → the retry below leaves these as pending.
      }
    }
    for (const need of needProvider) {
      const key = fxNeedKey(need);
      try {
        out.resolved[key] = await resolveFxRate(db, need, registryOnly);
      } catch (err) {
        out.pending[key] = err instanceof FxError ? { code: err.code, message: err.message } : { code: "DATABASE_ERROR", message: "FX resolution failed." };
      }
    }
  }

  return out;
}

import type { SqliteDatabase } from "@/lib/app-db/types";
import { FxError } from "../errors";
import { normalizeCurrency, assertValidDate, isFutureDate, todayIso } from "../validation";
import { invertRate, isValidRate } from "../fxMath";
import { findActiveFxRate, insertFxRate } from "../repositories/fxRateRepository";
import { findTransactionFx } from "../repositories/transactionFxRepository";
import type { FxRateProvider } from "../providers/fxRateProvider";
import type { FxRateResult, TransactionFxRecord } from "../types";

/**
 * Resolve the FX rate for a pair+date using the explicit priority order
 * (RD-056 / PR-025a, FX doc §10, §24). The DB is authoritative; the provider is
 * the last resort and its result is persisted for reuse. Never uses a future
 * rate; same-currency short-circuits without any DB/API access.
 */

export type ResolveFxRateInput = {
  baseCurrency: string;
  quoteCurrency: string;
  date: string;
  transactionId?: string;
  manualRate?: string;
  refreshExistingRate?: boolean;
};

export type ResolveFxRateDeps = {
  provider?: FxRateProvider;
  nowMs?: number;
};

function snapshotToResult(snap: TransactionFxRecord): FxRateResult {
  return {
    provider: snap.provider,
    baseCurrency: snap.sourceCurrency,
    quoteCurrency: snap.targetCurrency,
    requestedDate: snap.requestedDate,
    effectiveDate: snap.effectiveDate,
    rate: snap.appliedRate,
    source: snap.source,
    isManual: snap.isManual,
    fxRateId: snap.fxRateId,
  };
}

export async function resolveFxRate(
  db: SqliteDatabase,
  input: ResolveFxRateInput,
  deps: ResolveFxRateDeps = {}
): Promise<FxRateResult> {
  const base = normalizeCurrency(input.baseCurrency);
  const quote = normalizeCurrency(input.quoteCurrency);
  assertValidDate(input.date);

  // Same currency: rate 1, no DB, no API (FX doc §11).
  if (base === quote) {
    return { provider: null, baseCurrency: base, quoteCurrency: quote, requestedDate: input.date, effectiveDate: input.date, rate: "1", source: "derived", isManual: false, fxRateId: null };
  }

  // Never use today's rate for a future transaction (FX doc §19).
  if (isFutureDate(input.date, todayIso(deps.nowMs))) {
    throw new FxError("FUTURE_DATE", `Transaction date ${input.date} is in the future; FX rate is pending.`);
  }

  // 1. Explicit per-transaction manual rate wins outright (FX doc §18).
  if (input.manualRate) {
    if (!isValidRate(input.manualRate)) throw new FxError("INVALID_RATE", `Invalid manual rate: ${input.manualRate}`);
    return { provider: null, baseCurrency: base, quoteCurrency: quote, requestedDate: input.date, effectiveDate: input.date, rate: input.manualRate, source: "manual", isManual: true, fxRateId: null };
  }

  // 2. Reuse the transaction's own snapshot unless an explicit refresh is asked.
  if (input.transactionId && !input.refreshExistingRate) {
    const snap = findTransactionFx(db, input.transactionId);
    if (snap) return snapshotToResult(snap);
  }

  // 3-6. The single active registry rate for the pair+date (one active per
  // pair+date; manual/upload/provider/derived precedence is enforced at write).
  const active = findActiveFxRate(db, { baseCurrency: base, quoteCurrency: quote, requestedDate: input.date });
  if (active) {
    return { provider: active.provider, baseCurrency: base, quoteCurrency: quote, requestedDate: active.requestedDate, effectiveDate: active.effectiveDate, rate: active.rate, source: active.source, isManual: active.source === "manual", fxRateId: active.id };
  }

  // 6b. Derive from a stored inverse rate (quote→base) if one is active (§13).
  const inverse = findActiveFxRate(db, { baseCurrency: quote, quoteCurrency: base, requestedDate: input.date });
  if (inverse) {
    const derivedRate = invertRate(inverse.rate);
    const stored = insertFxRate(db, { baseCurrency: base, quoteCurrency: quote, requestedDate: input.date, effectiveDate: inverse.effectiveDate, rate: derivedRate, source: "derived", provider: inverse.provider, derivedFromFxRateId: inverse.id });
    return { provider: stored.provider, baseCurrency: base, quoteCurrency: quote, requestedDate: stored.requestedDate, effectiveDate: stored.effectiveDate, rate: stored.rate, source: "derived", isManual: false, fxRateId: stored.id };
  }

  // 7. Last resort: fetch from the provider and persist it for reuse.
  if (!deps.provider) throw new FxError("RATE_NOT_FOUND", `No stored ${base}/${quote} rate for ${input.date}.`);
  const fetched = await deps.provider.getRate({ baseCurrency: base, quoteCurrency: quote, date: input.date });
  const stored = insertFxRate(db, { baseCurrency: base, quoteCurrency: quote, requestedDate: fetched.requestedDate, effectiveDate: fetched.effectiveDate, rate: fetched.rate, source: "frankfurter", provider: fetched.provider });
  return { ...fetched, fxRateId: stored.id };
}

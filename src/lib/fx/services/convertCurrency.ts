import type { SqliteDatabase } from "@/lib/app-db/types";
import { convertMinorUnits } from "../fxMath";
import { resolveFxRate, type ResolveFxRateDeps } from "./resolveFxRate";
import { saveTransactionFx, findTransactionFx } from "../repositories/transactionFxRepository";
import type { FxConversionResult } from "../types";

/**
 * Convert an integer-minor-unit amount to the target currency for a transaction
 * date (RD-056 / PR-025a, FX doc §9). Resolves the rate (priority order),
 * converts with high precision, and — when a transactionId is given — persists
 * the immutable snapshot so reruns reuse the exact applied rate.
 */

export type ConvertCurrencyInput = {
  amount: number;
  sourceCurrency: string;
  targetCurrency: string;
  date: string;
  transactionId?: string;
  manualRate?: string;
  refreshExistingRate?: boolean;
};

export async function convertCurrency(
  db: SqliteDatabase,
  input: ConvertCurrencyInput,
  deps: ResolveFxRateDeps = {}
): Promise<FxConversionResult> {
  // Reuse an existing snapshot verbatim unless a refresh was requested, so the
  // converted amount never drifts on rerun (lock-at-first-sync).
  if (input.transactionId && !input.refreshExistingRate && !input.manualRate) {
    const snap = findTransactionFx(db, input.transactionId);
    if (snap) {
      return {
        sourceAmount: snap.sourceAmount,
        convertedAmount: snap.convertedAmount,
        sourceCurrency: snap.sourceCurrency,
        targetCurrency: snap.targetCurrency,
        requestedDate: snap.requestedDate,
        effectiveDate: snap.effectiveDate,
        rate: snap.appliedRate,
        rateSource: snap.source,
        provider: snap.provider,
        fxRateId: snap.fxRateId,
        isManual: snap.isManual,
      };
    }
  }

  const rate = await resolveFxRate(
    db,
    {
      baseCurrency: input.sourceCurrency,
      quoteCurrency: input.targetCurrency,
      date: input.date,
      transactionId: input.transactionId,
      manualRate: input.manualRate,
      refreshExistingRate: input.refreshExistingRate,
    },
    deps
  );

  const convertedAmount = convertMinorUnits(input.amount, rate.rate);

  const result: FxConversionResult = {
    sourceAmount: input.amount,
    convertedAmount,
    sourceCurrency: rate.baseCurrency,
    targetCurrency: rate.quoteCurrency,
    requestedDate: rate.requestedDate,
    effectiveDate: rate.effectiveDate,
    rate: rate.rate,
    rateSource: rate.source,
    provider: rate.provider,
    fxRateId: rate.fxRateId,
    isManual: rate.isManual,
  };

  if (input.transactionId) {
    saveTransactionFx(db, {
      transactionId: input.transactionId,
      fxRateId: rate.fxRateId,
      sourceCurrency: rate.baseCurrency,
      targetCurrency: rate.quoteCurrency,
      sourceAmount: input.amount,
      convertedAmount,
      appliedRate: rate.rate,
      requestedDate: rate.requestedDate,
      effectiveDate: rate.effectiveDate,
      source: rate.source,
      provider: rate.provider,
      isManual: rate.isManual,
    });
  }

  return result;
}

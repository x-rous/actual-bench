import type { SqliteDatabase } from "@/lib/app-db/types";
import { normalizeCurrency, assertValidDate } from "../validation";
import { convertMinorUnits } from "../fxMath";
import { findActiveFxRate } from "../repositories/fxRateRepository";
import { findTransactionFxForPairDate } from "../repositories/transactionFxRepository";

/**
 * Rate-change impact preview (RD-056 / PR-025f, FX doc §16). Read-only: shows
 * which already-synced transactions would change if the current active rate for
 * a pair+date were applied to them (old → new converted amount). It mutates
 * nothing — actually revaluing must rewrite the target budget transaction too
 * (a separate, transport-driven step) so the snapshot never disagrees with the
 * budget.
 */

export type FxRecalcImpactRow = {
  transactionId: string;
  sourceAmount: number;
  appliedRate: string;
  oldConvertedAmount: number;
  newConvertedAmount: number;
};

export type FxRecalcImpact = {
  activeRate: string | null;
  rows: FxRecalcImpactRow[];
};

export function previewFxRecalcImpact(
  db: SqliteDatabase,
  input: { baseCurrency: string; quoteCurrency: string; date: string }
): FxRecalcImpact {
  const base = normalizeCurrency(input.baseCurrency);
  const quote = normalizeCurrency(input.quoteCurrency);
  assertValidDate(input.date);

  const active = findActiveFxRate(db, { baseCurrency: base, quoteCurrency: quote, requestedDate: input.date });
  if (!active) return { activeRate: null, rows: [] };

  const rows: FxRecalcImpactRow[] = [];
  for (const snap of findTransactionFxForPairDate(db, { sourceCurrency: base, targetCurrency: quote, requestedDate: input.date })) {
    // Only rows whose applied rate differs from the current active rate would change.
    if (snap.appliedRate === active.rate) continue;
    // Recompute the magnitude from the source amount + active rate, keeping the
    // existing converted sign (which reflects the flow's amount direction).
    const magnitude = convertMinorUnits(Math.abs(snap.sourceAmount), active.rate);
    const newConvertedAmount = snap.convertedAmount < 0 ? -magnitude : magnitude;
    rows.push({
      transactionId: snap.transactionId,
      sourceAmount: snap.sourceAmount,
      appliedRate: snap.appliedRate,
      oldConvertedAmount: snap.convertedAmount,
      newConvertedAmount,
    });
  }
  return { activeRate: active.rate, rows };
}

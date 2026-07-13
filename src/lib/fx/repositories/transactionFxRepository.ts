import { generateId } from "@/lib/uuid";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { FxRateSource, TransactionFxInput, TransactionFxRecord } from "../types";

/**
 * Immutable per-transaction FX snapshots (RD-056 / PR-025a). Always stores the
 * applied rate, so a transaction stays reproducible even if the source registry
 * rate is later superseded (FX doc §8.4).
 */

type TransactionFxRow = {
  id: string;
  transaction_id: string;
  fx_rate_id: string | null;
  source_currency: string;
  target_currency: string;
  source_amount: number;
  converted_amount: number;
  applied_rate: string;
  requested_date: string;
  effective_date: string;
  source: string;
  provider: string | null;
  is_manual: number;
  applied_at: string;
  updated_at: string;
};

function rowToSnapshot(row: TransactionFxRow): TransactionFxRecord {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    fxRateId: row.fx_rate_id,
    sourceCurrency: row.source_currency,
    targetCurrency: row.target_currency,
    sourceAmount: row.source_amount,
    convertedAmount: row.converted_amount,
    appliedRate: row.applied_rate,
    requestedDate: row.requested_date,
    effectiveDate: row.effective_date,
    source: row.source as FxRateSource,
    provider: row.provider,
    isManual: row.is_manual === 1,
    appliedAt: row.applied_at,
    updatedAt: row.updated_at,
  };
}

export function findTransactionFx(db: SqliteDatabase, transactionId: string): TransactionFxRecord | null {
  const row = db
    .prepare("SELECT * FROM transaction_fx WHERE transaction_id = ?")
    .get<TransactionFxRow>(transactionId);
  return row ? rowToSnapshot(row) : null;
}

/**
 * Store the immutable snapshot for a transaction (one FX target per txn). The
 * snapshot is lock-at-first-sync: an existing snapshot is kept as-is and
 * returned unchanged. Explicit revaluation (025f) will use a dedicated update.
 */
export function saveTransactionFx(db: SqliteDatabase, input: TransactionFxInput): TransactionFxRecord {
  const now = new Date().toISOString();
  const id = input.id ?? generateId();

  const inserted = db
    .prepare(
      `INSERT INTO transaction_fx (
         id, transaction_id, fx_rate_id, source_currency, target_currency,
         source_amount, converted_amount, applied_rate, requested_date, effective_date,
         source, provider, is_manual, applied_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(transaction_id) DO NOTHING
       RETURNING *`
    )
    .get<TransactionFxRow>(
      id,
      input.transactionId,
      input.fxRateId,
      input.sourceCurrency,
      input.targetCurrency,
      input.sourceAmount,
      input.convertedAmount,
      input.appliedRate,
      input.requestedDate,
      input.effectiveDate,
      input.source,
      input.provider,
      input.isManual ? 1 : 0,
      now,
      now
    );
  // On conflict the insert wrote nothing; return the existing (kept) snapshot.
  return inserted ? rowToSnapshot(inserted) : findTransactionFx(db, input.transactionId)!;
}

/** Snapshots that used a given registry rate (for explicit recalculation, 025e). */
export function findAffectedTransactionFx(db: SqliteDatabase, fxRateId: string): TransactionFxRecord[] {
  return db
    .prepare("SELECT * FROM transaction_fx WHERE fx_rate_id = ?")
    .all<TransactionFxRow>(fxRateId)
    .map(rowToSnapshot);
}

/** Snapshots for a currency pair on a requested date (for a rate-change impact view, 025f). */
export function findTransactionFxForPairDate(
  db: SqliteDatabase,
  input: { sourceCurrency: string; targetCurrency: string; requestedDate: string }
): TransactionFxRecord[] {
  return db
    .prepare("SELECT * FROM transaction_fx WHERE source_currency = ? AND target_currency = ? AND requested_date = ?")
    .all<TransactionFxRow>(input.sourceCurrency, input.targetCurrency, input.requestedDate)
    .map(rowToSnapshot);
}

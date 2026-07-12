import { generateId } from "@/lib/uuid";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { FxRateInput, FxRateRecord, FxRateSource } from "../types";

/**
 * Registry of daily FX rates (RD-056 / PR-025a). The DB is the authoritative
 * source; provider/uploaded/manual/derived rates all live here. Edits use
 * versioned replacement (supersede + insert) so audit history is preserved.
 */

type FxRateRow = {
  id: string;
  base_currency: string;
  quote_currency: string;
  requested_date: string;
  effective_date: string;
  rate: string;
  source: string;
  provider: string | null;
  status: string;
  is_user_override: number;
  import_batch_id: string | null;
  derived_from_fx_rate_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  notes: string | null;
};

function rowToRate(row: FxRateRow): FxRateRecord {
  return {
    id: row.id,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    requestedDate: row.requested_date,
    effectiveDate: row.effective_date,
    rate: row.rate,
    source: row.source as FxRateSource,
    provider: row.provider,
    status: row.status as FxRateRecord["status"],
    isUserOverride: row.is_user_override === 1,
    importBatchId: row.import_batch_id,
    derivedFromFxRateId: row.derived_from_fx_rate_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    notes: row.notes,
  };
}

export function insertFxRate(db: SqliteDatabase, input: FxRateInput): FxRateRecord {
  const now = new Date().toISOString();
  const id = input.id ?? generateId();
  const row = db
    .prepare(
      `INSERT INTO fx_rates (
         id, base_currency, quote_currency, requested_date, effective_date, rate,
         source, provider, status, is_user_override, import_batch_id,
         derived_from_fx_rate_id, created_at, updated_at, created_by, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get<FxRateRow>(
      id,
      input.baseCurrency,
      input.quoteCurrency,
      input.requestedDate,
      input.effectiveDate,
      input.rate,
      input.source,
      input.provider ?? null,
      input.status ?? "active",
      input.isUserOverride ? 1 : 0,
      input.importBatchId ?? null,
      input.derivedFromFxRateId ?? null,
      now,
      now,
      input.createdBy ?? null,
      input.notes ?? null
    );
  return rowToRate(row as FxRateRow);
}

export function findActiveFxRate(
  db: SqliteDatabase,
  input: { baseCurrency: string; quoteCurrency: string; requestedDate: string }
): FxRateRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM fx_rates
       WHERE base_currency = ? AND quote_currency = ? AND requested_date = ? AND status = 'active'
       LIMIT 1`
    )
    .get<FxRateRow>(input.baseCurrency, input.quoteCurrency, input.requestedDate);
  return row ? rowToRate(row) : null;
}

/** Active rates for the pair+date restricted to the given sources, in the caller's priority order. */
export function findActiveFxRatesBySource(
  db: SqliteDatabase,
  input: { baseCurrency: string; quoteCurrency: string; requestedDate: string; sources: FxRateSource[] }
): FxRateRecord[] {
  if (input.sources.length === 0) return [];
  const placeholders = input.sources.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT * FROM fx_rates
       WHERE base_currency = ? AND quote_currency = ? AND requested_date = ?
         AND status = 'active' AND source IN (${placeholders})`
    )
    .all<FxRateRow>(input.baseCurrency, input.quoteCurrency, input.requestedDate, ...input.sources);
  const bySource = new Map(rows.map((r) => [r.source, rowToRate(r)]));
  return input.sources.map((s) => bySource.get(s)).filter((r): r is FxRateRecord => r != null);
}

export function findFxRatesForDateRange(
  db: SqliteDatabase,
  input: { baseCurrency: string; quoteCurrency: string; fromDate: string; toDate: string }
): FxRateRecord[] {
  return db
    .prepare(
      `SELECT * FROM fx_rates
       WHERE base_currency = ? AND quote_currency = ? AND requested_date BETWEEN ? AND ?
       ORDER BY requested_date ASC`
    )
    .all<FxRateRow>(input.baseCurrency, input.quoteCurrency, input.fromDate, input.toDate)
    .map(rowToRate);
}

/** Mark the active rate for a pair+date as superseded (part of a versioned edit). */
export function supersedeActiveFxRate(
  db: SqliteDatabase,
  input: { baseCurrency: string; quoteCurrency: string; requestedDate: string }
): void {
  db.prepare(
    `UPDATE fx_rates SET status = 'superseded', updated_at = ?
     WHERE base_currency = ? AND quote_currency = ? AND requested_date = ? AND status = 'active'`
  ).run(new Date().toISOString(), input.baseCurrency, input.quoteCurrency, input.requestedDate);
}

/**
 * Versioned replacement: atomically supersede the current active rate for the
 * pair+date and insert `next` as the new active row. Preserves history and keeps
 * the "one active per pair+date" invariant.
 */
export function replaceActiveFxRate(db: SqliteDatabase, next: FxRateInput): FxRateRecord {
  const run = db.transaction(() => {
    supersedeActiveFxRate(db, {
      baseCurrency: next.baseCurrency,
      quoteCurrency: next.quoteCurrency,
      requestedDate: next.requestedDate,
    });
    return insertFxRate(db, { ...next, status: "active" });
  });
  return run() as FxRateRecord;
}

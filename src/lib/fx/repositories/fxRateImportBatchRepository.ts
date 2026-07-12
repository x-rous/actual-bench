import { generateId } from "@/lib/uuid";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { FxRateImportBatch, FxRateImportStatus } from "../types";

/** Tracks uploaded FX-rate files and their outcomes (RD-056 / PR-025a; used by 025d). */

type BatchRow = {
  id: string;
  filename: string;
  imported_at: string;
  inserted_count: number;
  replaced_count: number;
  rejected_count: number;
  status: string;
  created_by: string | null;
  notes: string | null;
};

function rowToBatch(row: BatchRow): FxRateImportBatch {
  return {
    id: row.id,
    filename: row.filename,
    importedAt: row.imported_at,
    insertedCount: row.inserted_count,
    replacedCount: row.replaced_count,
    rejectedCount: row.rejected_count,
    status: row.status as FxRateImportStatus,
    createdBy: row.created_by,
    notes: row.notes,
  };
}

export function createFxImportBatch(
  db: SqliteDatabase,
  input: { filename: string; createdBy?: string | null; notes?: string | null }
): FxRateImportBatch {
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `INSERT INTO fx_rate_import_batches (id, filename, imported_at, status, created_by, notes)
       VALUES (?, ?, ?, 'pending', ?, ?) RETURNING *`
    )
    .get<BatchRow>(generateId(), input.filename, now, input.createdBy ?? null, input.notes ?? null);
  return rowToBatch(row as BatchRow);
}

export function updateFxImportBatch(
  db: SqliteDatabase,
  id: string,
  patch: { insertedCount: number; replacedCount: number; rejectedCount: number; status: FxRateImportStatus }
): FxRateImportBatch | null {
  const row = db
    .prepare(
      `UPDATE fx_rate_import_batches
       SET inserted_count = ?, replaced_count = ?, rejected_count = ?, status = ?
       WHERE id = ? RETURNING *`
    )
    .get<BatchRow>(patch.insertedCount, patch.replacedCount, patch.rejectedCount, patch.status, id);
  return row ? rowToBatch(row) : null;
}

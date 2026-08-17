import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import type { PayeeCleanupSuppressionRecord, SqliteDatabase } from "./types";

/**
 * Persistence for Payee Cleanup suppressions (RD-078 §14 / PR-041d).
 *
 * Stores only the user's own decisions about their own payees — no credentials,
 * no copied budget data, no transaction detail.
 *
 * Budget-scoped, because payee ids and names belong to one budget file. A user
 * with a household budget and a business budget should not have a decision in
 * one silence a genuine suggestion in the other.
 */

type SuppressionRow = {
  id: string;
  budget_sync_id: string;
  kind: string;
  payee_ids: string;
  normalized_names: string;
  detector_ids: string;
  note: string | null;
  created_at: string;
};

const KINDS = new Set(["not-duplicates", "rejected-affix"]);
const NOTE_MAX = 500;
const LIST_MAX = 50;

function parseList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: SuppressionRow): PayeeCleanupSuppressionRecord {
  return {
    id: row.id,
    budgetSyncId: row.budget_sync_id,
    kind: row.kind === "rejected-affix" ? "rejected-affix" : "not-duplicates",
    payeeIds: parseList(row.payee_ids),
    normalizedNames: parseList(row.normalized_names),
    detectorIds: parseList(row.detector_ids),
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

function normalizeList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AppDbValidationError(`${label} must be an array of strings`);
  }
  const list = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  if (list.length > LIST_MAX) {
    throw new AppDbValidationError(`${label} must hold ${LIST_MAX} entries or fewer`);
  }
  return [...new Set(list)];
}

export function listPayeeCleanupSuppressions(
  db: SqliteDatabase,
  budgetSyncId: string
): PayeeCleanupSuppressionRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM payee_cleanup_suppressions
       WHERE budget_sync_id = ?
       ORDER BY created_at DESC`
    )
    .all(budgetSyncId) as SuppressionRow[];
  return rows.map(rowToRecord);
}

export function createPayeeCleanupSuppression(
  db: SqliteDatabase,
  input: unknown
): PayeeCleanupSuppressionRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppDbValidationError("Suppression payload must be an object");
  }
  const body = input as Record<string, unknown>;

  const budgetSyncId =
    typeof body.budgetSyncId === "string" ? body.budgetSyncId.trim() : "";
  if (!budgetSyncId) {
    throw new AppDbValidationError("budgetSyncId is required");
  }

  const kind = typeof body.kind === "string" ? body.kind : "not-duplicates";
  if (!KINDS.has(kind)) {
    throw new AppDbValidationError(`Unknown suppression kind "${kind}"`);
  }

  const payeeIds = normalizeList(body.payeeIds, "payeeIds");
  const normalizedNames = normalizeList(body.normalizedNames, "normalizedNames");
  const detectorIds = normalizeList(body.detectorIds, "detectorIds");

  // Without one of these the record can never match anything again, so it would
  // silently do nothing — better to reject it than to store a dead row.
  if (payeeIds.length === 0 && normalizedNames.length === 0) {
    throw new AppDbValidationError(
      "A suppression needs payee ids or normalized names to match on"
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, NOTE_MAX)
      : null;

  const record: SuppressionRow = {
    id: generateId(),
    budget_sync_id: budgetSyncId,
    kind,
    payee_ids: JSON.stringify(payeeIds),
    normalized_names: JSON.stringify(normalizedNames),
    detector_ids: JSON.stringify(detectorIds),
    note,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO payee_cleanup_suppressions
       (id, budget_sync_id, kind, payee_ids, normalized_names, detector_ids, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.budget_sync_id,
    record.kind,
    record.payee_ids,
    record.normalized_names,
    record.detector_ids,
    record.note,
    record.created_at
  );

  return rowToRecord(record);
}

/**
 * Returns true when a row was removed, so the caller can 404 an unknown id.
 *
 * Scoped to the budget as well as the id: every other read and write here is
 * budget-scoped, and an id alone would let one budget delete another budget's
 * decision.
 */
export function deletePayeeCleanupSuppression(
  db: SqliteDatabase,
  id: string,
  budgetSyncId: string
): boolean {
  const result = db
    .prepare(
      "DELETE FROM payee_cleanup_suppressions WHERE id = ? AND budget_sync_id = ?"
    )
    .run(id, budgetSyncId);
  return result.changes > 0;
}

/** Clears every suppression for one budget — the "start over" action. */
export function clearPayeeCleanupSuppressions(
  db: SqliteDatabase,
  budgetSyncId: string
): number {
  const result = db
    .prepare("DELETE FROM payee_cleanup_suppressions WHERE budget_sync_id = ?")
    .run(budgetSyncId);
  return result.changes;
}

/**
 * Saved reconciliation transforms (migration v67).
 *
 * A named IF/THEN rule kept per budget so it can be run again on the next
 * import. Only the rule is stored: no statement rows, transactions or amounts
 * from the session it was made in.
 */

import { generateId } from "@/lib/uuid";
import { sanitizeSavedRule, type SavedRule, type SavedTransform } from "@/lib/reconciliation/transform/saved";
import { AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

export type SavedTransformRecord = SavedTransform;

type TransformRow = {
  id: string;
  budget_sync_id: string;
  name: string;
  rule_json: string;
  position: number;
  created_at: string;
  updated_at: string;
};

const MAX_NAME = 120;

function requiredText(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError(`Saved transform ${field} is required`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new AppDbValidationError(`Saved transform ${field} must be ${max} characters or fewer`);
  }
  return text;
}

function validRule(value: unknown): SavedRule {
  const rule = sanitizeSavedRule(value);
  if (!rule) throw new AppDbValidationError("Saved transform rule is invalid");
  return rule;
}

/** A row whose rule this build cannot read is skipped, not returned half-understood. */
function toRecord(row: TransformRow): SavedTransformRecord | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.rule_json);
  } catch {
    return null;
  }
  const rule = sanitizeSavedRule(parsed);
  if (!rule) return null;
  return {
    id: row.id,
    name: row.name,
    rule,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertNameFree(db: SqliteDatabase, budgetSyncId: string, name: string, exceptId?: string) {
  const clash = db
    .prepare(
      `SELECT id FROM reconciliation_transforms
        WHERE budget_sync_id = ? AND name = ? COLLATE NOCASE AND id <> ?`
    )
    .get<{ id: string }>(budgetSyncId, name, exceptId ?? "");
  if (clash) throw new AppDbValidationError(`A saved transform named "${name}" already exists`);
}

export function listSavedTransforms(db: SqliteDatabase, budgetSyncId: string): SavedTransformRecord[] {
  return db
    .prepare(
      `SELECT * FROM reconciliation_transforms
        WHERE budget_sync_id = ?
        ORDER BY position, created_at, id`
    )
    .all<TransformRow>(requiredText(budgetSyncId, "budget"))
    .flatMap((row) => toRecord(row) ?? []);
}

function findRow(db: SqliteDatabase, budgetSyncId: string, id: string): TransformRow | undefined {
  return db
    .prepare("SELECT * FROM reconciliation_transforms WHERE budget_sync_id = ? AND id = ?")
    .get<TransformRow>(budgetSyncId, id);
}

/** Saves a new transform at the end of the budget's list. */
export function createSavedTransform(
  db: SqliteDatabase,
  input: { budgetSyncId: string; name: string; rule: unknown }
): SavedTransformRecord {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  const name = requiredText(input.name, "name", MAX_NAME);
  const rule = validRule(input.rule);
  const timestamp = new Date().toISOString();
  const id = generateId();

  return db.transaction(() => {
    assertNameFree(db, budgetSyncId, name);
    const last = db
      .prepare("SELECT MAX(position) AS position FROM reconciliation_transforms WHERE budget_sync_id = ?")
      .get<{ position: number | null }>(budgetSyncId);
    db.prepare(
      `INSERT INTO reconciliation_transforms (id, budget_sync_id, name, rule_json, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, budgetSyncId, name, JSON.stringify(rule), (last?.position ?? -1) + 1, timestamp, timestamp);
    return toRecord(findRow(db, budgetSyncId, id)!)!;
  })();
}

/** Renames a transform or replaces its rule; returns null when it does not exist. */
export function updateSavedTransform(
  db: SqliteDatabase,
  input: { budgetSyncId: string; id: string; name?: unknown; rule?: unknown }
): SavedTransformRecord | null {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  const id = requiredText(input.id, "id");
  const name = input.name === undefined ? undefined : requiredText(input.name, "name", MAX_NAME);
  const rule = input.rule === undefined ? undefined : validRule(input.rule);

  return db.transaction(() => {
    const row = findRow(db, budgetSyncId, id);
    if (!row) return null;
    if (name !== undefined) assertNameFree(db, budgetSyncId, name, id);
    db.prepare(
      `UPDATE reconciliation_transforms
          SET name = ?, rule_json = ?, updated_at = ?
        WHERE budget_sync_id = ? AND id = ?`
    ).run(
      name ?? row.name,
      rule === undefined ? row.rule_json : JSON.stringify(rule),
      new Date().toISOString(),
      budgetSyncId,
      id
    );
    return toRecord(findRow(db, budgetSyncId, id)!);
  })();
}

/**
 * Sets the run order. Ids not listed keep their relative order after the
 * listed ones, so a list from a stale screen cannot drop a transform.
 */
export function reorderSavedTransforms(
  db: SqliteDatabase,
  input: { budgetSyncId: string; ids: unknown }
): SavedTransformRecord[] {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  if (!Array.isArray(input.ids) || input.ids.some((id) => typeof id !== "string")) {
    throw new AppDbValidationError("Expected an array of saved transform ids");
  }
  const wanted = input.ids as string[];
  db.transaction(() => {
    const existing = listSavedTransforms(db, budgetSyncId).map((entry) => entry.id);
    const known = new Set(existing);
    const order = [
      ...wanted.filter((id, index) => known.has(id) && wanted.indexOf(id) === index),
      ...existing.filter((id) => !wanted.includes(id)),
    ];
    const update = db.prepare(
      "UPDATE reconciliation_transforms SET position = ? WHERE budget_sync_id = ? AND id = ?"
    );
    order.forEach((id, index) => update.run(index, budgetSyncId, id));
  })();
  return listSavedTransforms(db, budgetSyncId);
}

export function deleteSavedTransform(db: SqliteDatabase, budgetSyncId: string, id: string): boolean {
  return (
    db
      .prepare("DELETE FROM reconciliation_transforms WHERE budget_sync_id = ? AND id = ?")
      .run(requiredText(budgetSyncId, "budget"), requiredText(id, "id")).changes > 0
  );
}

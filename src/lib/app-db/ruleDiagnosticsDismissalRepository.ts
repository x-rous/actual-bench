import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import type { RuleDiagnosticsDismissalRecord, SqliteDatabase } from "./types";

/**
 * Persistence for Rule Diagnostics dismissals (F-103 / PR-049).
 *
 * Stores only the user's own decisions about their own rules — no credentials,
 * no copied budget data, no transaction detail.
 *
 * Budget-scoped, because rule ids and signatures belong to one budget file. A
 * household budget and a business budget can hold rules that look identical;
 * a decision taken in one must not silence a genuine finding in the other.
 */

type DismissalRow = {
  id: string;
  budget_sync_id: string;
  code: string;
  rule_ids: string;
  signatures: string;
  discriminator: string | null;
  note: string | null;
  created_at: string;
};

const NOTE_MAX = 500;
const LIST_MAX = 50;
const DISCRIMINATOR_MAX = 500;

function parseList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: DismissalRow): RuleDiagnosticsDismissalRecord {
  return {
    id: row.id,
    budgetSyncId: row.budget_sync_id,
    code: row.code,
    ruleIds: parseList(row.rule_ids),
    signatures: parseList(row.signatures),
    ...(row.discriminator ? { discriminator: row.discriminator } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
  };
}

/**
 * Order is preserved rather than sorted here: `dismisses()` compares as a
 * multiset, so the stored order carries no meaning, and rewriting it would only
 * make the stored row harder to match against a bug report.
 */
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
  return list;
}

export function listRuleDiagnosticsDismissals(
  db: SqliteDatabase,
  budgetSyncId: string
): RuleDiagnosticsDismissalRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM rule_diagnostics_dismissals
       WHERE budget_sync_id = ?
       ORDER BY created_at DESC`
    )
    .all(budgetSyncId) as DismissalRow[];
  return rows.map(rowToRecord);
}

export function createRuleDiagnosticsDismissal(
  db: SqliteDatabase,
  input: unknown
): RuleDiagnosticsDismissalRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppDbValidationError("Dismissal payload must be an object");
  }
  const body = input as Record<string, unknown>;

  const budgetSyncId =
    typeof body.budgetSyncId === "string" ? body.budgetSyncId.trim() : "";
  if (!budgetSyncId) {
    throw new AppDbValidationError("budgetSyncId is required");
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    throw new AppDbValidationError("code is required");
  }

  const ruleIds = normalizeList(body.ruleIds, "ruleIds");
  const signatures = normalizeList(body.signatures, "signatures");

  // Without one of these the record can never match anything again, so it would
  // sit in the table doing nothing — better to reject it than to store a row
  // that silently fails to silence what the user asked to silence.
  if (ruleIds.length === 0 && signatures.length === 0) {
    throw new AppDbValidationError(
      "A dismissal needs rule ids or rule signatures to match on"
    );
  }

  const discriminator =
    typeof body.discriminator === "string" && body.discriminator.trim()
      ? body.discriminator.trim().slice(0, DISCRIMINATOR_MAX)
      : null;

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, NOTE_MAX)
      : null;

  const record: DismissalRow = {
    id: generateId(),
    budget_sync_id: budgetSyncId,
    code,
    rule_ids: JSON.stringify(ruleIds),
    signatures: JSON.stringify(signatures),
    discriminator,
    note,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO rule_diagnostics_dismissals
       (id, budget_sync_id, code, rule_ids, signatures, discriminator, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.budget_sync_id,
    record.code,
    record.rule_ids,
    record.signatures,
    record.discriminator,
    record.note,
    record.created_at
  );

  return rowToRecord(record);
}

/**
 * Returns true when a row was removed, so the caller can 404 an unknown id.
 *
 * Scoped to the budget as well as the id, like every other read and write here:
 * an id alone would let one budget delete another budget's decision.
 */
export function deleteRuleDiagnosticsDismissal(
  db: SqliteDatabase,
  id: string,
  budgetSyncId: string
): boolean {
  const result = db
    .prepare(
      `DELETE FROM rule_diagnostics_dismissals WHERE id = ? AND budget_sync_id = ?`
    )
    .run(id, budgetSyncId);
  return result.changes > 0;
}

/**
 * Bulk delete for the garbage collector, which runs after a scan and drops the
 * records whose rules no longer exist by either identity.
 *
 * Budget-scoped for the same reason as the single delete, and chunked because
 * SQLite caps a statement's bound parameters.
 */
export function deleteRuleDiagnosticsDismissals(
  db: SqliteDatabase,
  ids: string[],
  budgetSyncId: string
): number {
  if (ids.length === 0) return 0;
  let removed = 0;
  const CHUNK = 200;
  const run = db.transaction(() => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(", ");
      const result = db
        .prepare(
          `DELETE FROM rule_diagnostics_dismissals
           WHERE budget_sync_id = ? AND id IN (${placeholders})`
        )
        .run(budgetSyncId, ...chunk);
      removed += result.changes;
    }
  });
  run();
  return removed;
}

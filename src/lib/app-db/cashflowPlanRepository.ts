import { generateId } from "@/lib/uuid";
import { PlanDocumentError, parsePlanDocument } from "@/lib/cashflow-planning/document";
import type { PlanDocument, PlanRecord, UnreadablePlan } from "@/lib/cashflow-planning/types";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

/**
 * Persistence for Cashflow Planning: one JSON document per plan, scoped to one budget because a plan refers to that budget's
 * accounts, categories and schedules by id. Every save is checked with the same reader the JSON import uses, and carries the
 * revision it was based on, so a plan open in two tabs cannot silently overwrite itself.
 */

type PlanRow = { budget_sync_id: string; id: string; name: string; revision: number; document: string; created_at: string; updated_at: string };

const ID_MAX = 100;
const MAX_PER_BUDGET = 30;
/** A full plan (500 rows over 50 years, every month typed) stays well under this. */
const DOCUMENT_MAX_BYTES = 8_000_000;

function fromRow(row: PlanRow): { record: PlanRecord } | { unreadable: UnreadablePlan } {
  try {
    return { record: { budgetSyncId: row.budget_sync_id, id: row.id, name: row.name, revision: row.revision, document: parsePlanDocument(JSON.parse(row.document)), createdAt: row.created_at, updatedAt: row.updated_at } };
  } catch (error) {
    return { unreadable: { id: row.id, name: row.name, why: error instanceof PlanDocumentError ? error.message : "The stored data is not a readable plan" } };
  }
}

/**
 * The budget's plans, oldest first. A row this build cannot read is not an error (a newer version may have written it): it is
 * left out of `plans` and listed in `unreadable`, since it still counts toward the plan limit and the user may want to delete it.
 */
export function listCashflowPlansWithUnreadable(db: SqliteDatabase, budgetSyncId: string): { plans: PlanRecord[]; unreadable: UnreadablePlan[] } {
  const rows = db.prepare("SELECT * FROM cashflow_plans WHERE budget_sync_id = ? ORDER BY created_at, id").all(budgetSyncId.trim()) as PlanRow[];
  const plans: PlanRecord[] = [];
  const unreadable: UnreadablePlan[] = [];
  for (const row of rows) {
    const read = fromRow(row);
    if ("record" in read) plans.push(read.record); else unreadable.push(read.unreadable);
  }
  return { plans, unreadable };
}

export function listCashflowPlans(db: SqliteDatabase, budgetSyncId: string): PlanRecord[] {
  return listCashflowPlansWithUnreadable(db, budgetSyncId).plans;
}

/**
 * Saves one plan and returns it with its new revision. Without an id it is a new plan. With one, `baseRevision` must be the
 * revision the caller last read: otherwise the plan was changed elsewhere in the meantime and the save is refused (a conflict),
 * unless `force` says to overwrite it. A save that carries a `baseRevision` for a plan that no longer exists was deleted
 * elsewhere: it is a conflict too, and only `force` brings the plan back.
 */
export function saveCashflowPlan(db: SqliteDatabase, input: unknown): PlanRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new AppDbValidationError("Plan payload must be an object");
  const body = input as Record<string, unknown>;
  const budgetSyncId = typeof body.budgetSyncId === "string" ? body.budgetSyncId.trim() : "";
  if (!budgetSyncId) throw new AppDbValidationError("budgetSyncId is required");
  let document: PlanDocument;
  try {
    document = parsePlanDocument(body.document);
  } catch (error) {
    throw new AppDbValidationError(error instanceof PlanDocumentError ? error.message : "The plan is not valid");
  }
  const json = JSON.stringify(document);
  if (json.length > DOCUMENT_MAX_BYTES) throw new AppDbValidationError("The plan is too large to save");
  const givenId = typeof body.id === "string" ? body.id.trim() : "";
  if (givenId.length > ID_MAX) throw new AppDbValidationError("The plan id is too long");
  const id = givenId || generateId();
  const now = new Date().toISOString();

  return db.transaction((): PlanRecord => {
    const existing = db.prepare("SELECT revision, created_at FROM cashflow_plans WHERE budget_sync_id = ? AND id = ?").get(budgetSyncId, id) as { revision: number; created_at: string } | undefined;
    if (!existing) {
      if (body.baseRevision !== undefined && body.force !== true) throw new AppDbConflictError("This plan was deleted somewhere else since it was opened here");
      const count = (db.prepare("SELECT COUNT(*) AS n FROM cashflow_plans WHERE budget_sync_id = ?").get(budgetSyncId) as { n: number }).n;
      if (count >= MAX_PER_BUDGET) throw new AppDbValidationError(`A budget can hold ${MAX_PER_BUDGET} plans; delete one first`);
      db.prepare("INSERT INTO cashflow_plans (budget_sync_id, id, name, revision, document, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)").run(budgetSyncId, id, document.name, json, now, now);
      return { budgetSyncId, id, name: document.name, revision: 1, document, createdAt: now, updatedAt: now };
    }
    if (body.force !== true && body.baseRevision !== existing.revision) throw new AppDbConflictError("This plan was changed somewhere else since it was opened here");
    const revision = existing.revision + 1;
    db.prepare("UPDATE cashflow_plans SET name = ?, revision = ?, document = ?, updated_at = ? WHERE budget_sync_id = ? AND id = ?").run(document.name, revision, json, now, budgetSyncId, id);
    return { budgetSyncId, id, name: document.name, revision, document, createdAt: existing.created_at, updatedAt: now };
  })();
}

export function deleteCashflowPlan(db: SqliteDatabase, budgetSyncId: string, id: string): void {
  if (!budgetSyncId.trim() || !id.trim()) throw new AppDbValidationError("budgetSyncId and id are required");
  db.prepare("DELETE FROM cashflow_plans WHERE budget_sync_id = ? AND id = ?").run(budgetSyncId.trim(), id.trim());
}

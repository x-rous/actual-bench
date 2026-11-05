import { generateId } from "@/lib/uuid";
import { parseAdjustments, parseScenarioResult } from "@/lib/financial-insights/bufferScenario";
import { AppDbValidationError } from "./errors";
import type { CashBufferScenarioRecord, SqliteDatabase } from "./types";

/**
 * Persistence for cash buffer scenarios: the user's own "what if" views of the cash buffer, scoped to one budget because the
 * category and account ids belong to one budget file. Holds the adjustments and the result they came to when saved; nothing else.
 */

type ScenarioRow = {
  budget_sync_id: string;
  id: string;
  name: string;
  adjustments: string;
  result: string | null;
  created_at: string;
  updated_at: string;
};

const NAME_MAX = 80;
const ID_MAX = 100;
const MAX_PER_BUDGET = 50;

function fromRow(row: ScenarioRow): CashBufferScenarioRecord | null {
  let adjustments;
  try { adjustments = parseAdjustments(JSON.parse(row.adjustments)); } catch { adjustments = null; }
  if (!adjustments) return null;
  let result = null;
  try { result = row.result ? parseScenarioResult(JSON.parse(row.result)) : null; } catch { result = null; }
  return { budgetSyncId: row.budget_sync_id, id: row.id, name: row.name, adjustments, result, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** The budget's scenarios, oldest first. A row this build cannot read is skipped, not an error: a newer version may have written it. */
export function listCashBufferScenarios(db: SqliteDatabase, budgetSyncId: string): CashBufferScenarioRecord[] {
  const rows = db.prepare("SELECT * FROM cash_buffer_scenarios WHERE budget_sync_id = ? ORDER BY created_at, id").all(budgetSyncId) as ScenarioRow[];
  return rows.flatMap((row) => { const record = fromRow(row); return record ? [record] : []; });
}

function parseBudget(body: Record<string, unknown>): string {
  const budgetSyncId = typeof body.budgetSyncId === "string" ? body.budgetSyncId.trim() : "";
  if (!budgetSyncId) throw new AppDbValidationError("budgetSyncId is required");
  return budgetSyncId;
}

/** Saves one scenario (a new one when it has no id) and returns the budget's full list. */
export function saveCashBufferScenario(db: SqliteDatabase, input: unknown): CashBufferScenarioRecord[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new AppDbValidationError("Scenario payload must be an object");
  const body = input as Record<string, unknown>;
  const budgetSyncId = parseBudget(body);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > NAME_MAX) throw new AppDbValidationError(`A scenario needs a name of 1 to ${NAME_MAX} characters`);
  const adjustments = parseAdjustments(body.adjustments);
  if (!adjustments) throw new AppDbValidationError("The scenario's adjustments are not valid");
  let result = null;
  if (body.result !== undefined && body.result !== null) {
    result = parseScenarioResult(body.result);
    if (!result) throw new AppDbValidationError("The scenario's result is not valid");
  }
  const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : generateId();
  if (id.length > ID_MAX) throw new AppDbValidationError("The scenario id is too long");
  const now = new Date().toISOString();

  db.transaction(() => {
    const exists = db.prepare("SELECT 1 FROM cash_buffer_scenarios WHERE budget_sync_id = ? AND id = ?").get(budgetSyncId, id);
    if (!exists) {
      const count = (db.prepare("SELECT COUNT(*) AS n FROM cash_buffer_scenarios WHERE budget_sync_id = ?").get(budgetSyncId) as { n: number }).n;
      if (count >= MAX_PER_BUDGET) throw new AppDbValidationError(`A budget can hold ${MAX_PER_BUDGET} scenarios; delete one first`);
    }
    db.prepare(
      `INSERT INTO cash_buffer_scenarios (budget_sync_id, id, name, adjustments, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(budget_sync_id, id) DO UPDATE SET
         name = excluded.name,
         adjustments = excluded.adjustments,
         result = excluded.result,
         updated_at = excluded.updated_at`
    ).run(budgetSyncId, id, name, JSON.stringify(adjustments), result ? JSON.stringify(result) : null, now, now);
  })();

  return listCashBufferScenarios(db, budgetSyncId);
}

/** Removes one scenario and returns the budget's full list. */
export function deleteCashBufferScenario(db: SqliteDatabase, budgetSyncId: string, id: string): CashBufferScenarioRecord[] {
  if (!budgetSyncId.trim() || !id.trim()) throw new AppDbValidationError("budgetSyncId and id are required");
  db.prepare("DELETE FROM cash_buffer_scenarios WHERE budget_sync_id = ? AND id = ?").run(budgetSyncId.trim(), id.trim());
  return listCashBufferScenarios(db, budgetSyncId.trim());
}

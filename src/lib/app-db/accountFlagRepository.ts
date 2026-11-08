import { GROUP_FLAGS, isAccountFlag, type AccountFlag, type AccountFlagChange } from "@/lib/account-class/flags";
import { AppDbValidationError } from "./errors";
import type { AccountFlagRecord, SqliteDatabase } from "./types";

/**
 * Persistence for account flags: yes/no choices the user makes about their own accounts and account groups (leave out of
 * Financial Insights, accessible money, income in an off-budget account). Stores Actual ids and a flag name, nothing else,
 * and is scoped to one budget because ids belong to one budget file. A row means the flag is on; turning it off deletes the row.
 */

type AccountFlagRow = {
  budget_sync_id: string;
  scope: string;
  target_id: string;
  flag: string;
  updated_at: string;
};

const MAX_CHANGES = 500;
const ID_MAX = 200;

/** Rows with a flag or scope this build does not know are skipped, not an error: a newer version may have written them. */
export function listAccountFlags(db: SqliteDatabase, budgetSyncId: string): AccountFlagRecord[] {
  const rows = db
    .prepare("SELECT * FROM account_flags WHERE budget_sync_id = ? ORDER BY scope, target_id, flag")
    .all(budgetSyncId) as AccountFlagRow[];
  const records: AccountFlagRecord[] = [];
  for (const row of rows) {
    if ((row.scope !== "account" && row.scope !== "group") || !isAccountFlag(row.flag)) continue;
    records.push({ budgetSyncId: row.budget_sync_id, scope: row.scope, targetId: row.target_id, flag: row.flag, updatedAt: row.updated_at });
  }
  return records;
}

function parseChanges(input: unknown): { budgetSyncId: string; changes: AccountFlagChange[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppDbValidationError("Account flag payload must be an object");
  }
  const body = input as Record<string, unknown>;
  const budgetSyncId = typeof body.budgetSyncId === "string" ? body.budgetSyncId.trim() : "";
  if (!budgetSyncId) throw new AppDbValidationError("budgetSyncId is required");
  if (!Array.isArray(body.changes) || body.changes.length === 0) {
    throw new AppDbValidationError("changes must be a non-empty array");
  }
  if (body.changes.length > MAX_CHANGES) {
    throw new AppDbValidationError(`changes must hold ${MAX_CHANGES} entries or fewer`);
  }

  const seen = new Set<string>();
  const changes = body.changes.map((raw: unknown): AccountFlagChange => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new AppDbValidationError("Each change must be an object");
    }
    const change = raw as Record<string, unknown>;
    if (change.scope !== "account" && change.scope !== "group") {
      throw new AppDbValidationError('scope must be "account" or "group"');
    }
    const id = typeof change.id === "string" ? change.id.trim() : "";
    if (!id || id.length > ID_MAX) throw new AppDbValidationError("Each change needs an id");
    if (!isAccountFlag(change.flag)) throw new AppDbValidationError(`Unknown account flag "${String(change.flag)}"`);
    if (change.scope === "group" && !(GROUP_FLAGS as readonly AccountFlag[]).includes(change.flag)) {
      throw new AppDbValidationError(`The flag "${change.flag}" can only be set on an account`);
    }
    if (typeof change.on !== "boolean") throw new AppDbValidationError("Each change needs on: true or false");
    const key = `${change.scope}:${id}:${change.flag}`;
    if (seen.has(key)) throw new AppDbValidationError(`Duplicate change for ${key}`);
    seen.add(key);
    return { scope: change.scope, id, flag: change.flag, on: change.on };
  });
  return { budgetSyncId, changes };
}

/** Applies every change in one transaction: all or nothing. Returns the budget's full list. */
export function applyAccountFlagChanges(db: SqliteDatabase, input: unknown): AccountFlagRecord[] {
  const { budgetSyncId, changes } = parseChanges(input);
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO account_flags (budget_sync_id, scope, target_id, flag, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(budget_sync_id, scope, target_id, flag) DO UPDATE SET updated_at = excluded.updated_at`
  );
  const remove = db.prepare("DELETE FROM account_flags WHERE budget_sync_id = ? AND scope = ? AND target_id = ? AND flag = ?");

  db.transaction(() => {
    for (const change of changes) {
      if (change.on) upsert.run(budgetSyncId, change.scope, change.id, change.flag, now);
      else remove.run(budgetSyncId, change.scope, change.id, change.flag);
    }
  })();

  return listAccountFlags(db, budgetSyncId);
}

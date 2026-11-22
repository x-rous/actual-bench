import { isAccountClass, type AccountClass, type AccountClassChange } from "@/lib/account-class";
import { AppDbValidationError } from "./errors";
import type { AccountClassRecord, SqliteDatabase } from "./types";

/**
 * Persistence for account classes: the user's own labels for their own
 * accounts and account groups. Stores Actual ids and a class, nothing else, and
 * is scoped to one budget because ids belong to one budget file.
 */

type AccountClassRow = {
  budget_sync_id: string;
  scope: string;
  account_id: string;
  account_class: string;
  updated_at: string;
};

const MAX_CHANGES = 500;
const ID_MAX = 200;

/** Rows with a class this build does not know are skipped, not an error: a newer version may have written them. Kept pre-schema-68
 * choices follow as "refinement" records. */
export function listAccountClasses(db: SqliteDatabase, budgetSyncId: string): AccountClassRecord[] {
  const rows = db
    .prepare("SELECT * FROM account_classes WHERE budget_sync_id = ? ORDER BY scope, account_id")
    .all(budgetSyncId) as AccountClassRow[];
  const records: AccountClassRecord[] = [];
  for (const row of rows) {
    if ((row.scope !== "account" && row.scope !== "group") || !isAccountClass(row.account_class)) continue;
    records.push({
      budgetSyncId: row.budget_sync_id,
      scope: row.scope,
      accountId: row.account_id,
      accountClass: row.account_class as AccountClass,
      updatedAt: row.updated_at,
    });
  }
  // The Financial Reporting choices saved before schema 68, as the narrower classes they stood for. Migration v68 turned most into
  // the account's own class, but it cannot see group membership, so an account with a different own class inside a group keeps its
  // choice only through these. Unknown treatments are skipped.
  if (tableExists(db, "account_reporting")) {
    const legacy = db.prepare("SELECT account_id, treatment, updated_at FROM account_reporting WHERE budget_sync_id = ? ORDER BY account_id").all(budgetSyncId) as { account_id: string; treatment: string; updated_at: string }[];
    for (const row of legacy) {
      const accountClass = LEGACY_REFINEMENT[row.treatment];
      if (accountClass) records.push({ budgetSyncId, scope: "refinement", accountId: row.account_id, accountClass, updatedAt: row.updated_at });
    }
  }
  return records;
}

const LEGACY_REFINEMENT: Partial<Record<string, AccountClass>> = { "fixed-deposit": "fixed-deposit", "fixed-asset": "fixed-asset" };

function tableExists(db: SqliteDatabase, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function parseChanges(input: unknown): { budgetSyncId: string; changes: AccountClassChange[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppDbValidationError("Account class payload must be an object");
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
  const changes = body.changes.map((raw: unknown): AccountClassChange => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new AppDbValidationError("Each change must be an object");
    }
    const change = raw as Record<string, unknown>;
    if (change.scope !== "account" && change.scope !== "group") {
      throw new AppDbValidationError('scope must be "account" or "group"');
    }
    const id = typeof change.id === "string" ? change.id.trim() : "";
    if (!id || id.length > ID_MAX) throw new AppDbValidationError("Each change needs an id");
    if (change.accountClass !== null && !isAccountClass(change.accountClass)) {
      throw new AppDbValidationError(`Unknown account class "${String(change.accountClass)}"`);
    }
    const key = `${change.scope}:${id}`;
    if (seen.has(key)) throw new AppDbValidationError(`Duplicate change for ${key}`);
    seen.add(key);
    return { scope: change.scope, id, accountClass: change.accountClass };
  });
  return { budgetSyncId, changes };
}

/** Applies every change in one transaction: all or nothing. Returns the budget's full list. */
export function applyAccountClassChanges(db: SqliteDatabase, input: unknown): AccountClassRecord[] {
  const { budgetSyncId, changes } = parseChanges(input);
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO account_classes (budget_sync_id, scope, account_id, account_class, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(budget_sync_id, scope, account_id) DO UPDATE SET
       account_class = excluded.account_class,
       updated_at = excluded.updated_at`
  );
  const remove = db.prepare("DELETE FROM account_classes WHERE budget_sync_id = ? AND scope = ? AND account_id = ?");

  // Choosing an account's own class replaces any narrower class kept from before schema 68, so it cannot outlive the user's choice.
  const forgetLegacy = tableExists(db, "account_reporting") ? db.prepare("DELETE FROM account_reporting WHERE budget_sync_id = ? AND account_id = ?") : null;
  db.transaction(() => {
    for (const change of changes) {
      if (change.accountClass) upsert.run(budgetSyncId, change.scope, change.id, change.accountClass, now);
      else remove.run(budgetSyncId, change.scope, change.id);
      if (change.scope === "account") forgetLegacy?.run(budgetSyncId, change.id);
    }
  })();

  return listAccountClasses(db, budgetSyncId);
}

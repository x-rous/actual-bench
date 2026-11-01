import { isReportingTreatment, type ReportingTreatment } from "@/lib/account-class/reporting";
import { AppDbValidationError } from "./errors";
import type { AccountReportingRecord, SqliteDatabase } from "./types";

/**
 * Persistence for Financial Reporting choices: the user's own label for how an
 * account counts in Financial Insights. Stores an Actual account id and a
 * treatment, nothing else, scoped to one budget because ids belong to one budget file.
 */

type AccountReportingRow = {
  budget_sync_id: string;
  account_id: string;
  treatment: string;
  updated_at: string;
};

export type AccountReportingChange = { accountId: string; treatment: ReportingTreatment | null };

const MAX_CHANGES = 500;
const ID_MAX = 200;

/** Rows with a treatment this build does not know are skipped, not an error: a newer version may have written them. */
export function listAccountReporting(db: SqliteDatabase, budgetSyncId: string): AccountReportingRecord[] {
  const rows = db
    .prepare("SELECT * FROM account_reporting WHERE budget_sync_id = ? ORDER BY account_id")
    .all(budgetSyncId) as AccountReportingRow[];
  return rows.flatMap((row) =>
    isReportingTreatment(row.treatment)
      ? [{ budgetSyncId: row.budget_sync_id, accountId: row.account_id, treatment: row.treatment, updatedAt: row.updated_at }]
      : []
  );
}

function parseChanges(input: unknown): { budgetSyncId: string; changes: AccountReportingChange[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppDbValidationError("Account reporting payload must be an object");
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
  const changes = body.changes.map((raw: unknown): AccountReportingChange => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new AppDbValidationError("Each change must be an object");
    }
    const change = raw as Record<string, unknown>;
    const accountId = typeof change.accountId === "string" ? change.accountId.trim() : "";
    if (!accountId || accountId.length > ID_MAX) throw new AppDbValidationError("Each change needs an accountId");
    if (change.treatment !== null && !isReportingTreatment(change.treatment)) {
      throw new AppDbValidationError(`Unknown reporting treatment "${String(change.treatment)}"`);
    }
    if (seen.has(accountId)) throw new AppDbValidationError(`Duplicate change for ${accountId}`);
    seen.add(accountId);
    return { accountId, treatment: change.treatment };
  });
  return { budgetSyncId, changes };
}

/** Applies every change in one transaction: all or nothing. `treatment: null` removes the choice. Returns the budget's full list. */
export function applyAccountReportingChanges(db: SqliteDatabase, input: unknown): AccountReportingRecord[] {
  const { budgetSyncId, changes } = parseChanges(input);
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO account_reporting (budget_sync_id, account_id, treatment, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(budget_sync_id, account_id) DO UPDATE SET
       treatment = excluded.treatment,
       updated_at = excluded.updated_at`
  );
  const remove = db.prepare("DELETE FROM account_reporting WHERE budget_sync_id = ? AND account_id = ?");

  db.transaction(() => {
    for (const change of changes) {
      if (change.treatment) upsert.run(budgetSyncId, change.accountId, change.treatment, now);
      else remove.run(budgetSyncId, change.accountId);
    }
  })();

  return listAccountReporting(db, budgetSyncId);
}

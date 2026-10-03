import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import { optionalText, requireOneOf, requireText, rethrowConstraint } from "./debtValues";
import {
  DEBT_TRANSACTION_LINK_ROLES,
  DEBT_TRANSACTION_LINK_SOURCES,
  readStoredEnum,
  type DebtTransactionLinkRecord,
  type DebtTransactionLinkRole,
  type DebtTransactionLinkSource,
  type SqliteDatabase,
} from "./types";

type LinkRow = {
  id: string;
  debt_id: string;
  budget_sync_id: string;
  actual_transaction_id: string;
  actual_parent_id: string | null;
  role: string;
  period_key: string;
  link_source: string;
  linked_at: string;
};

export type DebtTransactionLinkInput = {
  id?: string;
  debtId: string;
  budgetSyncId: string;
  actualTransactionId: string;
  actualParentId?: string | null;
  role: DebtTransactionLinkRole;
  periodKey: string;
  linkSource: DebtTransactionLinkSource;
  /** Read-shape fact used to refuse claims on split parents; it is not persisted. */
  isSplitParent?: boolean;
};

const rowToRecord = (row: LinkRow): DebtTransactionLinkRecord => ({
  id: row.id,
  debtId: row.debt_id,
  budgetSyncId: row.budget_sync_id,
  actualTransactionId: row.actual_transaction_id,
  actualParentId: row.actual_parent_id,
  role: readStoredEnum(DEBT_TRANSACTION_LINK_ROLES, row.role),
  periodKey: row.period_key,
  linkSource: readStoredEnum(DEBT_TRANSACTION_LINK_SOURCES, row.link_source),
  linkedAt: row.linked_at,
});

export function getDebtTransactionLink(db: SqliteDatabase, id: string): DebtTransactionLinkRecord | null {
  const row = db.prepare("SELECT * FROM debt_transaction_links WHERE id = ?").get<LinkRow>(id);
  return row ? rowToRecord(row) : null;
}

export function listDebtTransactionLinks(db: SqliteDatabase, debtId: string): DebtTransactionLinkRecord[] {
  return db
    .prepare("SELECT * FROM debt_transaction_links WHERE debt_id = ? ORDER BY period_key, linked_at, id")
    .all<LinkRow>(debtId)
    .map(rowToRecord);
}

export function insertDebtTransactionLink(
  db: SqliteDatabase,
  input: DebtTransactionLinkInput,
  now = new Date().toISOString()
): DebtTransactionLinkRecord {
  const role = requireOneOf(DEBT_TRANSACTION_LINK_ROLES, input.role, "role");
  if (input.isSplitParent && role !== "evidence-only") {
    throw new AppDbValidationError("A split parent cannot be claimed; link its specific child instead.");
  }
  const id = input.id ?? generateId();
  try {
    db.prepare(
      `INSERT INTO debt_transaction_links
       (id, debt_id, budget_sync_id, actual_transaction_id, actual_parent_id, role,
        period_key, link_source, linked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      requireText(input.debtId, "debtId"),
      requireText(input.budgetSyncId, "budgetSyncId"),
      requireText(input.actualTransactionId, "actualTransactionId"),
      optionalText(input.actualParentId, "actualParentId"),
      role,
      requireText(input.periodKey, "periodKey"),
      requireOneOf(DEBT_TRANSACTION_LINK_SOURCES, input.linkSource, "linkSource"),
      now
    );
  } catch (error) {
    rethrowConstraint(error, {
      idx_debt_transaction_links_claim: "That Actual transaction is already claimed in this role in this budget.",
      "debt_transaction_links.budget_sync_id, debt_transaction_links.actual_transaction_id, debt_transaction_links.role":
        "That Actual transaction is already claimed in this role in this budget.",
      FOREIGN: "The debt does not exist in that Actual budget.",
    });
  }
  const created = getDebtTransactionLink(db, id);
  if (!created) throw new AppDbValidationError("Transaction link was not created");
  return created;
}

export function deleteDebtTransactionLink(db: SqliteDatabase, id: string): boolean {
  return db.prepare("DELETE FROM debt_transaction_links WHERE id = ?").run(id).changes > 0;
}

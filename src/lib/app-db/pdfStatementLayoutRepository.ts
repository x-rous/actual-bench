/**
 * Saved statement layouts: how to read a bank's statements.
 *
 * A layout stores declarative settings only - column roles as fractions of the
 * page, how to read dates and numbers, and the masked shape of the table's
 * header. Uploaded PDFs, extracted statement text, account names, and
 * credentials never enter these tables.
 */

import { generateId } from "@/lib/uuid";
import { sanitizePdfLayoutProfileEnvelope } from "@/lib/reconciliation/statement/pdf/profiles";
import { AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

export type PdfStatementLayoutRecord = {
  id: string;
  /** A label that groups layouts in a list, not an entity of its own. */
  bankName: string;
  name: string;
  layout: unknown;
  createdAt: string;
  updatedAt: string;
};

export type PdfStatementLayoutCatalog = {
  layouts: PdfStatementLayoutRecord[];
  /** The layout this account reads its statements with, when it has one. */
  accountLayoutId: string | null;
};

type LayoutRow = {
  id: string;
  bank_name: string;
  name: string;
  layout_json: string;
  created_at: string;
  updated_at: string;
};

function requiredText(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError(`Statement layout ${field} is required`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new AppDbValidationError(`Statement layout ${field} must be ${max} characters or fewer`);
  }
  return text;
}

function layoutRecord(row: LayoutRow): PdfStatementLayoutRecord {
  let layout: unknown = null;
  try {
    layout = JSON.parse(row.layout_json);
  } catch {
    // A corrupt layout is returned as null so callers can skip it without
    // making the whole catalog unavailable.
  }
  return {
    id: row.id,
    bankName: row.bank_name,
    name: row.name,
    layout,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPdfStatementLayouts(
  db: SqliteDatabase,
  budgetSyncId?: string,
  accountId?: string
): PdfStatementLayoutCatalog {
  const layouts = db
    .prepare("SELECT * FROM pdf_statement_layouts ORDER BY bank_name COLLATE NOCASE, name COLLATE NOCASE")
    .all<LayoutRow>()
    .map(layoutRecord);
  const assignment = budgetSyncId && accountId
    ? db.prepare(
        `SELECT layout_id
           FROM pdf_statement_layout_accounts
          WHERE budget_sync_id = ? AND account_id = ?`
      ).get<{ layout_id: string }>(budgetSyncId, accountId)
    : undefined;
  return { layouts, accountLayoutId: assignment?.layout_id ?? null };
}

/**
 * Save a statement layout.
 *
 * Layouts are not versioned: `create` refuses to write over a name that is
 * already taken, and `update` replaces that layout in place. Keeping the old
 * settings is done by saving under a different name.
 */
export function savePdfStatementLayout(
  db: SqliteDatabase,
  input: {
    budgetSyncId: string;
    accountId: string;
    bankName: string;
    layoutName: string;
    layout: unknown;
    mode?: "create" | "update";
    assignToAccount?: boolean;
  }
): PdfStatementLayoutRecord {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  const accountId = requiredText(input.accountId, "account");
  const bankName = requiredText(input.bankName, "bank name");
  const layoutName = requiredText(input.layoutName, "name");
  const safeLayout = sanitizePdfLayoutProfileEnvelope(input.layout);
  if (!safeLayout) throw new AppDbValidationError("Statement layout data is invalid");
  if (safeLayout.profile.name.localeCompare(layoutName, undefined, { sensitivity: "accent" }) !== 0) {
    throw new AppDbValidationError("Statement layout name does not match its saved name");
  }
  const layoutJson = JSON.stringify(safeLayout);
  const timestamp = new Date().toISOString();

  return db.transaction(() => {
    let row = db.prepare(
      "SELECT * FROM pdf_statement_layouts WHERE bank_name = ? COLLATE NOCASE AND name = ? COLLATE NOCASE"
    ).get<LayoutRow>(bankName, layoutName);
    if (row && input.mode !== "update") {
      throw new AppDbValidationError(
        `${bankName} already has a layout named "${layoutName}". Choose another name or update the existing layout.`
      );
    }
    if (!row && input.mode === "update") {
      throw new AppDbValidationError("The statement layout to update was not found");
    }

    if (row) {
      db.prepare(
        "UPDATE pdf_statement_layouts SET layout_json = ?, updated_at = ? WHERE id = ?"
      ).run(layoutJson, timestamp, row.id);
      row = { ...row, layout_json: layoutJson, updated_at: timestamp };
    } else {
      row = {
        id: generateId(),
        bank_name: bankName,
        name: layoutName,
        layout_json: layoutJson,
        created_at: timestamp,
        updated_at: timestamp,
      };
      db.prepare(
        `INSERT INTO pdf_statement_layouts
           (id, bank_name, name, layout_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.bank_name, row.name, row.layout_json, timestamp, timestamp);
    }

    if (input.assignToAccount) {
      upsertAssignment(db, { budgetSyncId, accountId, layoutId: row.id, timestamp });
    }
    return layoutRecord(row);
  })();
}

export function assignPdfStatementLayout(
  db: SqliteDatabase,
  input: { budgetSyncId: string; accountId: string; layoutId: string }
): void {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  const accountId = requiredText(input.accountId, "account");
  const layoutId = requiredText(input.layoutId, "layout");
  const layout = db.prepare("SELECT id FROM pdf_statement_layouts WHERE id = ?").get<{ id: string }>(layoutId);
  if (!layout) throw new AppDbValidationError("Statement layout was not found");
  upsertAssignment(db, { budgetSyncId, accountId, layoutId, timestamp: new Date().toISOString() });
}

export function removePdfStatementLayoutAssignment(
  db: SqliteDatabase,
  input: { budgetSyncId: string; accountId: string }
): void {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  const accountId = requiredText(input.accountId, "account");
  db.prepare(
    "DELETE FROM pdf_statement_layout_accounts WHERE budget_sync_id = ? AND account_id = ?"
  ).run(budgetSyncId, accountId);
}

/**
 * Rename a bank everywhere it is used.
 *
 * The label lives on each layout, so renaming is an update across them rather
 * than a row of its own to keep in step. Merging into a name that already
 * exists is refused when it would collide with a layout of the same name,
 * because that is a merge rather than a rename.
 */
export function renamePdfStatementLayoutBank(
  db: SqliteDatabase,
  input: { from: string; to: string }
): number {
  const from = requiredText(input.from, "bank name");
  const to = requiredText(input.to, "bank name");
  return db.transaction(() => {
    const clash = db.prepare(
      `SELECT existing.id
         FROM pdf_statement_layouts existing
         JOIN pdf_statement_layouts moving
           ON moving.name = existing.name COLLATE NOCASE
        WHERE existing.bank_name = ? COLLATE NOCASE
          AND moving.bank_name = ? COLLATE NOCASE`
    ).get<{ id: string }>(to, from);
    if (clash) {
      throw new AppDbValidationError(`${to} already has a layout with that name. Rename the layout first.`);
    }
    const result = db.prepare(
      "UPDATE pdf_statement_layouts SET bank_name = ?, updated_at = ? WHERE bank_name = ? COLLATE NOCASE"
    ).run(to, new Date().toISOString(), from);
    return result.changes ?? 0;
  })();
}

export function renamePdfStatementLayout(
  db: SqliteDatabase,
  input: { layoutId: string; name: string }
): PdfStatementLayoutRecord {
  const layoutId = requiredText(input.layoutId, "layout");
  const name = requiredText(input.name, "name");
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM pdf_statement_layouts WHERE id = ?").get<LayoutRow>(layoutId);
    if (!row) throw new AppDbValidationError("Statement layout was not found");
    const taken = db.prepare(
      `SELECT id FROM pdf_statement_layouts
        WHERE bank_name = ? COLLATE NOCASE AND name = ? COLLATE NOCASE AND id <> ?`
    ).get<{ id: string }>(row.bank_name, name, layoutId);
    if (taken) {
      throw new AppDbValidationError(`${row.bank_name} already has a layout named "${name}".`);
    }
    const timestamp = new Date().toISOString();
    db.prepare("UPDATE pdf_statement_layouts SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, timestamp, layoutId);
    // The name is stored inside the layout as well, and the two disagreeing is
    // how a layout ends up unsavable later.
    const layout = JSON.parse(row.layout_json) as { kind: string; profile: { name: string } };
    layout.profile.name = name;
    db.prepare("UPDATE pdf_statement_layouts SET layout_json = ? WHERE id = ?")
      .run(JSON.stringify(layout), layoutId);
    return layoutRecord({ ...row, name, layout_json: JSON.stringify(layout), updated_at: timestamp });
  })();
}

export function deletePdfStatementLayout(db: SqliteDatabase, layoutIdValue: string): boolean {
  const layoutId = requiredText(layoutIdValue, "layout");
  // Assignments go with it through the foreign key, so an account never points
  // at a layout that is no longer there.
  const result = db.prepare("DELETE FROM pdf_statement_layouts WHERE id = ?").run(layoutId);
  return (result.changes ?? 0) > 0;
}

function upsertAssignment(
  db: SqliteDatabase,
  input: { budgetSyncId: string; accountId: string; layoutId: string; timestamp: string }
): void {
  db.prepare(
    `INSERT INTO pdf_statement_layout_accounts (budget_sync_id, account_id, layout_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(budget_sync_id, account_id)
     DO UPDATE SET layout_id = excluded.layout_id, updated_at = excluded.updated_at`
  ).run(input.budgetSyncId, input.accountId, input.layoutId, input.timestamp);
}

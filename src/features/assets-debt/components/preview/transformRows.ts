import type { PostingOutputSnapshot } from "@/lib/assets-debt/services/snapshot";
import { renderPreviewRows, type PreviewDirectory, type PreviewRow } from "./renderPreviewRows";

/**
 * One table of what a change does to Actual (RD-084 P1.6b, `ux-loan-workspace.md` §3.6 rev 2):
 * each row is a transaction as Actual holds it now, then what it becomes. Rows the change adds
 * follow their parent (split parts) or come last; rows it deletes say so; a row Actual replaces
 * with a new one in the same account (a transfer's loan-side row) is shown as one replaced row.
 *
 * Built from the same `renderPreviewRows` output as the parity contract (SC-019), so the table
 * shows exactly the rows Bench verifies after apply. Payee, category and notes are columns, each
 * shown as "now → after" where it changes; date and cleared status appear only where they change.
 * Pure.
 */

export type TransformTag = "No change" | "Becomes a split" | "Back to one row" | "Linked" | "Unlinked" | "Amount changes" | "Payee changes" | "Category changes" | "New" | "New part" | "Re-created" | "Removed" | "Replaced";

export type TransformRow = {
  key: string;
  /** Empty for a split part, which sits under its parent. */
  accountName: string;
  /** Each "now → after" when it changes, otherwise the value as it stays. */
  payee: string;
  category: string;
  notes: string;
  nowMinor: number | null;
  afterMinor: number | null;
  tag: TransformTag;
  sub: boolean;
  /** Date or cleared status changes, in words. */
  changes: string[];
};

export type TransformTable = { rows: TransformRow[]; anyFieldChanges: boolean; technical: string | null; rowIds: string[] };

type Cells = Pick<TransformRow, "payee" | "category" | "notes">;
const cellsOf = (row: PreviewRow): Cells => ({ payee: row.payeeName || "", category: row.categoryName ?? "", notes: row.notes ?? "" });
const change = (before: string, after: string) => (before === after ? before : `${before || "-"} → ${after || "-"}`);
const pairCells = (before: PreviewRow, after: PreviewRow): Cells => {
  const b = cellsOf(before);
  const a = cellsOf(after);
  return { payee: change(b.payee, a.payee), category: change(b.category, a.category), notes: change(b.notes, a.notes) };
};

function fieldChanges(before: PreviewRow, after: PreviewRow): string[] {
  const out: string[] = [];
  if (before.date !== after.date) out.push(`Date ${before.date} → ${after.date}`);
  if (before.cleared !== after.cleared) out.push(`${before.cleared === "cleared" ? "Cleared" : "Not cleared"} → ${after.cleared === "cleared" ? "cleared" : "not cleared"}`);
  return out;
}

function pairTag(before: PreviewRow, after: PreviewRow): TransformTag {
  if (after.splitParent && !before.splitParent) return "Becomes a split";
  if (before.splitParent && !after.splitParent) return "Back to one row";
  if (after.linkedChip && !before.linkedChip) return "Linked";
  if (before.linkedChip && !after.linkedChip) return "Unlinked";
  if (before.amountMinor !== after.amountMinor) return "Amount changes";
  if (before.payeeName !== after.payeeName) return "Payee changes";
  if (before.categoryName !== after.categoryName) return "Category changes";
  return "No change";
}

function technicalNote(output: PostingOutputSnapshot): string | null {
  switch (output.kind) {
    case "restructure":
      return output.replacesCounterpart
        ? "Actual deletes the loan-side row it made for the transfer and makes a new one for the principal only (new transaction id). Undo re-creates the original row, also with a new id."
        : "The payment becomes a split; Actual makes the loan-side row for the principal part.";
    case "restore-split":
      return output.recreatedCounterpart ? "The split parts are deleted one at a time; Actual re-creates the transfer's loan-side row with a new transaction id." : "The split parts are deleted one at a time and the payment is restored.";
    case "convert": return "The payment takes the loan's transfer payee; Actual creates the loan-side row.";
    case "revert-convert": return "The payment gets its own payee back; Actual deletes the loan-side row it made.";
    case "link": return "The lender's row becomes the other side of the transfer; its imported id is kept.";
    case "unlink": return "The lender's row is detached first, then the payment is restored.";
    case "claim": return "Nothing is written to Actual; Bench records the link in its own database.";
    case "create": return "Bench creates the rows with its own marker, so an interrupted write can be found again.";
    default: return null;
  }
}

export function buildTransformTable(output: PostingOutputSnapshot, directory: PreviewDirectory, digits: number): TransformTable {
  const before = renderPreviewRows(output, directory, digits, "before");
  const after = renderPreviewRows(output, directory, digits, "after");
  const afterByKey = new Map(after.map((row) => [row.key, row]));
  const used = new Set<string>();
  const rows: TransformRow[] = [];
  const removed: { index: number; row: PreviewRow }[] = [];

  const pushNewChildren = (parentKey: string) => {
    for (const child of after) {
      if (used.has(child.key) || child.splitChildOf !== parentKey || before.some((b) => b.key === child.key)) continue;
      used.add(child.key);
      rows.push({ key: child.key, accountName: "", ...cellsOf(child), nowMinor: null, afterMinor: child.amountMinor, tag: "New part", sub: true, changes: [] });
    }
  };

  for (const b of before) {
    const a = afterByKey.get(b.key);
    if (a) {
      used.add(a.key);
      rows.push({ key: b.key, accountName: b.splitChildOf ? "" : b.accountName, ...pairCells(b, a), nowMinor: b.amountMinor, afterMinor: a.amountMinor, tag: pairTag(b, a), sub: !!b.splitChildOf, changes: fieldChanges(b, a) });
      pushNewChildren(a.key);
    } else {
      removed.push({ index: rows.length, row: b });
      rows.push({ key: b.key, accountName: b.splitChildOf ? "" : b.accountName, ...cellsOf(b), nowMinor: b.amountMinor, afterMinor: null, tag: "Removed", sub: !!b.splitChildOf, changes: [] });
    }
  }

  for (const a of after) {
    if (used.has(a.key)) continue;
    used.add(a.key);
    // A deleted top-level row in the same account that this new row takes the place of.
    const replaced = !a.splitChildOf ? removed.find((r) => !r.row.splitChildOf && r.row.accountId === a.accountId && rows[r.index].tag === "Removed") : undefined;
    if (replaced) {
      const b = replaced.row;
      rows[replaced.index] = { ...rows[replaced.index], ...pairCells(b, a), afterMinor: a.amountMinor, tag: "Replaced", changes: fieldChanges(b, a) };
      continue;
    }
    rows.push({ key: a.key, accountName: a.splitChildOf ? "" : a.accountName, ...cellsOf(a), nowMinor: null, afterMinor: a.amountMinor, tag: a.key.endsWith("recreated-counterpart") ? "Re-created" : a.splitChildOf ? "New part" : "New", sub: !!a.splitChildOf, changes: [] });
  }

  return {
    rows,
    anyFieldChanges: rows.some((r) => r.changes.length > 0),
    technical: technicalNote(output),
    rowIds: before.filter((b) => b.rowKind !== "create").map((b) => b.key),
  };
}

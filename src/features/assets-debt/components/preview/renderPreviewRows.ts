import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { PostingOutputSnapshot, RowSnapshot } from "@/lib/assets-debt/services/snapshot";

/**
 * The rows Bench will write, as Actual's register will show them (RD-084 P1.6
 * T137; SC-019). Pure: no React, no Actual access.
 *
 * `renderPreviewRows` turns a posting's output snapshot into register rows,
 * applying Actual's own rules (R-17, verified live): an off-budget row keeps no
 * category; a transfer between two on-budget accounts keeps none either; a
 * linked counterpart takes the other account's transfer payee and mirrors the
 * amount. `actualRowsToPreviewRows` normalizes rows read back from Actual into
 * the same shape, so the preview-parity test can assert that what was shown
 * is exactly what Actual holds after apply.
 *
 * Amounts stay exact integer minor units; formatting happens only in the
 * component that displays them.
 */

export type PreviewRow = {
  rowKind: "create" | "existing" | "linked";
  /** Actual's id for an existing row; a stable synthetic key for a row still to be created. */
  key: string;
  accountId: string;
  accountName: string;
  accountBudgetStatus: "on-budget" | "off-budget";
  date: string;
  payeeName: string;
  transferAccountName: string | null;
  categoryName: string | null;
  notes: string | null;
  /** Exact integer minor units (a safe integer), never a float. */
  amountMinor: number;
  currencyMinorDigits: number;
  cleared: "cleared" | "uncleared" | null;
  reconciled: boolean;
  splitParent: boolean;
  /** The key of the split parent this row belongs to. */
  splitChildOf: string | null;
  linkedChip: boolean;
};

export type PreviewSide = "before" | "after";

export type PreviewDirectory = Pick<AccountDirectory, "accounts" | "categories"> & {
  /** Payee names Bench already knows (from the read). Transfer payees are named from accounts. */
  payeeNames?: Record<string, string>;
  /** Transfer payee id → the account it points at. */
  transferAccountByPayee?: Record<string, string>;
};

function accountOf(directory: PreviewDirectory, id: string) {
  return directory.accounts.find((a) => a.id === id) ?? null;
}

function categoryName(directory: PreviewDirectory, id: string | null): string | null {
  if (!id) return null;
  return directory.categories.find((c) => c.id === id)?.name ?? "Unknown category";
}

function transferTarget(directory: PreviewDirectory, payeeId: string | null): string | null {
  return payeeId ? directory.transferAccountByPayee?.[payeeId] ?? null : null;
}

/** Actual's category rule for a row in `accountId`, optionally a transfer to `transferAccountId`. */
function heldCategory(directory: PreviewDirectory, accountId: string, transferAccountId: string | null, categoryId: string | null): string | null {
  const account = accountOf(directory, accountId);
  if (!account || account.offBudget) return null;
  if (transferAccountId) {
    const other = accountOf(directory, transferAccountId);
    if (other && !other.offBudget) return null;
  }
  return categoryId;
}

function base(directory: PreviewDirectory, digits: number, accountId: string) {
  const account = accountOf(directory, accountId);
  return {
    accountId,
    accountName: account?.name ?? "Unknown account",
    accountBudgetStatus: account?.offBudget ? ("off-budget" as const) : ("on-budget" as const),
    currencyMinorDigits: digits,
  };
}

function payeeLabel(directory: PreviewDirectory, payeeId: string | null, fallbackName: string | null, transferAccountId: string | null): { payeeName: string; transferAccountName: string | null } {
  if (transferAccountId) {
    const name = accountOf(directory, transferAccountId)?.name ?? "Unknown account";
    return { payeeName: `Transfer: ${name}`, transferAccountName: name };
  }
  const known = payeeId ? directory.payeeNames?.[payeeId] ?? null : null;
  return { payeeName: known ?? fallbackName ?? "", transferAccountName: null };
}

function existingRow(directory: PreviewDirectory, digits: number, row: RowSnapshot, overrides: Partial<PreviewRow> = {}): PreviewRow {
  const transferAccountId = transferTarget(directory, row.payeeId);
  return {
    rowKind: "existing",
    key: row.id,
    ...base(directory, digits, row.accountId),
    date: row.date,
    ...payeeLabel(directory, row.payeeId, row.payeeName, transferAccountId),
    categoryName: categoryName(directory, row.categoryId),
    notes: row.notes,
    amountMinor: row.amountMinor,
    cleared: row.cleared ? "cleared" : "uncleared",
    reconciled: row.reconciled,
    splitParent: row.isParent,
    splitChildOf: row.isChild ? row.parentId : null,
    linkedChip: false,
    ...overrides,
  };
}

export function renderPreviewRows(output: PostingOutputSnapshot, directory: PreviewDirectory, currencyMinorDigits: number, side: PreviewSide = "after"): PreviewRow[] {
  const digits = currencyMinorDigits;
  switch (output.kind) {
    case "create": {
      if (side === "before") return [];
      return output.operations.map((op, index): PreviewRow => ({
        rowKind: "create",
        key: `create-${index}`,
        ...base(directory, digits, op.accountId),
        date: op.date,
        ...payeeLabel(directory, op.payeeId, null, op.transferAccountId),
        categoryName: categoryName(directory, heldCategory(directory, op.accountId, op.transferAccountId, op.categoryId)),
        notes: op.notes,
        amountMinor: op.amountMinor,
        cleared: op.cleared ? "cleared" : "uncleared",
        reconciled: false,
        splitParent: false,
        splitChildOf: null,
        linkedChip: false,
      }));
    }
    case "claim":
      return output.rows.map((row) => existingRow(directory, digits, row, { rowKind: side === "after" ? "linked" : "existing", linkedChip: side === "after" && !output.release }));
    case "restructure": {
      const before = output.before;
      if (side === "before") return [existingRow(directory, digits, before)];
      const parent = existingRow(directory, digits, before, { splitParent: true, categoryName: "Split" });
      const rows: PreviewRow[] = [parent];
      const counterparts: PreviewRow[] = [];
      output.expectedPostState.children.forEach((child, index) => {
        const key = `${before.id}:child-${index}`;
        rows.push({
          rowKind: "create",
          key,
          ...base(directory, digits, before.accountId),
          date: before.date,
          ...payeeLabel(directory, child.payeeId, child.payeeId === before.payeeId ? before.payeeName : null, child.transferAccountId),
          categoryName: categoryName(directory, heldCategory(directory, before.accountId, child.transferAccountId, child.categoryId)),
          notes: child.notes,
          amountMinor: child.amountMinor,
          cleared: before.cleared ? "cleared" : "uncleared",
          reconciled: false,
          splitParent: false,
          splitChildOf: before.id,
          linkedChip: false,
        });
        if (child.transferAccountId) {
          // Actual's own transfer handling creates the other leg (R-06).
          counterparts.push({
            rowKind: "create",
            key: `${key}:counterpart`,
            ...base(directory, digits, child.transferAccountId),
            date: before.date,
            ...payeeLabel(directory, null, null, before.accountId),
            categoryName: categoryName(directory, heldCategory(directory, child.transferAccountId, before.accountId, child.categoryId)),
            notes: child.notes,
            amountMinor: -child.amountMinor,
            cleared: "uncleared",
            reconciled: false,
            splitParent: false,
            splitChildOf: null,
            linkedChip: false,
          });
        }
      });
      return [...rows, ...counterparts];
    }
    case "link": {
      const { sourceBefore: source, counterpartBefore: counterpart } = output;
      if (side === "before") return [existingRow(directory, digits, source), existingRow(directory, digits, counterpart)];
      const sourceAccount = counterpart.accountId;
      return [
        existingRow(directory, digits, source, {
          ...payeeLabel(directory, null, null, sourceAccount),
          categoryName: categoryName(directory, heldCategory(directory, source.accountId, sourceAccount, source.categoryId)),
          notes: counterpart.notes,
        }),
        existingRow(directory, digits, counterpart, {
          rowKind: "linked",
          ...payeeLabel(directory, null, null, source.accountId),
          categoryName: categoryName(directory, heldCategory(directory, counterpart.accountId, source.accountId, counterpart.categoryId)),
          notes: counterpart.notes,
          amountMinor: output.expectedPairState.counterpartAmountMinor,
          linkedChip: true,
        }),
      ];
    }
  }
}

/**
 * Rows read back from Actual, normalized to the preview shape (SC-019). The
 * caller passes the posting's preview so the keys line up: created rows are
 * found by marker or position, existing rows by id.
 */
export function actualRowsToPreviewRows(
  preview: PreviewRow[],
  read: SyncSourceTransaction[],
  directory: PreviewDirectory,
  currencyMinorDigits: number,
  locate: (row: PreviewRow, index: number) => string | null
): PreviewRow[] {
  const byId = new Map<string, { row: SyncSourceTransaction; line?: SyncSourceTransaction["splitLines"][number] }>();
  for (const row of read) {
    byId.set(row.id, { row });
    for (const line of row.splitLines) if (line.id) byId.set(line.id, { row, line });
  }
  return preview.map((shown, index): PreviewRow => {
    const id = locate(shown, index);
    const found = id ? byId.get(id) : undefined;
    if (!found) return { ...shown, notes: "(missing in Actual)", amountMinor: 0 };
    const { row, line } = found;
    const payeeId = line ? line.payeeId : row.payeeId;
    const transferAccountId = transferTarget(directory, payeeId);
    const isLine = line !== undefined;
    return {
      rowKind: shown.rowKind,
      key: shown.key,
      ...base(directory, currencyMinorDigits, row.accountId),
      date: row.date,
      ...payeeLabel(directory, payeeId, isLine ? line.payeeName : row.payeeName, transferAccountId),
      categoryName: !isLine && row.isParent ? "Split" : categoryName(directory, isLine ? line.categoryId : row.categoryId),
      notes: isLine ? line.notes : row.notes,
      amountMinor: isLine ? line.amount : row.amount,
      cleared: (isLine ? line.cleared ?? row.cleared : row.cleared) ? "cleared" : "uncleared",
      reconciled: isLine ? line.reconciled ?? row.reconciled : row.reconciled,
      splitParent: !isLine && row.isParent,
      splitChildOf: shown.splitChildOf,
      linkedChip: shown.linkedChip,
    };
  });
}

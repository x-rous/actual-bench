import type { ActivityRow, ActivitySnapshot } from "../activity";
import type { Card, TransactionType, Workspace } from "../models";
import { keywordType } from "../recognition";
import { costFamilyOf } from "./families";
import { currentPlanEntry, scopedRowCache, typeCorrectionFor, type RowCacheRoot } from "./indexes";
import { isPlanAccountTransfer } from "./planAccounts";

/**
 * Where a type came from. Plan links, plan-account transfers and incoming transfers are
 * `structure`; the user's correction is `user`; the card's mapped categories and any other
 * Actual category are `category`; payee keywords and the uncategorised default are `suggested`.
 */
export type TypeSource = "structure" | "user" | "category" | "suggested";

export type TypeResolution = {
  kind: TransactionType;
  source: TypeSource;
  reason: string;
  /** A user correction whose date or amount changed since it was confirmed (D21). */
  changed: boolean;
  /** Counts in interest and fee totals: false for Suggested interest/fee until accepted (A5). */
  counted: boolean;
};

const cache: RowCacheRoot = new WeakMap();

/** One resolved type per row; cached on every input it reads. */
export function transactionType(row: ActivityRow, card: Card, workspace: Workspace, snapshot: ActivitySnapshot) {
  const rows = scopedRowCache<ActivityRow, TypeResolution>(cache, [
    snapshot, card, workspace.typeCorrections, workspace.planEntries, workspace.plans, workspace.planAccounts,
  ]);
  let result = rows.get(row);
  if (!result) {
    result = resolve(row, card, workspace, snapshot);
    rows.set(row, result);
  }
  return result;
}

/** The type alone, for totals, filters and guards. */
export function activityKind(row: ActivityRow, card: Card, workspace: Workspace, snapshot: ActivitySnapshot) {
  return transactionType(row, card, workspace, snapshot).kind;
}

const result = (kind: TransactionType, source: TypeSource, reason: string, changed = false): TypeResolution => ({
  kind,
  source,
  reason,
  changed,
  counted: source !== "suggested" || costFamilyOf(kind) === null,
});

/** The evidence ladder (§7.3). */
function resolve(row: ActivityRow, card: Card, workspace: Workspace, snapshot: ActivitySnapshot): TypeResolution {
  // 1. Plan structure: never a payment and never a cost because of its wording.
  const entry = currentPlanEntry(workspace, row);
  if (entry && entry.role !== "original" && entry.role !== "cost") {
    return result(entry.role === "refund" ? "refund" : "instalment", "structure", "Linked to a plan");
  }
  if (isPlanAccountTransfer(row, snapshot, workspace)) {
    return result("instalment", "structure", "Transfer with a plan account");
  }
  // 2. The user's correction, keyed by transaction id and narrow identity.
  const correction = typeCorrectionFor(workspace, card.id, row);
  if (correction) {
    const changed = correction.sourceHash !== row.fingerprint;
    return result(correction.kind, "user", changed ? "Set by you · changed since you confirmed" : "Set by you", changed);
  }
  // Incoming transfers are payments; outgoing transfers stay transfers.
  if (row.transferId) {
    return row.amountMinor > 0
      ? result("payment", "structure", "Incoming transfer")
      : result("transfer", "structure", "Outgoing transfer");
  }
  if (row.amountMinor === 0) return result("adjustment", "suggested", "Zero amount");
  // 3. The card's mapped categories.
  const credit = row.amountMinor > 0;
  if (row.categoryId && row.categoryId === card.interestCategoryId) return result("interest", "category", "Interest category");
  if (row.categoryId && row.categoryId === card.feeCategoryId) return result("fee", "category", "Fee category");
  if (credit && row.categoryId && row.categoryId === card.cashbackCategoryId) {
    return result("cashback", "category", "Cashback category");
  }
  // 4. Any other Actual category: keywords never override it.
  if (row.categoryId) return result(credit ? "refund" : "purchase", "category", "From your Actual category");
  // 5. Keywords on the imported payee, uncategorised rows only.
  const keyword = keywordType(row.importedPayee ?? row.label, row.amountMinor);
  if (keyword) return result(keyword.kind, "suggested", keyword.reason);
  return result(credit ? "refund" : "purchase", "suggested", "Uncategorised");
}

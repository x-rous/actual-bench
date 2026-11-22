"use client";

import { useBudgetEditsStore } from "@/store/budgetEdits";
import { generateId } from "@/lib/uuid";

type StagedTransferParams = {
  month: string;
  sourceCategoryId: string;
  destinationCategoryId: string;
  amount: number;
  sourceServerBudgeted: number;
  destServerBudgeted: number;
};

export function useStagedTransfer() {
  const edits = useBudgetEditsStore((s) => s.edits);
  const stageBulkEdits = useBudgetEditsStore((s) => s.stageBulkEdits);

  function stageTransfer({
    month,
    sourceCategoryId,
    destinationCategoryId,
    amount,
    sourceServerBudgeted,
    destServerBudgeted,
  }: StagedTransferParams) {
    const transferGroupId = `transfer-${generateId()}`;

    // Each leg starts from the cell's current (staged) value, but keeps the
    // server value as its baseline so a hand edit staged earlier in the same
    // cell is still written (C1). The store enforces the same rule.
    const sourceExisting = edits[`${month}:${sourceCategoryId}`];
    const destExisting = edits[`${month}:${destinationCategoryId}`];
    const sourceCurrent = sourceExisting?.nextBudgeted ?? sourceServerBudgeted;
    const destCurrent = destExisting?.nextBudgeted ?? destServerBudgeted;

    stageBulkEdits([
      {
        month,
        categoryId: sourceCategoryId,
        nextBudgeted: sourceCurrent - amount,
        previousBudgeted: sourceExisting?.previousBudgeted ?? sourceServerBudgeted,
        source: "transfer",
        transferGroupId,
      },
      {
        month,
        categoryId: destinationCategoryId,
        nextBudgeted: destCurrent + amount,
        previousBudgeted: destExisting?.previousBudgeted ?? destServerBudgeted,
        source: "transfer",
        transferGroupId,
      },
    ]);
  }

  return { stageTransfer };
}

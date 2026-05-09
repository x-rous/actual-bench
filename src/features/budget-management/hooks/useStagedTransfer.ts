"use client";

import { useBudgetEditsStore } from "@/store/budgetEdits";

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
    const transferGroupId = `transfer-${crypto.randomUUID()}`;

    const sourcePrev =
      edits[`${month}:${sourceCategoryId}`]?.nextBudgeted ?? sourceServerBudgeted;
    const destPrev =
      edits[`${month}:${destinationCategoryId}`]?.nextBudgeted ?? destServerBudgeted;

    stageBulkEdits([
      {
        month,
        categoryId: sourceCategoryId,
        nextBudgeted: sourcePrev - amount,
        previousBudgeted: sourcePrev,
        source: "transfer",
        transferGroupId,
      },
      {
        month,
        categoryId: destinationCategoryId,
        nextBudgeted: destPrev + amount,
        previousBudgeted: destPrev,
        source: "transfer",
        transferGroupId,
      },
    ]);
  }

  return { stageTransfer };
}

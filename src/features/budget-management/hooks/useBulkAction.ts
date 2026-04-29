"use client";

import { useCallback } from "react";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { addMonths } from "@/lib/budget/monthMath";
import { resolveSelectionCells } from "../lib/budgetSelectionUtils";
import type {
  BudgetCellSelection,
  LoadedCategory,
  StagedBudgetEdit,
} from "../types";

export type BulkActionType =
  | "copy-previous-month"
  | "copy-from-month"
  | "set-to-zero"
  | "set-fixed"
  | "apply-percentage"
  | "avg-3-months"
  | "avg-6-months"
  | "avg-12-months";

export type BulkActionParams = {
  /** For "set-fixed": the fixed amount in minor units */
  fixedAmount?: number;
  /** For "copy-from-month": source month string */
  sourceMonth?: string;
  /** For "apply-percentage": multiplier, e.g. 1.1 for 10% increase */
  percentage?: number;
};

export type BulkPreviewRow = {
  month: string;
  categoryId: string;
  categoryName: string;
  previousBudgeted: number;
  nextBudgeted: number;
};

type UseBulkActionReturn = {
  /**
   * Resolve preview rows for a bulk action on a selection.
   * Returns null if required params are missing or data is unavailable.
   */
  preview: (
    action: BulkActionType,
    selection: BudgetCellSelection,
    months: string[],
    categories: LoadedCategory[],
    monthDataMap: Record<string, LoadedCategory[]>,
    params?: BulkActionParams
  ) => BulkPreviewRow[] | null;

  /**
   * Stage all preview rows as a single undoable bulk edit.
   */
  apply: (rows: BulkPreviewRow[]) => void;
};

/**
 * Resolves and applies bulk budget actions on a rectangular cell selection.
 *
 * Preview is pure (no side effects). Apply stages all rows as one undo step.
 */
export function useBulkAction(): UseBulkActionReturn {
  const stageBulkEdits = useBudgetEditsStore((s) => s.stageBulkEdits);

  const preview = useCallback(
    (
      action: BulkActionType,
      selection: BudgetCellSelection,
      months: string[],
      categories: LoadedCategory[],
      monthDataMap: Record<string, LoadedCategory[]>,
      params?: BulkActionParams
    ): BulkPreviewRow[] | null => {
      const cells = resolveSelectionCells(selection, months, categories);
      if (cells.length === 0) return null;

      const rows: BulkPreviewRow[] = [];

      for (const cell of cells) {
        const targetMonthCat = monthDataMap[cell.month]?.find(
          (c) => c.id === cell.categoryId
        );
        const metadataCat = categories.find((c) => c.id === cell.categoryId);
        const cat = targetMonthCat ?? metadataCat;
        if (!cat) continue;

        const currentBudgeted = targetMonthCat?.budgeted ?? cat.budgeted;
        let nextBudgeted: number | null = null;

        switch (action) {
          case "set-to-zero":
            nextBudgeted = 0;
            break;

          case "set-fixed":
            if (params?.fixedAmount === undefined) return null;
            nextBudgeted = params.fixedAmount;
            break;

          case "apply-percentage":
            if (params?.percentage === undefined) return null;
            nextBudgeted = Math.round(currentBudgeted * params.percentage);
            break;

          case "copy-previous-month": {
            const monthIdx = months.indexOf(cell.month);
            if (monthIdx <= 0) continue;
            const prevMonth = months[monthIdx - 1];
            if (!prevMonth) continue;
            const prevCats = monthDataMap[prevMonth];
            if (!prevCats) continue;
            const prevCat = prevCats.find((c) => c.id === cell.categoryId);
            if (!prevCat) continue;
            nextBudgeted = prevCat.budgeted;
            break;
          }

          case "copy-from-month": {
            if (!params?.sourceMonth) return null;
            const sourceCats = monthDataMap[params.sourceMonth];
            if (!sourceCats) return null;
            const sourceCat = sourceCats.find((c) => c.id === cell.categoryId);
            if (!sourceCat) continue;
            nextBudgeted = sourceCat.budgeted;
            break;
          }

          case "avg-3-months":
          case "avg-6-months":
          case "avg-12-months": {
            const n = action === "avg-3-months" ? 3 : action === "avg-6-months" ? 6 : 12;
            const vals: number[] = [];
            let m = cell.month;
            for (let i = 0; i < n; i++) {
              m = addMonths(m, -1);
              const cats = monthDataMap[m];
              const found = cats?.find((c) => c.id === cell.categoryId);
              if (found !== undefined) vals.push(found.budgeted);
            }
            if (vals.length === 0) continue;
            nextBudgeted = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
            break;
          }
        }

        if (nextBudgeted === null) continue;

        rows.push({
          month: cell.month,
          categoryId: cell.categoryId,
          categoryName: metadataCat?.name ?? cat.name,
          previousBudgeted: currentBudgeted,
          nextBudgeted,
        });
      }

      return rows.length > 0 ? rows : null;
    },
    []
  );

  const apply = useCallback(
    (rows: BulkPreviewRow[]) => {
      const edits: StagedBudgetEdit[] = rows.map((row) => ({
        month: row.month,
        categoryId: row.categoryId,
        nextBudgeted: row.nextBudgeted,
        previousBudgeted: row.previousBudgeted,
        source: "bulk-action",
      }));
      stageBulkEdits(edits);
    },
    [stageBulkEdits]
  );

  return { preview, apply };
}

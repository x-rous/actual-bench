"use client";

import { useCallback } from "react";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { addMonths, currentMonth } from "@/lib/budget/monthMath";
import { resolveSelectionCells, type ResolvedCell } from "../lib/budgetSelectionUtils";
import type {
  BudgetCellSelection,
  LoadedCategory,
  StagedBudgetEdit,
} from "../types";

export type BulkActionType =
  | "copy-previous-month"
  | "copy-prior-year-same-month"
  | "copy-prior-year-same-month-pct"
  | "copy-from-month"
  | "set-to-zero"
  | "set-fixed"
  | "apply-percentage"
  | "avg-3-months"
  | "avg-6-months"
  | "avg-12-months"
  | "avg-3-months-actuals"
  | "avg-6-months-actuals"
  | "avg-12-months-actuals";

/** Lookback length for the averaging actions, or null for everything else. */
export function averageWindowLength(action: BulkActionType): number | null {
  switch (action) {
    case "avg-3-months":
    case "avg-3-months-actuals":  return 3;
    case "avg-6-months":
    case "avg-6-months-actuals":  return 6;
    case "avg-12-months":
    case "avg-12-months-actuals": return 12;
    default:                      return null;
  }
}

/**
 * Which number an averaging action reads: what was planned, or what actually
 * happened. "Budget what you normally spend" is a different question from
 * "budget what you normally budgeted", and both are worth asking.
 */
export function averageBasis(action: BulkActionType): "budgeted" | "actuals" {
  return action.endsWith("-actuals") ? "actuals" : "budgeted";
}

/**
 * The month an average looks back from (exclusive). Budgeted averages look
 * back from the cell's own month. Actuals averages only use complete months
 * (H3): the current month is still in progress and later months have no
 * spending yet, so averaging them would read as spending nothing. For a cell
 * in the current month or later, the average covers the last complete months.
 */
export function averageLookbackEnd(
  action: BulkActionType,
  cellMonth: string,
  thisMonth: string = currentMonth()
): string {
  if (averageBasis(action) === "actuals" && cellMonth > thisMonth) return thisMonth;
  return cellMonth;
}

/**
 * Every month an action needs loaded in order to resolve `cells`.
 *
 * Callers pass this to `ensureMonthsData` before previewing. Keeping it here
 * means the set of required months is derived from the same switch that
 * consumes them — a new source-reading action cannot forget to declare itself.
 */
export function requiredSourceMonths(
  action: BulkActionType,
  cellMonths: readonly string[],
  params?: BulkActionParams
): string[] {
  const months = new Set<string>();

  const avgWindow = averageWindowLength(action);
  if (avgWindow !== null) {
    for (const month of cellMonths) {
      const end = averageLookbackEnd(action, month);
      for (let i = 1; i <= avgWindow; i++) months.add(addMonths(end, -i));
    }
    return [...months];
  }

  switch (action) {
    case "copy-previous-month":
      for (const month of cellMonths) months.add(addMonths(month, -1));
      break;
    case "copy-prior-year-same-month":
    case "copy-prior-year-same-month-pct":
      for (const month of cellMonths) months.add(addMonths(month, -12));
      break;
    case "copy-from-month":
      if (params?.sourceMonth) months.add(params.sourceMonth);
      break;
    default:
      break;
  }

  return [...months];
}

export type BulkActionParams = {
  /** For "set-fixed": the fixed amount in minor units */
  fixedAmount?: number;
  /** For "copy-from-month": source month string */
  sourceMonth?: string;
  /**
   * For "apply-percentage": multiplier applied to the cell's *current* value.
   * For the copy actions: optional multiplier applied to the *source* value,
   * so 1.05 copies last year plus 5%. Absent means 100%.
   */
  percentage?: number;
};

export type BulkPreviewRow = {
  month: string;
  categoryId: string;
  categoryName: string;
  previousBudgeted: number;
  nextBudgeted: number;
};

export type BulkSkipReason =
  /** The source month is not in the budget file, or failed to load. */
  | "missing-source-month"
  /** The source month loaded, but the category has no row in it. */
  | "missing-category";

export type BulkPreviewResult = {
  rows: BulkPreviewRow[];
  /** Cells dropped, by reason. Callers must report these, never absorb them. */
  skipped: Record<BulkSkipReason, number>;
  /**
   * Averaging actions only: how many lookback months were asked for, and the
   * fewest actually resolved for any single cell. A short average is a valid
   * answer; an unlabelled one is not.
   */
  averageWindow?: {
    requested: number;
    resolved: number;
    /**
     * Actuals averages only: true when some cell's average had to stop at the
     * last complete month instead of the month before the cell (H3).
     */
    usedCompleteMonthsOnly?: boolean;
  };
};

type UseBulkActionReturn = {
  /**
   * Resolve preview rows for a bulk action on a selection.
   * Returns null only when required parameters are missing — that is a
   * validation failure, distinct from an action that resolved to nothing.
   */
  preview: (
    action: BulkActionType,
    /**
     * Either a selection rectangle, or an explicit cell list. The list form is
     * how a group row or a month column acts on its cells without having to
     * pretend to be a rectangle.
     */
    target: BudgetCellSelection | ResolvedCell[],
    months: string[],
    categories: LoadedCategory[],
    monthDataMap: Record<string, LoadedCategory[]>,
    params?: BulkActionParams
  ) => BulkPreviewResult | null;

  /**
   * Stage all preview rows as a single undoable bulk edit.
   */
  apply: (rows: BulkPreviewRow[]) => void;
};

/**
 * Resolves and applies bulk budget actions on a rectangular cell selection.
 *
 * Preview is pure (no side effects) and reads only from `monthDataMap`, which
 * the caller is responsible for populating via `ensureMonthsData`. A month
 * absent from that map is reported as skipped rather than treated as zero.
 *
 * Apply stages all rows as one undo step.
 */
export function useBulkAction(): UseBulkActionReturn {
  const stageBulkEdits = useBudgetEditsStore((s) => s.stageBulkEdits);

  const preview = useCallback(
    (
      action: BulkActionType,
      target: BudgetCellSelection | ResolvedCell[],
      months: string[],
      categories: LoadedCategory[],
      monthDataMap: Record<string, LoadedCategory[]>,
      params?: BulkActionParams
    ): BulkPreviewResult | null => {
      const cells = Array.isArray(target)
        ? target
        : resolveSelectionCells(target, months, categories);
      const skipped: Record<BulkSkipReason, number> = {
        "missing-source-month": 0,
        "missing-category": 0,
      };
      const avgWindow = averageWindowLength(action);
      let minResolved = avgWindow ?? 0;

      if (cells.length === 0) return { rows: [], skipped };

      const rows: BulkPreviewRow[] = [];
      // H2: budgeted values are read through the staged edits, so "copy
      // previous month" after editing that month copies the value on screen.
      // `monthDataMap` holds saved values only; actuals are never staged.
      const staged = useBudgetEditsStore.getState().edits;
      const stagedOr = (month: string, categoryId: string, saved: number) =>
        staged[`${month}:${categoryId}`]?.nextBudgeted ?? saved;
      let usedCompleteMonthsOnly = false;
      const thisMonth = currentMonth();

      /**
       * Reads one category's budgeted value out of a source month.
       * `undefined` means "not available", with the reason recorded — the two
       * cases are different to a user and must not collapse into one message.
       */
      const readSource = (
        sourceMonth: string,
        categoryId: string
      ): number | undefined => {
        const sourceCats = monthDataMap[sourceMonth];
        if (!sourceCats) {
          skipped["missing-source-month"] += 1;
          return undefined;
        }
        const sourceCat = sourceCats.find((c) => c.id === categoryId);
        if (!sourceCat) {
          skipped["missing-category"] += 1;
          return undefined;
        }
        return stagedOr(sourceMonth, categoryId, sourceCat.budgeted);
      };

      /** Copy multiplier. Absent percentage means an exact copy. */
      const copyFactor = params?.percentage ?? 1;

      for (const cell of cells) {
        const targetMonthCat = monthDataMap[cell.month]?.find(
          (c) => c.id === cell.categoryId
        );
        const metadataCat = categories.find((c) => c.id === cell.categoryId);
        const cat = targetMonthCat ?? metadataCat;
        if (!cat) continue;

        // The value on screen. The store keeps the saved value as the edit's
        // baseline when this replaces an existing staged edit.
        const currentBudgeted = stagedOr(
          cell.month,
          cell.categoryId,
          targetMonthCat?.budgeted ?? cat.budgeted
        );
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
            // Resolved by month arithmetic, not by position in the visible
            // window: the first rendered column has a previous month too.
            const source = readSource(addMonths(cell.month, -1), cell.categoryId);
            if (source === undefined) continue;
            nextBudgeted = Math.round(source * copyFactor);
            break;
          }

          case "copy-prior-year-same-month":
          case "copy-prior-year-same-month-pct": {
            // The offset is computed per cell, which is what makes a
            // multi-month selection map positionally onto the prior year
            // instead of repeating a single source month.
            const source = readSource(addMonths(cell.month, -12), cell.categoryId);
            if (source === undefined) continue;
            nextBudgeted = Math.round(source * copyFactor);
            break;
          }

          case "copy-from-month": {
            if (!params?.sourceMonth) return null;
            const source = readSource(params.sourceMonth, cell.categoryId);
            if (source === undefined) continue;
            nextBudgeted = Math.round(source * copyFactor);
            break;
          }

          case "avg-3-months":
          case "avg-6-months":
          case "avg-12-months":
          case "avg-3-months-actuals":
          case "avg-6-months-actuals":
          case "avg-12-months-actuals": {
            const n = avgWindow ?? 0;
            const basis = averageBasis(action);
            const vals: number[] = [];
            let anyMonthLoaded = false;
            let m = averageLookbackEnd(action, cell.month, thisMonth);
            if (m !== cell.month) usedCompleteMonthsOnly = true;
            for (let i = 0; i < n; i++) {
              m = addMonths(m, -1);
              const cats = monthDataMap[m];
              if (cats) anyMonthLoaded = true;
              const found = cats?.find((c) => c.id === cell.categoryId);
              if (found !== undefined) {
                vals.push(
                  basis === "actuals"
                    ? found.actuals
                    : stagedOr(m, cell.categoryId, found.budgeted)
                );
              }
            }
            if (vals.length === 0) {
              // Nothing to average: a skip, not a zero-month average. Counting
              // it in minResolved would report "0 of 3" for a run whose other
              // cells averaged fine.
              //
              // Which skip it is matters to the message: months that never
              // loaded are a different problem from months that loaded without
              // this category, and the copy actions already tell them apart.
              skipped[anyMonthLoaded ? "missing-category" : "missing-source-month"] += 1;
              continue;
            }
            // Report the worst-resolved cell that actually produced a value, so
            // the caller labels the average with what it covered.
            minResolved = Math.min(minResolved, vals.length);
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;

            if (basis === "budgeted") {
              nextBudgeted = Math.round(mean);
            } else {
              // `actuals` is signed money flow: spending is negative, income
              // received is positive (see LoadedCategory). A budget is stated
              // in the same form as `budgeted`, so an expense average has to be
              // flipped to a magnitude - and clamped at zero, because a month
              // of net refunds averages positive and must not become a negative
              // budget. Mirrors the spending bar's `Math.max(0, -actuals)`.
              nextBudgeted = metadataCat?.isIncome ?? cat.isIncome
                ? Math.round(mean)
                : Math.max(0, Math.round(-mean));
            }
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

      return {
        rows,
        skipped,
        ...(avgWindow !== null
          ? {
              averageWindow: {
                requested: avgWindow,
                resolved: minResolved,
                ...(usedCompleteMonthsOnly ? { usedCompleteMonthsOnly } : {}),
              },
            }
          : {}),
      };
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

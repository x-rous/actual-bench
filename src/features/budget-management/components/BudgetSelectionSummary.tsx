"use client";

import { useBudgetEditsStore } from "@/store/budgetEdits";
import type { BudgetCellKey, BudgetCellSelection, LoadedCategory } from "../types";
import { resolveSelectionCells } from "../lib/budgetSelectionUtils";
import { formatDelta } from "../lib/format";

type Props = {
  selection: BudgetCellSelection | null;
  activeMonths: string[];
  categories: LoadedCategory[];
};

/**
 * Footer bar showing:
 * - Global staged-edit count and total delta (always visible, read directly
 *   from the store — does not depend on categories being loaded).
 * - Per-selection rectangle statistics when a selection is active and
 *   categories are available.
 */
export function BudgetSelectionSummary({
  selection,
  activeMonths,
  categories,
}: Props) {
  const edits = useBudgetEditsStore((s) => s.edits);

  // ── Global stats (no category lookup needed) ──────────────────────────────
  const editValues = Object.values(edits);
  const totalStaged = editValues.length;
  const totalDelta = editValues.reduce(
    (sum, e) => sum + (e.nextBudgeted - e.previousBudgeted),
    0
  );

  // ── Per-selection stats (requires categories to be loaded) ────────────────
  let selectionCells: { month: string; categoryId: string }[] = [];
  let selectionStagedCount = 0;
  let selectionDelta = 0;

  if (selection && categories.length > 0) {
    selectionCells = resolveSelectionCells(selection, activeMonths, categories);
    for (const cell of selectionCells) {
      const key: BudgetCellKey = `${cell.month}:${cell.categoryId}`;
      const edit = edits[key];
      if (edit) {
        selectionStagedCount++;
        selectionDelta += edit.nextBudgeted - edit.previousBudgeted;
      }
    }
  }

  const selectedMonthSet = new Set(selectionCells.map((c) => c.month));
  const selectedCatSet = new Set(selectionCells.map((c) => c.categoryId));

  return (
    <div
      className="h-8 border-t border-border bg-muted/30 px-4 flex items-center gap-4 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
      aria-label="Selection summary"
    >
      {/* Global staged edits — always visible */}
      {totalStaged > 0 ? (
        <>
          <span
            className="text-amber-600 dark:text-amber-400 font-medium"
            aria-label={`${totalStaged} total staged edits`}
          >
            {totalStaged} staged
          </span>
          <span
            className={
              totalDelta === 0
                ? ""
                : totalDelta > 0
                ? "text-emerald-600 dark:text-emerald-400 font-medium"
                : "text-red-600 dark:text-red-400 font-medium"
            }
            aria-label={`Total staged delta: ${formatDelta(totalDelta)}`}
          >
            {formatDelta(totalDelta)}
          </span>
        </>
      ) : (
        <span>No staged edits</span>
      )}

      {/* Selection rectangle stats */}
      {selectionCells.length > 0 && (
        <>
          <span className="text-border/80 select-none" aria-hidden="true">
            │
          </span>
          <span aria-label={`${selectionCells.length} cells selected`}>
            {selectionCells.length} cell{selectionCells.length !== 1 ? "s" : ""}
          </span>
          <span aria-label={`${selectedMonthSet.size} months, ${selectedCatSet.size} categories`}>
            ({selectedMonthSet.size} mo × {selectedCatSet.size} cat)
          </span>
          {selectionStagedCount > 0 && (
            <span
              className={
                selectionDelta === 0
                  ? ""
                  : selectionDelta > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }
              aria-label={`Selection delta: ${formatDelta(selectionDelta)}`}
            >
              sel: {formatDelta(selectionDelta)}
            </span>
          )}
        </>
      )}

      {selectionCells.length === 0 && totalStaged === 0 && !selection && (
        <span>No selection</span>
      )}
    </div>
  );
}

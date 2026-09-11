"use client";

import { useState } from "react";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { StagedChangesDialog } from "./StagedChangesDialog";
import type { BudgetCellKey, BudgetCellSelection, CellView, LoadedCategory } from "../types";
import { resolveSelectionCells } from "../lib/budgetSelectionUtils";
import { useMonthsData } from "../context/MonthsDataContext";
import { formatDelta, formatMinor } from "../lib/format";

type Props = {
  selection: BudgetCellSelection | null;
  activeMonths: string[];
  categories: LoadedCategory[];
  /** Which measure the grid is showing, so the footer describes the same one. */
  cellView: CellView;
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
  cellView,
}: Props) {
  const [stagedDialogOpen, setStagedDialogOpen] = useState(false);
  const edits = useBudgetEditsStore((s) => s.edits);
  // Effective (staged-or-server) per-month budgeted values, for the sum/average.
  const { effective } = useMonthsData();

  // ── Global stats (no category lookup needed) ──────────────────────────────
  const editValues = Object.values(edits);
  const totalStaged = editValues.length;
  const totalDelta = editValues.reduce(
    (sum, e) => sum + (e.nextBudgeted - e.previousBudgeted),
    0
  );

  // ── Per-selection stats (requires categories to be loaded) ────────────────
  // BM-35: income budgets are positive and expense budgets negative, so a single
  // Σ over a mixed selection nets to a meaningless number. Track the two sides
  // separately and only present one combined total when the selection is
  // single-sided.
  let selectionCells: { month: string; categoryId: string }[] = [];
  let selectionStagedCount = 0;
  let selectionDelta = 0;
  let incomeSum = 0;
  let expenseSum = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  // Budgeted and actual are tracked regardless of the view, so the comparison
  // can be offered whichever measure the grid happens to be showing.
  let budgetedTotal = 0;
  let actualTotal = 0;

  if (selection && categories.length > 0) {
    const isIncomeById = new Map(categories.map((c) => [c.id, c.isIncome]));
    selectionCells = resolveSelectionCells(selection, activeMonths, categories);
    for (const cell of selectionCells) {
      const key: BudgetCellKey = `${cell.month}:${cell.categoryId}`;
      const edit = edits[key];
      if (edit) {
        selectionStagedCount++;
        selectionDelta += edit.nextBudgeted - edit.previousBudgeted;
      }
      const cat = effective.get(cell.month)?.categoriesById[cell.categoryId];
      const isIncome = isIncomeById.get(cell.categoryId);

      // Follow the cell-view toggle: a footer reporting budgeted while the grid
      // shows Spent describes numbers that are nowhere on screen.
      const shown =
        cellView === "spent"
          ? cat?.actuals ?? 0
          : cellView === "balance"
            ? cat?.balance ?? 0
            : cat?.budgeted ?? 0;

      budgetedTotal += cat?.budgeted ?? 0;
      // `actuals` is signed money flow - spending negative, income received
      // positive - so an expense is compared as a magnitude.
      actualTotal += isIncome ? cat?.actuals ?? 0 : Math.max(0, -(cat?.actuals ?? 0));

      if (isIncome) {
        incomeSum += shown;
        incomeCount++;
      } else {
        expenseSum += shown;
        expenseCount++;
      }
    }
  }

  const isMixedSelection = incomeCount > 0 && expenseCount > 0;
  // Single-sided total/average are meaningful; a mixed net is not, so it is
  // never rendered as one number.
  const selectionSum = incomeSum + expenseSum;
  const selectionAvg =
    selectionCells.length > 0 ? selectionSum / selectionCells.length : 0;

  /**
   * Budget against outcome for the selection.
   *
   * Suppressed for a mixed income/expense selection - "planned versus actual"
   * spanning both sides nets to a number that answers neither - and in the
   * balance view, which is already a residual rather than a plan. Only the
   * measure Σ is *not* showing is named, so the pair never repeats itself.
   */
  const variance = budgetedTotal - actualTotal;
  const showComparison =
    !isMixedSelection && selectionCells.length > 0 && cellView !== "balance";
  const comparisonLabel = cellView === "spent" ? "budgeted" : "actual";
  const comparisonValue = cellView === "spent" ? budgetedTotal : actualTotal;

  const selectedMonthSet = new Set(selectionCells.map((c) => c.month));
  const selectedCatSet = new Set(selectionCells.map((c) => c.categoryId));

  return (
    <div
      className="h-8 border-t border-border bg-muted/30 px-4 flex items-center gap-4 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
      aria-label="Selection summary"
    >
      {/* Global staged edits - always visible */}
      {totalStaged > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setStagedDialogOpen(true)}
            className="text-amber-600 dark:text-amber-400 font-medium underline-offset-2 hover:underline"
            aria-label={`${totalStaged} total staged edits - review them`}
            title="Review staged changes"
          >
            {totalStaged} staged
          </button>
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
          {isMixedSelection ? (
            // Mixed income + expense: show each side's subtotal, never a net.
            <span
              className="tabular-nums"
              aria-label={`Sum of selected income budgets: ${formatMinor(incomeSum)}; sum of selected expense budgets: ${formatMinor(expenseSum)}`}
            >
              Σ inc {formatMinor(incomeSum)} · exp {formatMinor(expenseSum)}
            </span>
          ) : (
            <>
              <span
                className="tabular-nums"
                aria-label={`Sum of selected: ${formatMinor(selectionSum)}`}
              >
                Σ {formatMinor(selectionSum)}
              </span>
              <span
                className="tabular-nums"
                aria-label={`Average of selected: ${formatMinor(selectionAvg)}`}
              >
                avg {formatMinor(selectionAvg)}
              </span>
              {showComparison && (
                <>
                  <span className="text-border/80 select-none" aria-hidden="true">
                    │
                  </span>
                  <span
                    className="tabular-nums"
                    aria-label={`${comparisonLabel} for the selection: ${formatMinor(comparisonValue)}`}
                  >
                    {comparisonLabel} {formatMinor(comparisonValue)}
                  </span>
                  <span
                    className={`tabular-nums font-medium ${
                      variance === 0
                        ? ""
                        : variance > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                    }`}
                    aria-label={
                      variance === 0
                        ? "Spending matches the budget for the selection"
                        : `${variance > 0 ? "Under" : "Over"} budget by ${formatMinor(Math.abs(variance))}`
                    }
                  >
                    {variance === 0
                      ? "on budget"
                      : `${variance > 0 ? "under" : "over"} ${formatMinor(Math.abs(variance))}`}
                  </span>
                </>
              )}
            </>
          )}
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
      {stagedDialogOpen && (
        <StagedChangesDialog onClose={() => setStagedDialogOpen(false)} />
      )}
    </div>
  );
}

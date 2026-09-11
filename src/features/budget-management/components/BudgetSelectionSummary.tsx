"use client";

import { useState } from "react";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { StagedChangesDialog } from "./StagedChangesDialog";
import type { BudgetCellKey, BudgetCellSelection, CellView, LoadedCategory } from "../types";
import { resolveSelectionCells } from "../lib/budgetSelectionUtils";
import { useMonthsData } from "../context/MonthsDataContext";
import { formatDelta, formatMinor } from "../lib/format";

/**
 * One area of the status bar.
 *
 * The bar carries four unrelated kinds of fact - the selection's figures, the
 * same figures per cell, how big the selection is, and what is still unsaved.
 * Rules between the areas are what make each findable by position instead of by
 * reading the whole row; captions would say it more plainly but cost a second
 * line, and the bar has one.
 */
function Zone({
  children,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex items-center gap-3 px-3 ${className}`} {...rest}>
      {children}
    </div>
  );
}

/**
 * A named figure: dim label, value, and its per-cell average in brackets.
 *
 * Totals and averages used to be two groups repeating the same three labels -
 * six values and two label sets for what is really three measures. Pairing each
 * average with its own total says it once and lets the eye read down a single
 * short row instead of across two.
 */
function Figure({
  label,
  value,
  average,
  tone = "text-foreground",
  ...rest
}: {
  label?: string;
  value: string;
  average?: string;
  tone?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className="tabular-nums whitespace-nowrap" {...rest}>
      {label && <span className="text-muted-foreground/70">{label} </span>}
      <span className={tone}>{value}</span>
      {average && (
        <span className="text-muted-foreground/60"> ({average})</span>
      )}
    </span>
  );
}

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
  const cellCount = selectionCells.length;
  const budgetedAvg = cellCount > 0 ? budgetedTotal / cellCount : 0;
  const actualAvg = cellCount > 0 ? actualTotal / cellCount : 0;
  const varianceAvg = cellCount > 0 ? (budgetedTotal - actualTotal) / cellCount : 0;

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

  /**
   * Colour carries meaning for exactly one figure here - whether the selection
   * came in over or under - so only that one gets it, and dimmed. Deltas were
   * green/red before; a row of six coloured numbers reads as an alert rather
   * than a summary, and none of them were urgent.
   */
  const varianceTone =
    variance === 0
      ? "text-muted-foreground"
      : variance > 0
        ? "text-emerald-700/70 dark:text-emerald-500/60"
        : "text-red-700/70 dark:text-red-500/60";

  const hasSelection = selectionCells.length > 0;
  const showFigures = hasSelection && !isMixedSelection;

  return (
    <div
      className="h-8 border-t border-border bg-muted/30 flex items-stretch justify-between text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
      aria-label="Selection summary"
    >
      {/* Left - what the selection is. Each measure once, with its per-cell
          average in brackets. */}
      <div className="flex items-stretch divide-x divide-border/60 min-w-0 overflow-hidden">
        {showFigures && (
          <Zone
            className="pl-4"
            title="Totals for the selection, with per-cell averages in brackets"
          >
            <Figure
              label="Budgeted"
              value={formatMinor(budgetedTotal)}
              average={formatMinor(budgetedAvg)}
              aria-label={`Budgeted total: ${formatMinor(budgetedTotal)}, averaging ${formatMinor(budgetedAvg)} per cell`}
            />
            <Figure
              label="Actual"
              value={formatMinor(actualTotal)}
              average={formatMinor(actualAvg)}
              aria-label={`Actual total: ${formatMinor(actualTotal)}, averaging ${formatMinor(actualAvg)} per cell`}
            />
            <Figure
              label="Variance"
              value={formatDelta(variance)}
              average={formatDelta(varianceAvg)}
              tone={varianceTone}
              aria-label={
                variance === 0
                  ? "Variance: spending matches the budget"
                  : `Variance: ${variance > 0 ? "under" : "over"} budget by ${formatMinor(Math.abs(variance))}, averaging ${formatDelta(varianceAvg)} per cell`
              }
            />
          </Zone>
        )}

        {hasSelection && isMixedSelection && (
          // Mixed income + expense: each side's subtotal, never a net, and no
          // variance - one plan-versus-actual across both answers neither.
          <Zone className="pl-4">
            <Figure
              label="Budgeted income"
              value={formatMinor(incomeSum)}
              aria-label={`Budgeted income ${formatMinor(incomeSum)}, budgeted expenses ${formatMinor(expenseSum)}`}
            />
            <Figure label="expenses" value={formatMinor(expenseSum)} />
          </Zone>
        )}

        {!hasSelection && (
          <Zone className="pl-4">
            <span>{selection ? "No cells selected" : "No selection"}</span>
          </Zone>
        )}
      </div>

      {/* Right - how big the selection is, and what is still pending. Neither
          describes the current state, which is why they sit apart from it. */}
      <div className="flex items-stretch divide-x divide-border/60 shrink-0">
        {hasSelection && (
          <Zone>
            <span
              className="tabular-nums whitespace-nowrap"
              aria-label={`${selectionCells.length} cells selected, across ${selectedMonthSet.size} months and ${selectedCatSet.size} categories`}
            >
              <span className="text-foreground">{selectionCells.length}</span> cell
              {selectionCells.length !== 1 ? "s" : ""}
              <span className="text-muted-foreground/60">
                {" "}
                ({selectedMonthSet.size} mo × {selectedCatSet.size} cat)
              </span>
            </span>
            {selectionStagedCount > 0 && (
              <Figure
                label="edited"
                value={`${selectionStagedCount} · ${formatDelta(selectionDelta)}`}
                aria-label={`${selectionStagedCount} of them edited, changing ${formatDelta(selectionDelta)}`}
              />
            )}
          </Zone>
        )}

        <Zone className="pr-4">
          {totalStaged > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setStagedDialogOpen(true)}
                className="tabular-nums whitespace-nowrap font-medium text-foreground underline-offset-2 hover:underline"
                aria-label={`${totalStaged} staged change${totalStaged !== 1 ? "s" : ""} in the draft - review them`}
                title="Review staged changes"
              >
                {totalStaged} staged
              </button>
              <Figure
                label="net"
                value={formatDelta(totalDelta)}
                aria-label={`Net effect of the draft: ${formatDelta(totalDelta)}`}
              />
            </>
          ) : (
            <span className="whitespace-nowrap">No staged edits</span>
          )}
        </Zone>
      </div>

      {stagedDialogOpen && (
        <StagedChangesDialog onClose={() => setStagedDialogOpen(false)} />
      )}
    </div>
  );
}

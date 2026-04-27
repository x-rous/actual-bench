"use client";

import { formatMonthLabel, prevMonth } from "@/lib/budget/monthMath";
import { useMonthData } from "../../hooks/useMonthData";
import { formatSigned as fmt } from "../../lib/format";
import { MetricRow } from "./MetricRow";
import type { BudgetCellKey, StagedBudgetEdit } from "../../types";

/**
 * Section 1 of the draft panel: details for the selected category cell.
 * Shows the cell's budgeted/actuals/balance, the previous month's budgeted,
 * and (when present) the staged-edit diff with save-error indicator.
 */
export function CellDetailsSection({
  selectedMonth,
  selectedCategoryId,
  edits,
}: {
  selectedMonth: string | null;
  selectedCategoryId: string | null;
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
}) {
  const { data: monthData } = useMonthData(selectedMonth);
  const prev = selectedMonth ? prevMonth(selectedMonth) : null;
  const { data: prevMonthData } = useMonthData(prev);

  if (!selectedMonth || !selectedCategoryId) {
    return (
      <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
        <div className="mb-1">No cell selected</div>
        <div className="text-[10px] text-muted-foreground/50">
          Click a cell to inspect
        </div>
      </div>
    );
  }

  const category = monthData?.categoriesById[selectedCategoryId];
  const prevCategory = prevMonthData?.categoriesById[selectedCategoryId];

  const key: BudgetCellKey = `${selectedMonth}:${selectedCategoryId}`;
  const stagedEdit = edits[key];
  const displayBudgeted =
    stagedEdit != null ? stagedEdit.nextBudgeted : category?.budgeted ?? 0;

  return (
    <div className="px-3 py-2">
      {category ? (
        <div className="mb-2 pb-2 border-b border-border/40">
          <div className="font-semibold text-sm truncate leading-tight">
            {category.name}
          </div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {category.groupName}
          </div>
          <div className="text-[10px] text-muted-foreground/60 mt-1 font-sans tabular-nums">
            {formatMonthLabel(selectedMonth, "long")}
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground text-xs mb-2">
          {monthData ? "Category not found" : "Loading…"}
        </div>
      )}

      {category && (
        <div className="space-y-1.5">
          <MetricRow
            label="Budgeted"
            value={fmt(displayBudgeted)}
            valueClass={
              stagedEdit
                ? "text-amber-700 dark:text-amber-400 font-semibold"
                : undefined
            }
          />
          <MetricRow label="Actuals" value={fmt(category.actuals)} />
          <MetricRow
            label="Balance"
            value={fmt(category.balance)}
            valueClass={
              category.balance < 0
                ? "text-destructive"
                : category.balance > 0
                ? "text-emerald-700 dark:text-emerald-400"
                : undefined
            }
          />
          {category.carryover && <MetricRow label="Carryover" value="On" />}
          {prevCategory !== undefined && (
            <MetricRow label="Prev month" value={fmt(prevCategory.budgeted)} />
          )}

          {stagedEdit && (
            <>
              <div className="h-px bg-border/50 my-1" />
              <MetricRow label="Was" value={fmt(stagedEdit.previousBudgeted)} />
              <MetricRow
                label="Diff"
                value={`${stagedEdit.nextBudgeted - stagedEdit.previousBudgeted >= 0 ? "+" : ""}${fmt(stagedEdit.nextBudgeted - stagedEdit.previousBudgeted)}`}
                valueClass={
                  stagedEdit.nextBudgeted - stagedEdit.previousBudgeted >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-destructive"
                }
              />
              {stagedEdit.saveError && (
                <div className="text-[10px] text-destructive mt-0.5">
                  {stagedEdit.saveError}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

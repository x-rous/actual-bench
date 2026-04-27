"use client";

import { useMemo } from "react";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { formatSigned as fmt } from "../../lib/format";
import type {
  BudgetCellKey,
  LoadedCategory,
  StagedBudgetEdit,
} from "../../types";

/**
 * Section 2 of the draft panel: full list of staged changes grouped by month.
 * Within each month, edits are sorted alphabetically by category name. A
 * pre-built `id → name` map (`useMemo` of `allCategories`) replaces the prior
 * O(N×M) inline `find` per edit (BM-17).
 */
export function StagedChangesSection({
  edits,
  allCategories,
}: {
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
  allCategories: LoadedCategory[];
}) {
  const editList = Object.values(edits);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allCategories) m.set(c.id, c.name);
    return m;
  }, [allCategories]);

  const byMonth = useMemo(() => {
    const grouped: Record<string, StagedBudgetEdit[]> = {};
    for (const edit of editList) {
      if (!grouped[edit.month]) grouped[edit.month] = [];
      grouped[edit.month]!.push(edit);
    }
    return grouped;
  }, [editList]);

  const months = useMemo(() => Object.keys(byMonth).sort(), [byMonth]);

  if (editList.length === 0) {
    return (
      <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
        No staged changes
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <p className="mb-2 text-[10px] text-muted-foreground">
        {editList.length} pending change{editList.length !== 1 ? "s" : ""} in{" "}
        {months.length} month{months.length !== 1 ? "s" : ""}
      </p>

      {months.map((month) => {
        const monthEdits = (byMonth[month] ?? []).slice().sort((a, b) => {
          const nameA = nameById.get(a.categoryId) ?? a.categoryId;
          const nameB = nameById.get(b.categoryId) ?? b.categoryId;
          return nameA.localeCompare(nameB);
        });

        return (
          <div key={month} className="mb-3">
            <p className="text-[11px] font-semibold text-foreground/80 mb-1">
              {formatMonthLabel(month, "long")}
            </p>
            {monthEdits.map((edit) => {
              const catName = nameById.get(edit.categoryId) ?? edit.categoryId.slice(0, 8);
              const delta = edit.nextBudgeted - edit.previousBudgeted;
              const deltaStr = `${delta >= 0 ? "+" : ""}${fmt(delta)}`;
              const deltaClass =
                delta >= 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-destructive";

              return (
                <div
                  key={`${edit.month}:${edit.categoryId}`}
                  className="flex items-baseline justify-between gap-1 py-0.5"
                >
                  <span
                    className="truncate text-[10px] text-foreground/80 min-w-0 flex-1"
                    title={catName}
                  >
                    {catName}
                  </span>
                  <span
                    className={`font-sans tabular-nums text-[10px] shrink-0 ${deltaClass}`}
                  >
                    {deltaStr}
                  </span>
                  {edit.saveError && (
                    <span
                      className="text-[9px] text-destructive shrink-0"
                      title={edit.saveError}
                    >
                      !
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { formatSigned as fmt, formatCurrency } from "../../lib/format";
import type {
  BudgetCellKey,
  LoadedCategory,
  StagedBudgetEdit,
} from "../../types";

/**
 * Counts logical staged changes: transfer pairs count as 1, standalone edits
 * count as 1 each. Matches the count shown in the section header.
 */
export function countLogicalEdits(
  edits: Record<BudgetCellKey, StagedBudgetEdit>
): number {
  const groupIds = new Set<string>();
  let standalone = 0;
  for (const edit of Object.values(edits)) {
    if (edit.transferGroupId) {
      groupIds.add(edit.transferGroupId);
    } else {
      standalone++;
    }
  }
  return standalone + groupIds.size;
}

/**
 * Section 2 of the draft panel: full list of staged changes grouped by month.
 * Within each month, edits are sorted alphabetically by category name. A
 * pre-built `id → name` map (`useMemo` of `allCategories`) replaces the prior
 * O(N×M) inline `find` per edit (BM-17).
 *
 * Transfer pairs (linked by `transferGroupId`) are rendered as a single row
 * ("Transfer  From → To  +$amount") and count as one pending change.
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

  // Split edits into standalone and transfer groups
  const { standaloneEdits, transferGroups } = useMemo(() => {
    const groups = new Map<string, StagedBudgetEdit[]>();
    const standalone: StagedBudgetEdit[] = [];
    for (const edit of editList) {
      if (edit.transferGroupId) {
        if (!groups.has(edit.transferGroupId)) groups.set(edit.transferGroupId, []);
        groups.get(edit.transferGroupId)!.push(edit);
      } else {
        standalone.push(edit);
      }
    }
    return { standaloneEdits: standalone, transferGroups: groups };
  }, [editList]);

  const totalChanges = standaloneEdits.length + transferGroups.size;

  const byMonth = useMemo(() => {
    const grouped: Record<string, { standalone: StagedBudgetEdit[]; transferGroupIds: string[] }> = {};

    for (const edit of standaloneEdits) {
      if (!grouped[edit.month]) grouped[edit.month] = { standalone: [], transferGroupIds: [] };
      grouped[edit.month]!.standalone.push(edit);
    }

    for (const [groupId, legs] of transferGroups) {
      const month = legs[0]?.month;
      if (!month) continue;
      if (!grouped[month]) grouped[month] = { standalone: [], transferGroupIds: [] };
      grouped[month]!.transferGroupIds.push(groupId);
    }

    return grouped;
  }, [standaloneEdits, transferGroups]);

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
        {totalChanges} pending change{totalChanges !== 1 ? "s" : ""} in{" "}
        {months.length} month{months.length !== 1 ? "s" : ""}
      </p>

      {months.map((month) => {
        const { standalone, transferGroupIds } = byMonth[month] ?? {
          standalone: [],
          transferGroupIds: [],
        };

        const sortedStandalone = standalone.slice().sort((a, b) => {
          const nameA = nameById.get(a.categoryId) ?? a.categoryId;
          const nameB = nameById.get(b.categoryId) ?? b.categoryId;
          return nameA.localeCompare(nameB);
        });

        return (
          <div key={month} className="mb-3">
            <p className="text-[11px] font-semibold text-foreground/80 mb-1">
              {formatMonthLabel(month, "long")}
            </p>

            {/* Transfer group rows */}
            {transferGroupIds.map((groupId) => {
              const legs = transferGroups.get(groupId) ?? [];
              const src = legs.find((l) => l.nextBudgeted < l.previousBudgeted);
              const dst = legs.find((l) => l.nextBudgeted >= l.previousBudgeted);

              if (!src || !dst || legs.length !== 2) {
                // Incomplete transfer — render legs as standalone with warning
                return legs.map((edit) => {
                  const catName = nameById.get(edit.categoryId) ?? edit.categoryId.slice(0, 8);
                  const delta = edit.nextBudgeted - edit.previousBudgeted;
                  return (
                    <div
                      key={`${edit.month}:${edit.categoryId}`}
                      className="flex items-baseline justify-between gap-1 py-0.5"
                    >
                      <span className="truncate text-[10px] text-foreground/80 min-w-0 flex-1" title={catName}>
                        {catName}{" "}
                        <span className="text-[9px] text-amber-500">⚠ incomplete transfer</span>
                      </span>
                      <span className={`font-sans tabular-nums text-[10px] shrink-0 ${delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
                        {`${delta >= 0 ? "+" : ""}${fmt(delta)}`}
                      </span>
                    </div>
                  );
                });
              }

              const srcName = nameById.get(src.categoryId) ?? src.categoryId.slice(0, 8);
              const dstName = nameById.get(dst.categoryId) ?? dst.categoryId.slice(0, 8);
              const amount = dst.nextBudgeted - dst.previousBudgeted;

              return (
                <div
                  key={groupId}
                  className="flex items-baseline justify-between gap-1 py-0.5"
                >
                  <span className="text-[10px] text-muted-foreground shrink-0">Transfer</span>
                  <span
                    className="truncate text-[10px] text-foreground/80 min-w-0 flex-1 mx-1"
                    title={`${srcName} → ${dstName}`}
                  >
                    {srcName} → {dstName}
                  </span>
                  <span className="font-sans tabular-nums text-[10px] shrink-0 text-emerald-700 dark:text-emerald-400">
                    +{formatCurrency(amount)}
                  </span>
                </div>
              );
            })}

            {/* Standalone edit rows */}
            {sortedStandalone.map((edit) => {
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

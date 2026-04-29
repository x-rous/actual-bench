"use client";

import { formatMonthLabel, prevMonth } from "@/lib/budget/monthMath";
import { useMonthData } from "../../hooks/useMonthData";
import { useEffectiveMonthData } from "../../hooks/useEffectiveMonthData";
import { formatSigned as fmt } from "../../lib/format";
import { MetricRow } from "./MetricRow";
import type { BudgetCellKey, StagedBudgetEdit } from "../../types";

/**
 * Section 1b of the draft panel: details for a selected group row.
 *
 * Shows the group's effective budgeted/actuals/balance. When any category in
 * this group/month has a staged edit, also surfaces a "Was" / "Diff" pair
 * derived against the server-reported group total.
 */
export function GroupDetailsSection({
  selectedMonth,
  selectedGroupId,
  edits,
}: {
  selectedMonth: string | null;
  selectedGroupId: string | null;
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
}) {
  const { data: effectiveData } = useEffectiveMonthData(selectedMonth);
  const { data: serverData } = useMonthData(selectedMonth);
  const prev = selectedMonth ? prevMonth(selectedMonth) : null;
  const { data: prevMonthData } = useMonthData(prev);

  if (!selectedMonth || !selectedGroupId) return null;

  const effectiveGroup = effectiveData?.groupsById[selectedGroupId];
  const serverGroup = serverData?.groupsById[selectedGroupId];
  const prevGroup = prevMonthData?.groupsById[selectedGroupId];
  const group = effectiveGroup ?? serverGroup;

  if (!group) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        {effectiveData ? "Group not found" : "Loading…"}
      </div>
    );
  }

  // Determine if any staged edits exist for categories in this group+month.
  const groupCatIds = new Set(group.categoryIds);
  const hasEdits = Object.keys(edits).some((key) => {
    const sep = key.indexOf(":");
    return (
      sep !== -1 &&
      key.slice(0, sep) === selectedMonth &&
      groupCatIds.has(key.slice(sep + 1))
    );
  });

  const wasBudgeted = serverGroup?.budgeted ?? group.budgeted;
  const diff = group.budgeted - wasBudgeted;

  return (
    <div className="px-3 py-2">
      <div className="mb-2 pb-2 border-b border-border/40">
        <div className="font-semibold text-sm truncate leading-tight">{group.name}</div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {group.isIncome ? "Income group" : "Expense group"}
        </div>
        <div className="text-[10px] text-muted-foreground/60 mt-1 font-sans tabular-nums">
          {formatMonthLabel(selectedMonth, "long")}
        </div>
      </div>

      <div className="space-y-1.5">
        <MetricRow label="Budgeted" value={fmt(group.budgeted)} />
        <MetricRow label="Actuals" value={fmt(Math.abs(group.actuals))} />
        <MetricRow
          label="Balance"
          value={fmt(group.balance)}
          valueClass={
            group.balance < 0
              ? "text-destructive"
              : group.balance > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : undefined
          }
        />
        {prevGroup !== undefined && (
          <MetricRow label="Prev month" value={fmt(prevGroup.budgeted)} />
        )}

        {hasEdits && (
          <>
            <div className="h-px bg-border/50 my-1" />
            <MetricRow label="Was" value={fmt(wasBudgeted)} />
            <MetricRow
              label="Diff"
              value={`${diff >= 0 ? "+" : ""}${fmt(diff)}`}
              valueClass={
                diff >= 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-destructive"
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

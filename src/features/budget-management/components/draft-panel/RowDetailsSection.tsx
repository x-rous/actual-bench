"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useBudgetMode } from "../../hooks/useBudgetMode";
import { useIncomeBudgets } from "../../hooks/useIncomeBudgets";
import { budgetMonthDataQueryOptions } from "../../lib/monthDataQuery";
import { computeEffectiveMonthState } from "../../lib/effectiveMonth";
import { formatSigned as fmt } from "../../lib/format";
import { MetricRow } from "./MetricRow";
import type { BudgetMode, RowSelection } from "../../types";

// ─── Sparkline (per-month bar series, mirrors YearSummary's SparkRow) ─────────

function SparkRow({
  label,
  values,
  barClass,
  balanceMode = false,
}: {
  label: string;
  values: (number | null)[];
  barClass?: string;
  balanceMode?: boolean;
}) {
  const max = Math.max(0, ...values.map((v) => (v !== null ? Math.abs(v) : 0)));

  return (
    <div>
      <span className="text-[10px] text-muted-foreground mb-1 block">{label}</span>
      <div className="flex items-end gap-px h-5">
        {values.map((v, i) => {
          if (v === null) {
            return <div key={i} className="flex-1 h-[2px] rounded-[1px] bg-muted/40" />;
          }
          const absV = Math.abs(v);
          const pct = max > 0 ? absV / max : 0;
          const heightPx = Math.max(2, Math.round(pct * 20));
          const cls = balanceMode
            ? v >= 0
              ? "bg-emerald-500/60 dark:bg-emerald-400/50"
              : "bg-destructive/60"
            : barClass ?? "bg-primary/60";
          return (
            <div key={i} className="flex-1 flex flex-col justify-end h-5">
              <div className={`rounded-[1px] ${cls}`} style={{ height: `${heightPx}px` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Aggregate computation ────────────────────────────────────────────────────

type RowAggregate = {
  budgeted: number;
  actuals: number;
  balance: number;
  /** Sum of staged deltas in this row across visible months (0 when no edits). */
  stagedDelta: number;
  /** Per-month series for the sparklines; null when the month is missing or row is absent. */
  budgetedSeries: (number | null)[];
  actualsSeries: (number | null)[];
  balanceSeries: (number | null)[];
  /** Display label (group/category name). */
  label: string;
  /** Sub-label rendered under the title. */
  subLabel: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Row-level summary section for a selected category or category group.
 *
 * Aggregates budgeted / actuals / balance across **all visible months** and
 * surfaces per-month sparklines for each. When staged edits exist for cells
 * in this row, also shows Was/Diff against the server-reported total.
 *
 * Sits in `BudgetDraftPanel` which is mounted outside the workspace's
 * `MonthsDataProvider`, so this component runs its own `useQueries` —
 * cache-shared with the workspace via the canonical query key, so months
 * already loaded by the grid hit the cache without refetching.
 */
export function RowDetailsSection({
  row,
  displayMonths,
  availableMonths,
}: {
  row: RowSelection;
  displayMonths: string[];
  availableMonths: string[];
}) {
  const connection = useConnectionStore(selectActiveInstance);
  const { data: budgetModeRaw } = useBudgetMode();
  const budgetMode: BudgetMode = budgetModeRaw ?? "unidentified";
  const isTracking = budgetMode === "tracking";

  const queries = useQueries({
    queries: displayMonths.map((m) => ({
      ...budgetMonthDataQueryOptions(connection, m),
      enabled: !!connection && !!m,
    })),
  });

  const dataArr = queries.map((q) => q.data);
  const isLoading = queries.some((q) => q.isLoading);

  const incomeCategoryIds = useMemo(() => {
    for (const d of dataArr) {
      if (d) {
        return Object.values(d.categoriesById)
          .filter((c) => c.isIncome)
          .map((c) => c.id);
      }
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dataArr);

  const { data: incomeBudgets } = useIncomeBudgets(incomeCategoryIds, isTracking);
  const allEdits = useBudgetEditsStore((s) => s.edits);

  const availableSet = useMemo(() => new Set(availableMonths), [availableMonths]);

  const aggregate = useMemo<RowAggregate | null>(() => {
    let budgeted = 0;
    let actuals = 0;
    let balance = 0;
    let stagedDelta = 0;
    const budgetedSeries: (number | null)[] = [];
    const actualsSeries: (number | null)[] = [];
    const balanceSeries: (number | null)[] = [];
    let label = "";
    let subLabel = "";
    let foundAny = false;

    for (let i = 0; i < displayMonths.length; i++) {
      const month = displayMonths[i]!;
      if (!availableSet.has(month)) {
        budgetedSeries.push(null);
        actualsSeries.push(null);
        balanceSeries.push(null);
        continue;
      }
      const serverState = dataArr[i];
      if (!serverState) {
        budgetedSeries.push(null);
        actualsSeries.push(null);
        balanceSeries.push(null);
        continue;
      }
      const effective = computeEffectiveMonthState({
        serverState,
        allEdits,
        isTracking,
        incomeBudgets,
        month,
      });
      if (!effective) {
        budgetedSeries.push(null);
        actualsSeries.push(null);
        balanceSeries.push(null);
        continue;
      }

      if (row.kind === "category") {
        const cat = effective.categoriesById[row.id];
        if (!cat) {
          budgetedSeries.push(null);
          actualsSeries.push(null);
          balanceSeries.push(null);
          continue;
        }
        foundAny = true;
        if (!label) {
          label = cat.name;
          subLabel = cat.groupName;
        }
        budgeted += cat.budgeted;
        actuals += cat.actuals;
        balance += cat.balance;
        budgetedSeries.push(cat.budgeted);
        actualsSeries.push(cat.actuals);
        balanceSeries.push(cat.balance);

        const editKey = `${month}:${row.id}` as const;
        const edit = allEdits[editKey];
        if (edit) stagedDelta += edit.nextBudgeted - edit.previousBudgeted;
      } else {
        // group
        const grp = effective.groupsById[row.id];
        if (!grp) {
          budgetedSeries.push(null);
          actualsSeries.push(null);
          balanceSeries.push(null);
          continue;
        }
        foundAny = true;
        if (!label) {
          label = grp.name;
          subLabel = grp.isIncome ? "Income group" : "Expense group";
        }
        budgeted += grp.budgeted;
        actuals += grp.actuals;
        balance += grp.balance;
        budgetedSeries.push(grp.budgeted);
        actualsSeries.push(grp.actuals);
        balanceSeries.push(grp.balance);

        // Sum staged deltas for any category in this group for this month.
        for (const catId of grp.categoryIds) {
          const editKey = `${month}:${catId}` as const;
          const edit = allEdits[editKey];
          if (edit) stagedDelta += edit.nextBudgeted - edit.previousBudgeted;
        }
      }
    }

    if (!foundAny) return null;

    return {
      budgeted,
      actuals,
      balance,
      stagedDelta,
      budgetedSeries,
      actualsSeries,
      balanceSeries,
      label,
      subLabel,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, displayMonths, availableSet, allEdits, isTracking, incomeBudgets, ...dataArr]);

  if (isLoading && !aggregate) {
    return (
      <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!aggregate) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        {row.kind === "group" ? "Group" : "Category"} not found in any visible month.
      </div>
    );
  }

  const hasEdits = aggregate.stagedDelta !== 0;
  const wasBudgeted = aggregate.budgeted - aggregate.stagedDelta;

  return (
    <div className="px-3 py-2 space-y-3">
      {/* Header */}
      <div className="pb-2 border-b border-border/40">
        <div className="font-semibold text-sm truncate leading-tight">{aggregate.label}</div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">{aggregate.subLabel}</div>
        <div className="text-[10px] text-muted-foreground/60 mt-1 font-sans tabular-nums">
          All visible months ({displayMonths.length})
        </div>
      </div>

      {/* Aggregate metrics */}
      <div className="space-y-1.5">
        <MetricRow label="Budgeted" value={fmt(aggregate.budgeted)} />
        <MetricRow label="Actuals" value={fmt(Math.abs(aggregate.actuals))} />
        <MetricRow
          label="Balance"
          value={fmt(aggregate.balance)}
          valueClass={
            aggregate.balance < 0
              ? "text-destructive"
              : aggregate.balance > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : undefined
          }
        />

        {hasEdits && (
          <>
            <div className="h-px bg-border/50 my-1" />
            <MetricRow label="Was" value={fmt(wasBudgeted)} />
            <MetricRow
              label="Diff"
              value={`${aggregate.stagedDelta >= 0 ? "+" : ""}${fmt(aggregate.stagedDelta)}`}
              valueClass={
                aggregate.stagedDelta >= 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-destructive"
              }
            />
          </>
        )}
      </div>

      {/* Sparklines: Budgeted / Actuals / Balance per month */}
      <div className="border-t border-border/40 pt-2 space-y-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Monthly Trend
        </p>
        <SparkRow
          label="Budgeted"
          values={aggregate.budgetedSeries}
          barClass="bg-primary/60"
        />
        <SparkRow
          label="Actuals"
          values={aggregate.actualsSeries.map((v) => (v !== null ? Math.abs(v) : null))}
          barClass="bg-destructive/60"
        />
        <SparkRow label="Balance" values={aggregate.balanceSeries} balanceMode />
      </div>
    </div>
  );
}

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
import type { BudgetMode, LoadedMonthState } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtYearRange(displayMonths: string[]): string {
  const first = displayMonths[0];
  const last = displayMonths[displayMonths.length - 1];
  if (!first || !last) return "";
  const [y1, m1] = first.split("-");
  const [y2, m2] = last.split("-");
  const year1 = parseInt(y1 ?? "2026", 10);
  const mo1 = parseInt(m1 ?? "1", 10);
  const year2 = parseInt(y2 ?? "2026", 10);
  const mo2 = parseInt(m2 ?? "12", 10);
  if (year1 === year2) return String(year1);
  const d1 = new Date(year1, mo1 - 1, 1);
  const d2 = new Date(year2, mo2 - 1, 1);
  const f = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
  return `${f.format(d1)} – ${f.format(d2)}`;
}

// ─── SparkRow ─────────────────────────────────────────────────────────────────

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
            return (
              <div key={i} className="flex-1 h-[2px] rounded-[1px] bg-muted/40" />
            );
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

// ─── Display ──────────────────────────────────────────────────────────────────

type MonthEntry = { month: string; state: LoadedMonthState };

function YearSummaryDisplay({
  displayMonths,
  monthsData,
  budgetMode,
  isLoading,
}: {
  displayMonths: string[];
  monthsData: MonthEntry[];
  budgetMode: BudgetMode;
  isLoading: boolean;
}) {
  const isEnvelope = budgetMode === "envelope";
  const availableSet = useMemo(
    () => new Set(monthsData.map((d) => d.month)),
    [monthsData]
  );

  const yearRangeLabel = useMemo(() => fmtYearRange(displayMonths), [displayMonths]);

  const totals = useMemo(() => {
    let expBudgeted = 0;
    let expSpent = 0;
    let incReceived = 0;
    let incBudgeted = 0;
    let overallTracking = 0;
    let lastState: LoadedMonthState | undefined;

    for (const { state } of monthsData) {
      expBudgeted += Math.abs(state.summary.totalBudgeted);
      expSpent += Math.abs(state.summary.totalSpent);
      incReceived += state.summary.totalIncome;
      overallTracking += state.summary.totalBalance;
      lastState = state;

      const monthIncBudgeted = Object.values(state.groupsById)
        .filter((g) => g.isIncome)
        .reduce((s, g) => s + g.budgeted, 0);
      incBudgeted += monthIncBudgeted;
    }

    const overall = isEnvelope ? lastState?.summary.toBudget ?? 0 : overallTracking;

    return { expBudgeted, expSpent, incReceived, incBudgeted, overall };
  }, [monthsData, isEnvelope]);

  const sparkExpenses = displayMonths.map((m) => {
    if (!availableSet.has(m)) return null;
    return Math.abs(monthsData.find((d) => d.month === m)?.state.summary.totalSpent ?? 0);
  });

  const sparkIncome = displayMonths.map((m) => {
    if (!availableSet.has(m)) return null;
    return monthsData.find((d) => d.month === m)?.state.summary.totalIncome ?? 0;
  });

  const sparkBalance = displayMonths.map((m) => {
    if (!availableSet.has(m)) return null;
    const entry = monthsData.find((d) => d.month === m);
    if (!entry) return null;
    return isEnvelope ? entry.state.summary.toBudget : entry.state.summary.totalBalance;
  });

  if (isLoading && monthsData.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (monthsData.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
        No data available
      </div>
    );
  }

  const { overall } = totals;

  return (
    <div className="px-3 py-2 space-y-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Period Summary
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{yearRangeLabel}</p>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-foreground/70 mb-1">Expenses</p>
        <div className="space-y-1">
          <MetricRow label="Budgeted" value={fmt(totals.expBudgeted)} />
          <MetricRow label="Spent" value={fmt(totals.expSpent)} />
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-foreground/70 mb-1">Income</p>
        <div className="space-y-1">
          {!isEnvelope && (
            <MetricRow label="Budgeted" value={fmt(totals.incBudgeted)} />
          )}
          <MetricRow label="Received" value={fmt(totals.incReceived)} />
        </div>
      </div>

      <div className="border-t border-border/40 pt-2">
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-[11px] font-semibold text-foreground/80">
            {isEnvelope ? "To Budget" : "Result"}
          </span>
          <span
            className={`font-sans tabular-nums text-right text-sm font-semibold ${
              overall > 0
                ? "text-emerald-700 dark:text-emerald-400"
                : overall < 0
                ? "text-destructive"
                : "text-foreground"
            }`}
          >
            {fmt(overall)}
          </span>
        </div>
      </div>

      <div className="border-t border-border/40 pt-2 space-y-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Monthly Trend
        </p>
        <SparkRow label="Expenses" values={sparkExpenses} barClass="bg-destructive/60" />
        <SparkRow
          label="Income"
          values={sparkIncome}
          barClass="bg-emerald-500/60 dark:bg-emerald-400/50"
        />
        <SparkRow label="Balance" values={sparkBalance} balanceMode />
      </div>
    </div>
  );
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Loads each visible month with `useQueries` (BM-01) and computes the
 * effective state once per month using the shared cascade helper. Sits in
 * the draft panel which is rendered outside the workspace's
 * `MonthsDataProvider`, so it cannot read from that context.
 */
export function YearSummaryDataLoader({
  displayMonths,
  availableMonths,
}: {
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

  // Single subscription to the edits map at this loader level (not per-month).
  const allEdits = useBudgetEditsStore((s) => s.edits);

  const availableSet = useMemo(() => new Set(availableMonths), [availableMonths]);

  const monthsData = useMemo<MonthEntry[]>(() => {
    const entries: MonthEntry[] = [];
    for (let i = 0; i < displayMonths.length; i++) {
      const month = displayMonths[i]!;
      if (!availableSet.has(month)) continue;
      const serverState = dataArr[i];
      if (!serverState) continue;
      const effective = computeEffectiveMonthState({
        serverState,
        allEdits,
        isTracking,
        incomeBudgets,
        month,
      });
      if (effective) entries.push({ month, state: effective });
    }
    return entries;
    // dataArr identity is fresh each render but its element references are
    // stable when underlying TanStack Query data is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMonths, availableSet, allEdits, isTracking, incomeBudgets, ...dataArr]);

  return (
    <YearSummaryDisplay
      displayMonths={displayMonths}
      monthsData={monthsData}
      budgetMode={budgetMode}
      isLoading={isLoading}
    />
  );
}

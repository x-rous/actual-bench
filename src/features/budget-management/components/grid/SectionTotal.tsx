"use client";

import { useEffectiveMonthFromContext } from "../../context/MonthsDataContext";
import { formatMinor } from "../../lib/format";
import type { BudgetMode, CellView } from "../../types";

export type SectionFilter = "expense" | "income";

const SECTION_LABELS: Record<SectionFilter, Record<CellView, string>> = {
  expense: {
    budgeted: "Total Budgeted Expenses",
    spent: "Total Spent Expenses",
    balance: "Total Expense Variance",
  },
  income: {
    budgeted: "Total Budgeted Income",
    spent: "Total Received Income",
    balance: "Total Income Variance",
  },
};

function SectionTotalCell({
  month,
  filter,
  cellView,
  budgetMode,
}: {
  month: string;
  filter: SectionFilter;
  cellView: CellView;
  budgetMode: BudgetMode;
}) {
  const data = useEffectiveMonthFromContext(month);
  if (!data) {
    return <div className="h-8 bg-muted/15 border-b border-border/50 animate-pulse" />;
  }

  // In Envelope mode the income section always sums actuals (received).
  const effectiveView =
    budgetMode === "envelope" && filter === "income" ? "spent" : cellView;

  let total: number;

  if (budgetMode === "tracking") {
    // Tracking: sum category-level values, excluding hidden groups and hidden cats.
    const cats = data.groupOrder
      .map((id) => data.groupsById[id]!)
      .filter((g) => !g.hidden && (filter === "expense" ? !g.isIncome : g.isIncome))
      .flatMap((g) =>
        g.categoryIds
          .map((catId) => data.categoriesById[catId])
          .filter((c): c is NonNullable<typeof c> => !!c && !c.hidden)
      );
    total =
      effectiveView === "spent"
        ? cats.reduce((sum, c) => sum + c.actuals, 0)
        : effectiveView === "balance"
        ? cats.reduce((sum, c) => sum + c.balance, 0)
        : cats.reduce((sum, c) => sum + c.budgeted, 0);
  } else {
    // Envelope: group-level aggregates include all hidden rows.
    const groups = data.groupOrder
      .map((id) => data.groupsById[id]!)
      .filter((g) => (filter === "expense" ? !g.isIncome : g.isIncome));
    total =
      effectiveView === "spent"
        ? groups.reduce((sum, g) => sum + g.actuals, 0)
        : effectiveView === "balance"
        ? groups.reduce((sum, g) => sum + g.balance, 0)
        : groups.reduce((sum, g) => sum + g.budgeted, 0);
  }

  return (
    <div className="h-8 px-2 flex items-center justify-end bg-muted/15 border-b border-border/50 text-xs font-sans tabular-nums font-semibold text-foreground">
      {formatMinor(total)}
    </div>
  );
}

export function SectionTotalRow({
  filter,
  cellView,
  budgetMode,
  activeMonths,
}: {
  filter: SectionFilter;
  cellView: CellView;
  budgetMode: BudgetMode;
  activeMonths: string[];
}) {
  // In Envelope mode the income section always uses the "received" label.
  const effectiveView =
    budgetMode === "envelope" && filter === "income" ? "spent" : cellView;
  const label = SECTION_LABELS[filter][effectiveView];
  return (
    <>
      <div
        className="h-8 px-3 flex items-center bg-background border-b border-border/50 text-xs font-semibold text-foreground/80 sticky left-0 z-10"
        role="rowheader"
      >
        {label}
      </div>
      <div className="h-8 bg-muted/15 border-b border-border/50" aria-hidden="true" />
      {activeMonths.map((month) => (
        <SectionTotalCell
          key={month}
          month={month}
          filter={filter}
          cellView={cellView}
          budgetMode={budgetMode}
        />
      ))}
    </>
  );
}

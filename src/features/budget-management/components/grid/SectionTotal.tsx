"use client";

import { useEffectiveMonthFromContext } from "../../context/MonthsDataContext";
import { formatMinor } from "../../lib/format";
import {
  calculateSectionTotal,
  getSectionEffectiveView,
  type SectionFilter,
} from "../../lib/sectionTotals";
import type { BudgetMode, CellView } from "../../types";

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
    return (
      <div
        className="h-8 min-h-8 bg-muted/15 border-b border-border/50 animate-pulse"
      />
    );
  }

  // In Envelope mode the income section always sums actuals (received).
  const total = calculateSectionTotal({
    state: data,
    filter,
    cellView,
    budgetMode,
  });

  return (
    <div
      className="h-8 min-h-8 px-2 flex items-center justify-end whitespace-nowrap bg-muted/15 border-b border-border/50 text-xs font-sans tabular-nums font-semibold text-foreground"
    >
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
  const effectiveView = getSectionEffectiveView({
    budgetMode,
    filter,
    cellView,
  });
  const label = SECTION_LABELS[filter][effectiveView];
  return (
    <>
      <div
        className="h-8 min-h-8 min-w-0 px-3 flex items-center bg-background border-b border-border/50 text-xs font-semibold text-foreground/80 sticky left-0 z-10"
        role="rowheader"
        title={label}
      >
        <span className="truncate whitespace-nowrap">{label}</span>
      </div>
      <div
        className="h-8 min-h-8 bg-muted/15 border-b border-border/50"
        aria-hidden="true"
      />
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

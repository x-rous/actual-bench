"use client";

import type { ReactNode } from "react";
import {
  useEffectiveMonthFromContext,
  useRawMonthFromContext,
} from "../../context/MonthsDataContext";
import { formatSummary } from "../../lib/format";
import {
  getTrackingExpenseVariance,
  getTrackingExpenseVarianceLabel,
  getTrackingExpenseVarianceTooltip,
  getTrackingResultLabel,
  getTrackingResultTooltip,
  getTrackingResultValue,
  getTrackingSummaryTotals,
} from "../../lib/trackingSummary";
import type { BudgetMonthSummary, LoadedMonthState } from "../../types";
import { FreeHeldAmountButton, HoldMoneyButton } from "./HoldToggle";

// ─── Config type ──────────────────────────────────────────────────────────────

export type SummaryRowConfig = {
  /** Row-header label. ReactNode so configs can supply rich (multi-color) labels. */
  label: ReactNode;
  /** Per-cell mini-label rendered above the value. */
  dynamicLabel?: (
    s: BudgetMonthSummary,
    state: LoadedMonthState,
    month: string
  ) => ReactNode;
  getDynamicRowLabel?: (s: BudgetMonthSummary) => ReactNode;
  getValue: (
    s: BudgetMonthSummary,
    state: LoadedMonthState,
    month: string
  ) => number | null;
  tooltip?: (
    s: BudgetMonthSummary,
    state: LoadedMonthState,
    month: string,
    value: number | null
  ) => string;
  colorClass?: (
    s: BudgetMonthSummary,
    state: LoadedMonthState,
    month: string,
    value: number | null
  ) => string;
  isConsumptionBar?: boolean;
  getActual?: (s: BudgetMonthSummary, state: LoadedMonthState) => number;
  getTarget?: (s: BudgetMonthSummary, state: LoadedMonthState) => number;
  barMode?: "expense" | "income";
  /** Compact input row — rendered smaller to group visually under a total row. */
  isSubRow?: boolean;
  /** Operator prefix shown in the label cell to convey formula structure (+, −, =). */
  operator?: "+" | "−" | "=";
  /** Override the default row height Tailwind class. */
  rowHeight?: string;
  /** Suppress the top border that normally appears on non-sub, non-bar rows. */
  noBorder?: boolean;
  /** Renders a per-month hold/free action inside the envelope summary cell. */
  holdAction?: "set" | "free";
  /** When true, the per-month value is rendered larger and bold so the row's
   *  bottom-line total stands out (e.g. tracking "Balance", envelope "To Budget"). */
  emphasizeValue?: boolean;
};

const INCOME_BAR_GREEN_THRESHOLD = 0.995;

/**
 * Static dual-color label rendered for the envelope "To Budget / Overbudget"
 * row. The "To Budget" half is always green and "Overbudget" half is always
 * red — the per-cell value below still flips colour via `colorClass` based on
 * each month's actual sign.
 */
const TO_BUDGET_OVERBUDGET_LABEL: ReactNode = (
  <>
    <span className="text-emerald-600 dark:text-emerald-400">To Budget</span>
    <span className="text-muted-foreground/60"> / </span>
    <span className="text-destructive">Overbudget</span>
  </>
);

// ─── Per-mode configs ─────────────────────────────────────────────────────────

export const TRACKING_SUMMARY_ROWS: SummaryRowConfig[] = [
  {
    label: "Expenses",
    getValue: (s) => s.totalSpent,
    isConsumptionBar: true,
    barMode: "expense",
    getActual: (_s, state) => getTrackingSummaryTotals(state).expenseActuals,
    getTarget: (_s, state) =>
      getTrackingSummaryTotals(state).expenseBudgeted,
  },
  {
    label: "Income",
    getValue: (s) => s.totalIncome,
    isConsumptionBar: true,
    barMode: "income",
    getActual: (_s, state) => getTrackingSummaryTotals(state).incomeActuals,
    getTarget: (_s, state) =>
      getTrackingSummaryTotals(state).incomeBudgeted,
  },
  {
    label: "Expense Variance",
    dynamicLabel: (_s, state, month) =>
      getTrackingExpenseVarianceLabel(state, month),
    getValue: (_s, state, month) =>
      getTrackingExpenseVariance(state, month),
    tooltip: (_s, state, month) =>
      getTrackingExpenseVarianceTooltip(state, month),
    colorClass: (_s, _state, _month, value) =>
      value == null
        ? "text-muted-foreground"
        : value >= 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive",
  },
  {
    label: "Result",
    dynamicLabel: (_s, state, month) => getTrackingResultLabel(state, month),
    getValue: (_s, state, month) => getTrackingResultValue(state, month),
    tooltip: (_s, state, month) => getTrackingResultTooltip(state, month),
    colorClass: (_s, _state, _month, value) =>
      (value ?? 0) >= 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive",
    rowHeight: "h-10",
    noBorder: true,
    emphasizeValue: true,
  },
];

export const ENVELOPE_SUMMARY_ROWS: SummaryRowConfig[] = [
  {
    label: "Available Funds",
    getValue: (s) => s.incomeAvailable,
    colorClass: () => "text-foreground/75",
    isSubRow: true,
    operator: "+",
  },
  {
    label: "Overspent Last Month",
    getValue: (s) => s.lastMonthOverspent,
    colorClass: () => "text-foreground/75",
    isSubRow: true,
    operator: "−",
  },
  {
    label: "Budgeted",
    getValue: (s) => s.totalBudgeted,
    colorClass: () => "text-foreground/75",
    isSubRow: true,
    operator: "−",
  },
  {
    label: "Hold for next month",
    getValue: (s) => (s.forNextMonth <= 0 ? 0 : Math.abs(s.forNextMonth)),
    colorClass: () => "text-foreground/75",
    isSubRow: true,
    operator: "−",
    holdAction: "free",
  },
  {
    // Row-header (left column) only: dual-color "To Budget / Overbudget"
    // label with green / red halves. Per-month cells show just the numeric
    // value, coloured by `colorClass` based on each month's sign.
    label: TO_BUDGET_OVERBUDGET_LABEL,
    getValue: (s) => s.toBudget,
    colorClass: (s) =>
      s.toBudget < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
    operator: "=",
    noBorder: true,
    holdAction: "set",
    emphasizeValue: true,
  },
];

// ─── ConsumptionBarCell ───────────────────────────────────────────────────────

function ConsumptionBarCell({
  month,
  config,
}: {
  month: string;
  config: SummaryRowConfig;
}) {
  const data = useEffectiveMonthFromContext(month);
  if (!data) return <div className="h-10 bg-transparent" />;

  const actual = config.getActual ? config.getActual(data.summary, data) : 0;
  const target = config.getTarget ? config.getTarget(data.summary, data) : 0;
  const ratio = target > 0 ? actual / target : 0;
  const pct = Math.max(0, Math.min(ratio * 100, 100));

  const isExpense = config.barMode === "expense";
  const barColor = isExpense
    ? ratio <= 1
      ? "bg-emerald-500"
      : "bg-red-500"
    : ratio >= INCOME_BAR_GREEN_THRESHOLD
    ? "bg-emerald-500"
    : "bg-amber-400";

  const ratioText = target > 0 ? `${Math.round(ratio * 100)}%` : "—";
  const tooltipText =
    target > 0
      ? `${isExpense ? "Spent" : "Received"}: ${formatSummary(actual)}  /  Budgeted: ${formatSummary(target)}`
      : "No budget set";

  return (
    <div
      className="h-10 px-2 pt-1.5 pb-1.5 flex flex-col gap-0.5 bg-transparent font-sans tabular-nums"
      title={tooltipText}
    >
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-[10px] text-foreground/80 shrink-0">{formatSummary(actual)}</span>
        <span className="text-[10px] text-muted-foreground/60 shrink-0">({ratioText})</span>
      </div>
      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── SummaryHeaderRow + SummaryHeaderCell ─────────────────────────────────────

export function SummaryHeaderRow({
  config,
  activeMonths,
}: {
  config: SummaryRowConfig;
  activeMonths: string[];
}) {
  const firstMonthData = useRawMonthFromContext(activeMonths[0] ?? null);
  const rowLabel =
    config.getDynamicRowLabel && firstMonthData
      ? config.getDynamicRowLabel(firstMonthData.summary)
      : config.label;

  const isSubRow = config.isSubRow;
  const rowH = config.rowHeight ?? (config.isConsumptionBar ? "h-10" : isSubRow ? "h-5" : "h-8");
  // Total row gets a top border to visually separate it from the sub-rows above.
  const borderClass =
    !isSubRow && !config.isConsumptionBar && !config.noBorder
      ? "border-t border-border/60"
      : "";

  return (
    <>
      <div
        className={`${rowH} px-3 flex items-center bg-background text-[11px] text-foreground/75 sticky left-0 z-10 ${borderClass}`}
        role="rowheader"
      >
        {config.operator && (
          <span className="mr-1.5 w-3 shrink-0 text-center text-[10px] text-muted-foreground/50 font-mono select-none">
            {config.operator}
          </span>
        )}
        <span className={config.operator === "=" ? "font-semibold" : ""}>{rowLabel}</span>
      </div>
      <div className={`${rowH} bg-transparent ${borderClass}`} aria-hidden="true" />
      {activeMonths.map((month) =>
        config.isConsumptionBar ? (
          <ConsumptionBarCell key={month} month={month} config={config} />
        ) : (
          <SummaryHeaderCell key={month} month={month} config={config} />
        )
      )}
    </>
  );
}

function SummaryHeaderCell({
  month,
  config,
}: {
  month: string;
  config: SummaryRowConfig;
}) {
  const data = useEffectiveMonthFromContext(month);
  const isSubRow = config.isSubRow;
  const rowH = config.rowHeight ?? (isSubRow ? "h-6" : "h-8");
  const borderClass =
    !isSubRow && !config.isConsumptionBar && !config.noBorder
      ? "border-t border-border/60"
      : "";

  if (!data) return <div className={`${rowH} bg-transparent ${borderClass}`} />;

  const value = config.getValue(data.summary, data, month);
  const dynamicLabel = config.dynamicLabel
    ? config.dynamicLabel(data.summary, data, month)
    : null;
  const colorClass = config.colorClass
    ? config.colorClass(data.summary, data, month, value)
    : "text-foreground/75";
  const tooltip = config.tooltip
    ? config.tooltip(data.summary, data, month, value)
    : undefined;
  // Emphasised rows render the number a touch larger and bold so totals
  // stand out from the sub-rows above. Other rows keep the inherited
  // `text-[11px]` from the parent cell.
  const valueClass = config.emphasizeValue ? "text-[13px] font-bold" : "";

  if (config.holdAction) {
    const numericValue = value ?? 0;
    const showBalanced = config.holdAction === "set" && numericValue === 0;
    return (
      <div
        className={`${rowH} px-1.5 flex items-center justify-end gap-1 bg-transparent font-sans tabular-nums leading-tight text-[11px] ${borderClass} ${colorClass}`}
        title={tooltip}
      >
        <div className="flex flex-col items-end flex-1 min-w-0">
          {dynamicLabel && (
            <span className="max-w-full truncate text-[9px] font-semibold leading-none mb-0.5">
              {dynamicLabel}
            </span>
          )}
          <span className={valueClass}>
            {showBalanced
              ? `✓ ${formatSummary(numericValue)}`
              : formatSummary(numericValue)}
          </span>
        </div>
        {config.holdAction === "set" ? (
          <HoldMoneyButton
            month={month}
            forNextMonth={data.summary.forNextMonth}
            toBudget={data.summary.toBudget}
          />
        ) : (
          <FreeHeldAmountButton
            month={month}
            forNextMonth={data.summary.forNextMonth}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`${rowH} px-2 flex flex-col items-end justify-center bg-transparent font-sans tabular-nums leading-tight text-[11px] ${borderClass} ${colorClass}`}
      title={tooltip}
    >
      {dynamicLabel && (
        <span className="max-w-full truncate text-[9px] font-semibold leading-none mb-0.5">
          {dynamicLabel}
        </span>
      )}
      <span className={valueClass}>
        {value == null ? "—" : formatSummary(value)}
      </span>
    </div>
  );
}

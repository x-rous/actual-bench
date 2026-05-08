"use client";

import type { ReactNode } from "react";
import {
  useEffectiveMonthFromContext,
  useRawMonthFromContext,
} from "../../context/MonthsDataContext";
import { formatSummary } from "../../lib/format";
import {
  getTrackingIncomeCell,
  getTrackingResultCell,
  getTrackingSpendingCell,
} from "../../lib/trackingSummary";
import type { BudgetMonthSummary, LoadedMonthState } from "../../types";
import { FreeHeldAmountButton, HoldMoneyButton } from "./HoldToggle";
import {
  formatSummaryCellValue,
  summaryLabelClass,
  summaryToneClass,
  type SummaryCellMetric,
} from "./summaryDisplay";

// ─── Config type ──────────────────────────────────────────────────────────────

export type SummaryRowConfig = {
  /** Row-header label. ReactNode so configs can supply rich (multi-color) labels. */
  label: ReactNode;
  /** Tooltip for the sticky row label. */
  rowTooltip?: string;
  /** Fully derived per-month display model for semantic status rows. */
  getCell?: (
    s: BudgetMonthSummary,
    state: LoadedMonthState,
    month: string
  ) => SummaryCellMetric;
  /** Per-cell mini-label rendered above the value. */
  dynamicLabel?: (
    s: BudgetMonthSummary,
    state: LoadedMonthState,
    month: string
  ) => ReactNode;
  getDynamicRowLabel?: (s: BudgetMonthSummary) => ReactNode;
  getValue?: (
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
  /** Optional value class override for rows that need a stronger emphasis. */
  valueClassName?: string;
  /** Tiny top margin before the row. */
  marginTop?: boolean;
};

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
    label: "Spending vs Budgeted",
    rowTooltip: "Expenses compared with budgeted expenses.",
    getCell: (_s, state, month) => getTrackingSpendingCell(state, month),
    noBorder: true,
    marginTop: true,
  },
  {
    label: "Income",
    rowTooltip: "Received income compared with budgeted income.",
    getCell: (_s, state, month) => getTrackingIncomeCell(state, month),
    noBorder: true,
  },
  {
    label: "Result",
    rowTooltip:
      "Actual saved/overspent for past months; projected result for current/future months.",
    getCell: (_s, state, month) => getTrackingResultCell(state, month),
    rowHeight: "h-10",
    noBorder: true,
    emphasizeValue: true,
    valueClassName: "text-[13px] font-bold",
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
  const rowH = config.rowHeight ?? (isSubRow ? "h-5" : "h-8");
  // Total row gets a top border to visually separate it from the sub-rows above.
  const borderClass =
    !isSubRow && !config.noBorder
      ? "border-t border-border/60"
      : "";
  const marginTopClass = config.marginTop ? "mt-1" : "";

  return (
    <>
      <div
        className={`${rowH} px-3 ${marginTopClass} flex items-center bg-background text-[11px] font-medium text-foreground/75 sticky left-0 z-10 ${borderClass}`}
        role="rowheader"
        title={config.rowTooltip}
      >
        {config.operator && (
          <span className="mr-1.5 w-3 shrink-0 text-center text-[10px] text-muted-foreground/50 font-mono select-none">
            {config.operator}
          </span>
        )}
        <span className={config.operator === "=" ? "font-semibold" : ""}>{rowLabel}</span>
      </div>
      {activeMonths.map((month) => (
        <SummaryHeaderCell key={month} month={month} config={config} />
      ))}
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
    !isSubRow && !config.noBorder
      ? "border-t border-border/60"
      : "";
  const marginTopClass = config.marginTop ? "mt-1" : "";

  if (!data) return <div className={`${rowH} ${marginTopClass} bg-transparent ${borderClass}`} />;

  const cell = config.getCell?.(data.summary, data, month);
  const value = cell
    ? cell.value
    : config.getValue
      ? config.getValue(data.summary, data, month)
      : null;
  const dynamicLabel = cell?.label
    ? cell.label
    : config.dynamicLabel
    ? config.dynamicLabel(data.summary, data, month)
    : null;
  const colorClass = cell
    ? "text-foreground/75"
    : config.colorClass
    ? config.colorClass(data.summary, data, month, value)
    : "text-foreground/75";
  const tooltip = cell?.tooltip
    ? cell.tooltip
    : config.tooltip
    ? config.tooltip(data.summary, data, month, value)
    : undefined;
  // Emphasised rows render the number a touch larger and bold so totals
  // stand out from the sub-rows above. Other rows keep the inherited
  // `text-[11px]` from the parent cell.
  const valueClass =
    config.valueClassName ?? (config.emphasizeValue ? "text-[13px] font-bold" : "");
  const labelClass = cell
    ? summaryLabelClass(cell.tone)
    : "";
  const valueToneClass = cell ? summaryToneClass(cell.tone) : "";

  if (config.holdAction) {
    const numericValue = value ?? 0;
    const showBalanced = config.holdAction === "set" && numericValue === 0;
    return (
      <div
        className={`${rowH} px-1.5 ${marginTopClass} flex items-center justify-end gap-1 bg-transparent font-sans tabular-nums leading-tight text-[11px] ${borderClass} ${colorClass}`}
        title={tooltip}
      >
        <div className="flex flex-col items-end flex-1 min-w-0">
          {dynamicLabel && (
            <span className="max-w-full truncate text-[9px] font-medium leading-none mb-0.5">
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
      className={`${rowH} px-2 ${marginTopClass} flex flex-col items-end justify-center bg-transparent font-sans tabular-nums leading-tight text-[11px] ${borderClass} ${colorClass}`}
      title={tooltip}
    >
      {dynamicLabel && (
        <span
          className={`max-w-full truncate text-[9px] font-medium leading-none mb-0.5 ${labelClass}`}
        >
          {dynamicLabel}
        </span>
      )}
      <span className={`${valueClass} ${valueToneClass}`}>
        {cell
          ? formatSummaryCellValue(cell)
          : value == null
            ? "—"
            : formatSummary(value)}
      </span>
    </div>
  );
}

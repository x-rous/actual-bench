"use client";

import { useMemo, useState } from "react";
import { CalendarRange, FolderOpen } from "lucide-react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MultiSearchableCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { MonthRangePicker } from "@/components/ui/monthrangepicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FIELD_FOCUS, FIELD_OPEN } from "@/components/ui/field-focus";
import { formatMonthLabel, parseMonth } from "@/lib/budget/monthMath";
import { cn } from "@/lib/utils";
import type { BudgetTransactionCategoryOption } from "../../../lib/budgetTransactionBrowser";
import { optionKeyOf } from "../../../lib/varianceInvestigation/varianceScope";

/*
 * The category picker and the period control are the ones Spending Analysis
 * uses, set up the same way, so the two dialogs filter alike. The small
 * wrappers below mirror that dialog's own, which are private to it.
 */

const SELECT_CLASS = `h-7 min-w-0 rounded-md border border-input bg-background px-2 text-[11px] outline-none transition-colors disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-60 dark:bg-input/30 ${FIELD_FOCUS} ${FIELD_OPEN}`;
const EMPTY: string[] = [];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-2">
      <span className="shrink-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** How many categories the figures cover, and on hover or focus, which. */
function SelectionSummaryBadge({
  count,
  selected,
  fallbackTitle,
}: {
  count: number;
  selected: BudgetTransactionCategoryOption[] | null;
  fallbackTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const label = count === 1 ? "1 category" : `${count.toLocaleString()} categories`;
  return (
    <span className="relative flex h-7 shrink-0 items-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        className="whitespace-nowrap rounded text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {label}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-50 mt-0.5 block max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-popover p-2 text-xs shadow-md">
          {selected === null ? (
            <span className="block text-muted-foreground">{fallbackTitle}</span>
          ) : (
            selected.map((option) => (
              <span key={optionKeyOf(option)} className="block truncate text-foreground">
                {option.title}
                {option.entity === "group" && <span className="text-muted-foreground"> · group</span>}
              </span>
            ))
          )}
        </span>
      )}
    </span>
  );
}

function MonthRangeField({
  monthStart,
  monthEnd,
  availableMonths,
  onChange,
}: {
  monthStart: string;
  monthEnd: string;
  availableMonths: string[];
  onChange: (monthStart: string, monthEnd: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const toDate = (month: string): Date => {
    const [year, mo] = parseMonth(month);
    return new Date(year, mo - 1, 1);
  };
  const toMonth = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const first = availableMonths[0];
  const last = availableMonths[availableMonths.length - 1];
  const label =
    monthStart === monthEnd
      ? formatMonthLabel(monthStart, "long")
      : `${formatMonthLabel(monthStart, "long")} - ${formatMonthLabel(monthEnd, "long")}`;

  // The ranges worth one click, anchored on the real clock like the spending dialog's.
  const quickSelectors = useMemo(() => {
    if (!first || !last) return [];
    const now = new Date();
    const year = now.getFullYear();
    const monthsBack = (count: number) => new Date(year, now.getMonth() - count + 1, 1);
    return [
      { label: "This year", startMonth: new Date(year, 0), endMonth: new Date(year, 11) },
      { label: "Year to date", startMonth: new Date(year, 0), endMonth: new Date(year, now.getMonth()) },
      { label: "Last 12 months", startMonth: monthsBack(12), endMonth: new Date(year, now.getMonth()) },
      { label: "Last 6 months", startMonth: monthsBack(6), endMonth: new Date(year, now.getMonth()) },
      { label: "Last year", startMonth: new Date(year - 1, 0), endMonth: new Date(year - 1, 11) },
    ];
  }, [first, last]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(SELECT_CLASS, "inline-flex w-[15rem] items-center justify-between gap-2 text-left")}
            aria-label={`Months shown: ${label}. Change the range`}
            title="Change the months shown"
          >
            <span className="truncate tabular-nums">{label}</span>
            <CalendarRange className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <MonthRangePicker
          selectedMonthRange={monthStart && monthEnd ? { start: toDate(monthStart), end: toDate(monthEnd) } : undefined}
          minDate={first ? toDate(first) : undefined}
          maxDate={last ? toDate(last) : undefined}
          quickSelectors={quickSelectors}
          showQuickSelectors={quickSelectors.length > 0}
          onMonthRangeSelect={({ start, end }) => {
            onChange(toMonth(start), toMonth(end));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

type Props = {
  options: BudgetTransactionCategoryOption[];
  /** Picker keys, or `null` while the dialog is on the scope it opened with. */
  selectedKeys: string[] | null;
  /** What the picker says before it has been touched. */
  placeholder: string;
  coveredKeys: ReadonlySet<string>;
  exclusiveKeys: ReadonlySet<string>;
  summary: string | undefined;
  selectedOptions: BudgetTransactionCategoryOption[] | null;
  categoryCount: number;
  onSelectionChange: (keys: string[]) => void;
  monthStart: string;
  monthEnd: string;
  availableMonths: string[];
  onRangeChange: (monthStart: string, monthEnd: string) => void;
  /** "Closed months", "Includes the current month", or nothing. */
  periodNote: string | null;
  description: string;
};

export function VarianceHeader(props: Props) {
  const pickerOptions = useMemo<ComboboxOption[]>(
    () =>
      props.options.map((option) => ({
        id: optionKeyOf(option),
        name: option.title,
        ...(option.entity === "group" ? { isGroupHeader: true as const } : {}),
      })),
    [props.options]
  );

  return (
    <DialogHeader className="shrink-0 border-b border-border bg-background px-5 py-2.5 pr-12">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <DialogTitle className="flex h-7 shrink-0 items-center text-base leading-none">Variance Drivers</DialogTitle>
        <DialogDescription className="sr-only">{props.description}</DialogDescription>

        <Field label="Categories">
          <div className="flex min-w-0 items-center gap-2">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex w-[22rem] max-w-full min-w-0">
              <MultiSearchableCombobox
                options={pickerOptions}
                values={props.selectedKeys ?? EMPTY}
                onChange={props.onSelectionChange}
                placeholder={props.placeholder}
                summary={props.summary}
                coveredIds={props.coveredKeys}
                exclusiveIds={props.exclusiveKeys}
                onClear={() => props.onSelectionChange([])}
                selectableGroups
                ariaLabel="Select categories or category groups"
                triggerClassName="min-h-7 py-0.5"
              />
            </div>
          </div>
        </Field>
        <SelectionSummaryBadge count={props.categoryCount} selected={props.selectedOptions} fallbackTitle={props.placeholder} />

        <Field label="Period">
          <MonthRangeField
            monthStart={props.monthStart}
            monthEnd={props.monthEnd}
            availableMonths={props.availableMonths}
            onChange={props.onRangeChange}
          />
        </Field>
        {props.periodNote && <span className="text-[11px] text-muted-foreground">{props.periodNote}</span>}
      </div>
    </DialogHeader>
  );
}

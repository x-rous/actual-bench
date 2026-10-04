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
import { optionKey } from "../budgetTransactionsDialog.helpers";

/*
 * The header Spending Analysis and Variance Drivers share: title, category
 * picker, a read-only list of what is selected, and the period control. One
 * implementation, so the two dialogs filter alike and cannot drift apart.
 */

const SELECT_CLASS = `h-7 min-w-0 rounded-md border border-input bg-background px-2 text-[11px] outline-none transition-colors disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-60 dark:bg-input/30 ${FIELD_FOCUS} ${FIELD_OPEN}`;
const EMPTY_SELECTION: string[] = [];
const EMPTY_MONTHS: string[] = [];

/**
 * A labelled header control.
 *
 * The two controls that decide what the dialog is showing used to sit
 * unlabelled among the buttons, so what they selected had to be inferred from
 * their contents. An uppercase caption above each one says what the value
 * underneath is choosing before it is read.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    /*
      The row centres boxes, not text, so items of different type sizes only
      line up if their boxes match. Pinning every item in the header to the
      control height makes that true by construction, rather than leaving a
      caption, a title and a 28px control to find their own centres.
    */
    <div className="flex h-7 min-w-0 items-center gap-2">
      <span className="shrink-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * How many categories the figures cover, and - on demand - which ones.
 *
 * Opens on hover for the glance and on focus for the keyboard, so the list is
 * reachable without a mouse. Read-only: removing is what the picker's own rows
 * and the trigger's clear button are for, and a popover that appears on hover
 * is a poor place to put a click target.
 */
function SelectionSummaryBadge({
  count,
  selected,
  fallbackTitle,
}: {
  count: number;
  selected: BudgetTransactionCategoryOption[] | null;
  /** What the dialog is reporting on when the picker has not been touched. */
  fallbackTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const label = count === 1 ? "1 category" : `${count.toLocaleString()} categories`;
  const groups = (selected ?? []).filter((option) => option.entity === "group");
  const categories = (selected ?? []).filter((option) => option.entity === "category");

  return (
    <span
      className="relative flex h-7 shrink-0 items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
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
            <>
              {groups.length > 0 && (
                <>
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Groups
                  </span>
                  {groups.map((option) => (
                    <span key={optionKey(option)} className="block truncate text-foreground">
                      {option.title}
                    </span>
                  ))}
                </>
              )}
              {categories.length > 0 && (
                <>
                  <span
                    className={cn(
                      "block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
                      groups.length > 0 ? "mb-1 mt-2" : "mb-1"
                    )}
                  >
                    Categories
                  </span>
                  {categories.map((option) => (
                    <span key={optionKey(option)} className="block truncate text-foreground">
                      {option.title}
                    </span>
                  ))}
                </>
              )}
            </>
          )}
        </span>
      )}
    </span>
  );
}



/**
 * The header's month range control: a label that opens the range picker.
 *
 * A popover rather than two fields inline, because the range is a single idea
 * and reading it as one phrase - "Jan 2026 - Aug 2026" - is what tells someone
 * what the figures beside it cover.
 *
 * Quick selectors are given rather than left to the component's defaults: the
 * useful ranges here are the ones the budget itself has, not "last 6 months".
 */
function MonthRangeField({
  monthStart,
  monthEnd,
  availableMonths,
  disabled,
  onChange,
}: {
  monthStart: string;
  monthEnd: string;
  /** Months the budget window holds, oldest first. Bounds the picker. */
  availableMonths: string[];
  disabled?: boolean;
  onChange: (monthStart: string, monthEnd: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const toDate = (month: string): Date => {
    const [year, mo] = parseMonth(month);
    return new Date(year, mo - 1, 1);
  };
  const toMonth = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

  const first = availableMonths[0];
  const last = availableMonths[availableMonths.length - 1];
  const label =
    monthStart === monthEnd
      ? formatMonthLabel(monthStart, "long")
      : `${formatMonthLabel(monthStart, "long")} - ${formatMonthLabel(monthEnd, "long")}`;

  /*
   * The ranges worth one click, ordered widest to narrowest.
   *
   * "This year" is the whole calendar year including months not yet reached;
   * "Year to date" stops at the current one. They are different questions -
   * what is planned for the year against what has actually happened - and a
   * budget is one of the few places both get asked.
   *
   * Anchored on the real clock rather than the window, so they keep meaning
   * what they say when the window is somewhere else entirely.
   */
  const quickSelectors = useMemo(() => {
    if (!first || !last) return [];
    const now = new Date();
    const year = now.getFullYear();
    const monthsBack = (count: number) =>
      new Date(year, now.getMonth() - count + 1, 1);

    return [
      { label: "This year", startMonth: new Date(year, 0), endMonth: new Date(year, 11) },
      { label: "Year to date", startMonth: new Date(year, 0), endMonth: new Date(year, now.getMonth()) },
      { label: "Last 12 months", startMonth: monthsBack(12), endMonth: new Date(year, now.getMonth()) },
      { label: "Last 6 months", startMonth: monthsBack(6), endMonth: new Date(year, now.getMonth()) },
      { label: "Last year", startMonth: new Date(year - 1, 0), endMonth: new Date(year - 1, 11) },
    ];
    // `first` and `last` bound the window; the rest is clock-derived and stable
    // for the life of the dialog.
  }, [first, last]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              SELECT_CLASS,
              // `inline-flex` is the fix, not decoration: SELECT_CLASS styles a
              // <select>, which lays its own content out. On a <button> the
              // label and the icon are just two blocks, so they stacked.
              "inline-flex w-[15rem] items-center justify-between gap-2 text-left"
            )}
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
          selectedMonthRange={
            monthStart && monthEnd
              ? { start: toDate(monthStart), end: toDate(monthEnd) }
              : undefined
          }
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
  title: string;
  description: string;
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
  /** Months the budget holds, oldest first. Bounds the period picker. */
  availableMonths: string[] | undefined;
  periodDisabled?: boolean;
  onRangeChange: (monthStart: string, monthEnd: string) => void;
  /** "Closed months", "Includes the current month", or nothing. */
  periodNote?: string | null;
};

export function AnalysisHeader(props: Props) {
  /*
   * The picker's rows: each group followed by its own categories, indented
   * under it. The options list already arrives in that order, so the shape of
   * the menu is the shape of the budget.
   */
  const pickerOptions = useMemo<ComboboxOption[]>(
    () =>
      props.options.map((option) => ({
        id: optionKey(option),
        name: option.title,
        ...(option.entity === "group" ? { isGroupHeader: true as const } : {}),
      })),
    [props.options]
  );

  return (
    <DialogHeader className="shrink-0 border-b border-border bg-background px-5 py-2.5 pr-12">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <DialogTitle className="flex h-7 shrink-0 items-center text-base leading-none">{props.title}</DialogTitle>
        <DialogDescription className="sr-only">{props.description}</DialogDescription>

        <Field label="Categories">
          <div className="flex min-w-0 items-center gap-2">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex w-[22rem] max-w-full min-w-0">
              <MultiSearchableCombobox
                options={pickerOptions}
                values={props.selectedKeys ?? EMPTY_SELECTION}
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

        <SelectionSummaryBadge
          count={props.categoryCount}
          selected={props.selectedOptions}
          fallbackTitle={props.placeholder}
        />

        <Field label="Period">
          <MonthRangeField
            monthStart={props.monthStart}
            monthEnd={props.monthEnd}
            availableMonths={props.availableMonths ?? EMPTY_MONTHS}
            disabled={props.periodDisabled}
            onChange={props.onRangeChange}
          />
        </Field>
        {props.periodNote && <span className="text-[11px] text-muted-foreground">{props.periodNote}</span>}
      </div>
    </DialogHeader>
  );
}

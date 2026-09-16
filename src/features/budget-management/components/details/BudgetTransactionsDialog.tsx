"use client";

import { useMemo, useState, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type FilterFn,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarRange,
  Clock3,
  Upload,
  FolderOpen,
  Search,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PillGroup } from "@/components/ui/pill-group";
import { MultiSearchableCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatMonthLabel, monthsInRange, parseMonth } from "@/lib/budget/monthMath";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MonthRangePicker } from "@/components/ui/monthrangepicker";
import {
  amountTone,
  elapsedDaysInMonths,
  errorMessage,
  exportTransactionsCsv,
  optionKey,
  nextBucketSelection,
  rowBucketLabel,
  rowTimeBucketId,
  type TimeBucketDimension,
  EXPENSE_ACCENT,
  INCOME_ACCENT,
  type Accent,
  type BreakdownDimension,
} from "./budgetTransactionsDialog.helpers";
import {
  BREAKDOWN_LABELS,
  Panel,
  SpendBreakdown,
  WeeklySpending,
} from "./BudgetTransactionsPanels";
import { useAvailableMonths } from "../../hooks/useAvailableMonths";
import { useBudgetMonthStates } from "../../hooks/useBudgetMonthStates";
import { useBudgetTransactions } from "../../hooks/useBudgetTransactions";
import {
  buildGroupBreakdown,
  buildSpendBreakdown,
  buildTimeBreakdown,
  buildTransactionTotals,
} from "../../lib/budgetTransactionAnalytics";
// The table keeps its cents - a single transaction is where they are the
// point. Everything else in the dialog is a total or an average, read as a
// column of figures, and rounds like the details panel behind it.
import { formatDelta, formatSignedWhole } from "../../lib/format";
import {
  buildTransactionSearchIndex,
  formatTransactionDateLabel,
  matchesTransactionSearch,
  normalizeTransactionSearch,
} from "../../lib/budgetTransactionTable";
import type {
  BudgetTransactionBrowserOptions,
  BudgetTransactionCategoryOption,
  BudgetTransactionsDrilldown,
  BudgetTransactionSide,
} from "../../lib/budgetTransactionBrowser";
import type { BudgetTransactionRow } from "../../lib/budgetTransactionsQuery";

type Props = {
  target: BudgetTransactionsDrilldown | null;
  browserOptions: BudgetTransactionBrowserOptions;
  /*
   * No `statesByMonth` here on purpose.
   *
   * The dialog used to be handed the details panel's twelve loaded months, and
   * every budget figure it draws came from that map - so its correctness was
   * bounded by wherever the page behind it had been navigated, and the month
   * picker had to be clamped to the same window to stop it offering periods
   * whose plan could not be read. It fetches its own now, for whatever range is
   * on screen. The range it can show and the range it can account for are the
   * same set because asking for a month is what loads it.
   */
  onClose: () => void;
};

const EMPTY_TRANSACTION_ROWS: BudgetTransactionRow[] = [];
const EMPTY_CATEGORY_IDS: string[] = [];
const EMPTY_SELECTION: string[] = [];
const EMPTY_MONTHS: string[] = [];
const EMPTY_FILTERS: string[] = [];
const SELECT_CLASS =
  "h-7 min-w-0 rounded-md border border-input bg-background px-2 text-[11px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-60 dark:bg-input/30";


// ─── column setup ─────────────────────────────────────────────────────────────

/*
 * Column widths, fixed rather than measured.
 *
 * The table only mounts the rows in view, so an auto-layout table would size
 * its columns to whatever happens to be on screen - and every scroll would
 * bring a different longest payee into the window and shift every column
 * sideways. Fixed widths make the layout independent of what is mounted, which
 * is what lets the windowing be invisible. Notes takes what is left.
 */
const COLUMN_WIDTHS: Record<string, string> = {
  date: "w-[7.5rem]",
  payee: "w-[14rem]",
  category: "w-[14rem]",
  amount: "w-[7rem]",
};

/** Row height the virtualiser assumes before it measures the real thing. */
const TABLE_ROW_HEIGHT = 33;

const columnHelper = createColumnHelper<BudgetTransactionRow>();


const columns = [
  columnHelper.accessor("date", {
    header: "Date",
    cell: ({ getValue }) => (
      <span title={getValue()}>{formatTransactionDateLabel(getValue())}</span>
    ),
    sortingFn: "alphanumeric",
  }),
  // Sort by magnitude so the biggest movements lead regardless of side — the
  // largest outflow for expenses, the largest inflow for income.
  columnHelper.accessor((row) => Math.abs(row.amount), {
    id: "amount",
    header: "Amount",
    cell: ({ row }) => (
      <span className={cn("font-sans font-semibold tabular-nums", amountTone(row.original.amount))}>
        {formatDelta(row.original.amount)}
      </span>
    ),
    sortingFn: "basic",
  }),
  columnHelper.accessor((row) => row.payeeName ?? "", {
    id: "payee",
    header: "Payee",
    cell: ({ row }) => (
      <span
        className={cn(
          "block truncate font-medium",
          row.original.payeeName ? "text-foreground" : "italic text-muted-foreground"
        )}
        title={row.original.payeeName ?? "No payee"}
      >
        {row.original.payeeName ?? "No payee"}
      </span>
    ),
    sortingFn: "text",
  }),
  columnHelper.accessor((row) => row.categoryName ?? "", {
    id: "category",
    header: "Category",
    cell: ({ row }) => (
      <span
        className="block truncate text-muted-foreground"
        title={row.original.categoryName ?? "Uncategorized"}
      >
        {row.original.categoryName ?? "Uncategorized"}
      </span>
    ),
    sortingFn: "text",
  }),
  columnHelper.accessor((row) => row.notes ?? "", {
    id: "notes",
    header: "Notes",
    cell: ({ row }) => (
      <span
        className="block truncate text-muted-foreground"
        title={row.original.notes ?? ""}
      >
        {row.original.notes ?? ""}
      </span>
    ),
    sortingFn: "text",
  }),
];

/**
 * Substring test against the prebuilt index, not a fresh format of every row.
 *
 * The index is handed in through the filter value so the function itself stays
 * stable at module level - TanStack re-runs the whole filter model whenever the
 * function identity changes, which would undo the saving on every render.
 */
type TransactionSearchFilter = { query: string; index: Map<string, string> };

const transactionSearchFilter: FilterFn<BudgetTransactionRow> = (
  row,
  _columnId,
  filterValue: TransactionSearchFilter
) => {
  const search = normalizeTransactionSearch(filterValue?.query ?? "");
  if (!search) return true;
  const text = filterValue.index.get(row.original.id);
  // A row missing from the index is one the index has not caught up with, so
  // fall back to formatting it rather than dropping it from the results.
  return text !== undefined
    ? text.includes(search)
    : matchesTransactionSearch(row.original, search);
};
transactionSearchFilter.autoRemove = (value: TransactionSearchFilter) =>
  !value?.query;

// ─── primitives ───────────────────────────────────────────────────────────────

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
 * A trailing figure in the summary strip - a count, an average, a verdict.
 *
 * All of them share a minimum width so they read as columns of one set rather
 * than as figures packed to whatever their own digits needed. The verdict and
 * the per-day rate are the narrow ones, and left to size themselves they sat
 * noticeably tighter than the transaction count beside them.
 */
function StripItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  /** Colour for the value, where the figure carries a judgement. */
  tone?: string;
}) {
  return (
    /*
      The end items drop their outer padding. Keeping it made the gap from the
      pill to the first figure the row gap *plus* 16px - half again the gap on
      the bar's other side - and left the last figure stopping short of the edge
      the rest of the dialog lines up on. The padding between items stays, since
      that is what the dividers need.
    */
    <div className="flex min-w-24 shrink-0 flex-col items-center px-4 first:pl-0 last:pr-0">
      <div
        className={cn(
          "truncate font-sans text-base font-semibold tabular-nums",
          tone ?? "text-foreground"
        )}
      >
        {value}
      </div>
      <div className="whitespace-nowrap text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * How far through the plan this period got, as a line rather than a number.
 *
 * The strip used to set Spent, Budgeted and Variance side by side as three
 * equal figures and leave the reader to do the subtraction and the division.
 * The bar answers "how far in" at a glance and the pill answers "and is that a
 * problem", which is the pair of questions the three numbers were standing in
 * for. The budget sits at a marker rather than at the end of the track, so
 * overspend has somewhere to go: the track scales to whichever of the two is
 * larger, and the part beyond the marker is drawn in the warning colour.
 */
function BudgetProgress({
  actual,
  budgeted,
  accent,
}: {
  actual: number;
  budgeted: number;
  accent: Accent;
}) {
  /*
   * A net figure can come out negative - a month whose refunds outweigh its
   * spending - and a negative width draws nothing at all rather than an empty
   * track. Clamping at zero says "none of the plan used", which is what a net
   * inflow against an expense budget actually means.
   */
  const filled = Math.max(actual, 0);
  const isOver = filled > budgeted;
  const scale = Math.max(filled, budgeted, 1);
  const withinPct = (Math.min(filled, budgeted) / scale) * 100;
  const overPct = isOver ? ((filled - budgeted) / scale) * 100 : 0;
  /*
   * The marker only exists when there is something past it.
   *
   * Under budget, the track's scale *is* the budget, so a marker at the
   * budgeted figure lands exactly on the right-hand edge - a stray tick
   * abutting the end of the bar, marking a boundary the bar's own end already
   * marks. Overspend is the only case where the budget sits somewhere inside
   * the track and needs pointing at.
   */
  const markerPct = isOver ? (budgeted / scale) * 100 : null;

  /*
   * Which side of the marker the figure sits on.
   *
   * Left by default, over the within-budget fill. When the marker is close to
   * the start - spending far past a small budget - there is no room there, so
   * it moves over the overspend instead. Both are filled, so the label is on
   * colour either way and takes the matching foreground.
   */
  const labelOnLeft = markerPct !== null && markerPct >= 30;

  /*
   * A fixed width, not a share of the row.
   *
   * As the flexible item it absorbed whatever the row had left, so every change
   * in a neighbour's text - a verdict going from "9.4% over budget" to "0.03%
   * below target" - lengthened or shortened the bar by that much. A bar whose
   * length means "how far through the plan" cannot also change length for
   * reasons that have nothing to do with the plan. It still shrinks below this
   * on a narrow viewport, since overflowing would be worse.
   */
  return (
    <div className="relative mr-2 flex h-10 w-[32rem] min-w-0 shrink flex-col justify-center">
      {/*
        The empty part of the track has to read as a trough, not as background.
        `bg-muted` sits a few percent off the strip behind it, so an under-budget
        bar looked like a coloured stub floating on nothing - the very case where
        the remaining room is the thing worth seeing. A stronger fill plus an
        inset hairline gives it an edge in both themes.
      */}
      <div
        role="progressbar"
        aria-valuemin={0}
        // The scale, not the plan: overspend puts the filled amount past the
        // budget, and a `valuenow` above `valuemax` is not a valid range. The
        // text below says which of the two the reader is hearing.
        aria-valuemax={Math.round(scale)}
        aria-valuenow={Math.round(filled)}
        aria-valuetext={`${formatSignedWhole(filled)} of ${formatSignedWhole(budgeted)} budgeted`}
        className="relative h-5 overflow-hidden rounded-full bg-muted-foreground/15 ring-1 ring-inset ring-border"
      >
        <div className="absolute inset-0 flex">
          <div
            className={cn("h-full transition-[width]", accent.solid)}
            style={{ width: `${withinPct}%` }}
          />
          {overPct > 0 && (
            <div
              className={cn("h-full transition-[width]", accent.over)}
              style={{ width: `${overPct}%` }}
            />
          )}
        </div>
        {markerPct !== null && (
          <>
            <span
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/45"
              style={{ left: `${markerPct}%` }}
              aria-hidden="true"
            />
            {/*
              The budgeted figure, on the marker it belongs to. It used to sit
              on its own line under the track, which put the number a row away
              from the thing it labelled and cost the strip a line to do it.
            */}
            <span
              className={cn(
                "absolute top-1/2 -translate-y-1/2 whitespace-nowrap px-1.5 text-[10px] font-medium tabular-nums",
                labelOnLeft ? "-translate-x-full text-right" : "",
                labelOnLeft ? accent.onSolid : accent.onOver
              )}
              style={{ left: `${markerPct}%` }}
            >
              {formatSignedWhole(budgeted)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The verdict on the period, as one of the figures rather than a pill beside
 * them.
 *
 * It used to be a filled, bordered badge in a strong colour, which made the
 * smallest number in the strip the loudest thing in it - a 0.03% shortfall
 * shouted as hard as a 40% overspend. As a figure it takes the same shape as
 * the counts next to it and says the same things: the amount on top, and the
 * share of plan it represents underneath, where the other figures put their
 * label. Only the colour marks it out, and only where colour is warranted -
 * expense overspend in the destructive tone, income falling short in amber,
 * both favourable cases in emerald.
 */
function varianceTone(variance: number, isIncome: boolean): string {
  if (variance >= 0) return "text-emerald-700 dark:text-emerald-400";
  return isIncome
    ? "text-amber-700 dark:text-amber-400"
    : "text-destructive";
}

function varianceLabel(variance: number, budgeted: number, isIncome: boolean): string {
  const favorable = variance >= 0;
  // Share of plan, not of actual: "17.7% over budget" is 17.7% of what was
  // planned, which is the figure a reader can act on.
  const pct = budgeted > 0 ? (Math.abs(variance) / budgeted) * 100 : 0;
  const noun = isIncome
    ? favorable
      ? "above target"
      : "below target"
    : favorable
      ? "under budget"
      : "over budget";
  return `${pct.toFixed(1)}% ${noun}`;
}

function FilterChip({
  label,
  accent,
  onClear,
}: {
  label: string;
  accent: Accent;
  onClear: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
        accent.tint,
        accent.text
      )}
    >
      {label}
      <button
        type="button"
        aria-label={`Remove filter: ${label}`}
        className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
        onClick={onClear}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
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


function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="text-sm font-medium text-foreground">Loading transactions</div>
        <div className="mt-1 text-xs text-muted-foreground">Fetching read-only transaction rows.</div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

// ─── dialog ───────────────────────────────────────────────────────────────────

export function BudgetTransactionsDialog({ target, browserOptions, onClose }: Props) {
  /*
   * The breakdown and chart selections, each a set rather than a single id.
   *
   * A plain click still means "show me this one", because that is what a click
   * on a chart means everywhere. Holding Ctrl (or Cmd) adds and removes, so two
   * categories or three months can be compared against each other without
   * having to pick a parent that contains them and nothing else.
   */
  const [spendFilters, setSpendFilters] = useState<string[]>(EMPTY_FILTERS);
  const [weekFilters, setWeekFilters] = useState<string[]>(EMPTY_FILTERS);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "amount", desc: true }]);
  const [activeTarget, setActiveTarget] = useState<BudgetTransactionsDrilldown | null>(target);

  /*
   * Which categories and groups the dialog is reporting on.
   *
   * `null` means "whatever was clicked" - the drill-through's own target,
   * untouched. Once the picker is used it holds option keys, and those are what
   * the dialog reports on instead. Groups are kept as group keys rather than
   * expanded into their members at selection time: a chip reading "Food &
   * Groceries" is the selection the user made, and eleven category chips would
   * be the same fact spelled out in a form nobody chose.
   */
  const [selectedKeys, setSelectedKeys] = useState<string[] | null>(null);

  const open = target != null;
  const baseTarget = activeTarget ?? target;

  // The picker only offers options on the same side as the drill-through, so
  // an income selection can never acquire an expense category. Anchored to the
  // base target rather than the derived one, which the options help build.
  const baseSide: BudgetTransactionSide = baseTarget?.side ?? "expense";
  const categoryOptions = useMemo(
    () => browserOptions.categories.filter((option) => option.side === baseSide),
    [browserOptions.categories, baseSide]
  );

  const selectedOptions = useMemo(() => {
    if (!selectedKeys || selectedKeys.length === 0) return null;
    const byKey = new Map(categoryOptions.map((option) => [optionKey(option), option]));
    const resolved = selectedKeys
      .map((key) => byKey.get(key))
      .filter((option): option is BudgetTransactionCategoryOption => option != null);
    return resolved.length > 0 ? resolved : null;
  }, [selectedKeys, categoryOptions]);

  /*
   * The target as the rest of the dialog sees it: the clicked one until the
   * picker says otherwise, then a synthesis of everything selected.
   *
   * Selected groups contribute their members, and the union is taken through a
   * Set - picking a group and then one of its own categories is a thing a
   * person will do, and it must not count those transactions twice.
   */
  const effectiveTarget = useMemo<BudgetTransactionsDrilldown | null>(() => {
    if (!baseTarget) return null;
    if (!selectedOptions) return baseTarget;

    const categoryIds = new Set<string>();
    for (const option of selectedOptions) {
      for (const id of option.categoryIds) categoryIds.add(id);
    }

    return {
      ...baseTarget,
      // Identity is the selection itself, sorted so that picking the same two
      // groups in the other order is recognised as the same view and does not
      // reset the filters underneath it.
      id: selectedOptions.map(optionKey).sort().join("|"),
      title: selectedOptions.map((option) => option.title).join(", "),
      entity: categoryIds.size > 1 ? "group" : "category",
      side: baseSide,
      categoryIds: [...categoryIds],
    };
  }, [baseTarget, selectedOptions, baseSide]);

  const { data, isLoading, error } = useBudgetTransactions({
    monthStart: effectiveTarget?.monthStart ?? "",
    monthEnd: effectiveTarget?.monthEnd ?? "",
    categoryIds: effectiveTarget?.categoryIds ?? EMPTY_CATEGORY_IDS,
    enabled: open && effectiveTarget != null,
  });

  // Months the current range covers, oldest first. Drives the budgeted total,
  // the "when" panel's buckets, and the range label.
  const rangeMonths = useMemo(
    () =>
      effectiveTarget
        ? monthsInRange(effectiveTarget.monthStart, effectiveTarget.monthEnd)
        : [],
    [effectiveTarget]
  );
  const isRange = rangeMonths.length > 1;

  const [timingBy, setTimingBy] = useState<"time" | "weekday">("time");

  /*
   * The vocabulary the "when" chart is currently drawn in, and therefore the one
   * its selection has to be matched against.
   *
   * Derived once and threaded through, rather than each filter re-deriving it
   * from a boolean: that boolean could say whether the range spanned months, and
   * nothing at all about the weekday view, so a weekday selection was compared
   * against week ids and matched nothing.
   */
  const timeDimension: TimeBucketDimension =
    timingBy === "weekday" ? "weekday" : isRange ? "month" : "week";

  /*
   * The months the figures describe, once a selection in the timing chart is
   * taken into account.
   *
   * A budget is a monthly thing, so selecting March in a twelve-month range is
   * as real a narrowing as selecting a category, and every figure that divides
   * or compares by month has to follow it. Weeks and weekdays are deliberately
   * excluded: nothing is budgeted for "Week 2" or for "Tuesdays", so narrowing
   * the spend there while the plan stayed whole would compare five days against
   * a month.
   */
  const activeMonths = useMemo(() => {
    if (timingBy !== "time" || !isRange || weekFilters.length === 0) return rangeMonths;
    const selected = new Set(weekFilters);
    const narrowed = rangeMonths.filter((month) => selected.has(month));
    // A selection matching nothing leaves the range alone rather than producing
    // a period of zero months, which would divide by zero downstream.
    return narrowed.length > 0 ? narrowed : rangeMonths;
  }, [timingBy, isRange, weekFilters, rangeMonths]);

  /*
   * The plans behind the figures, for this dialog's own range.
   *
   * Fetched here rather than inherited from the page, so the period the picker
   * offers and the period the budget figures can describe are the same one.
   * The months come back from cache when the page has already loaded or
   * prefetched them, which covers the common case of drilling into the window
   * on screen.
   */
  const { data: availableMonths, isLoading: monthsLoading } = useAvailableMonths();
  const {
    statesByMonth,
    isLoading: plansLoading,
    error: plansError,
  } = useBudgetMonthStates(rangeMonths, availableMonths, monthsLoading);

  const rows = data?.rows ?? EMPTY_TRANSACTION_ROWS;
  const summary = data?.summary ?? null;
  /*
   * Whether the view spans more than one category, which is the only thing this
   * gates: a sub-breakdown by category needs there to be sub-categories. It
   * used to ask whether a *group* had been clicked, which was the same question
   * only while a selection could be one group or one category - a selection of
   * two categories from different groups is neither, and has plenty to break
   * down.
   */
  const isGroup = (effectiveTarget?.categoryIds.length ?? 0) > 1;

  // BM-04: income drill-throughs read as inflow, expense as outflow. The copy
  // and the KPI direction below follow the target's side so income never gets
  // presented through the expense/"spent" lens.
  const side: BudgetTransactionSide = effectiveTarget?.side ?? "expense";
  const isIncome = side === "income";
  const flowNoun = isIncome ? "Income" : "Spending";
  const accent = isIncome ? INCOME_ACCENT : EXPENSE_ACCENT;

  /**
   * Everything the dialog needs to know about the selected categories, from one
   * walk of the loaded months.
   *
   * Four memos used to walk `rangeMonths × categoryIds` separately - the group
   * span, the category-to-group map, the per-row plan and the strip's budgeted
   * total - each asking the same state the same questions and each able to
   * drift from the others when one was changed. They are one pass now, and the
   * figures they produce are guaranteed to describe the same set.
   *
   * A month with no loaded state contributes nothing rather than voiding the
   * total: a gap in the window is a gap in the plan, not a reason to withhold
   * the figure.
   */
  const categoryFacts = useMemo(() => {
    const groupByCategoryId = new Map<string, string>();
    const budgetedByCategory = new Map<string, number>();
    const budgetedByGroup = new Map<string, number>();
    const groupNames = new Set<string>();
    let signedBudgetTotal = 0;
    let hasBudget = false;

    if (effectiveTarget) {
      const wantIncome = side === "income";
      // The shape of the selection is read from the whole range; only the plan
      // narrows, so the breakdown keeps its rows and the Groups pill keeps its
      // reason to exist when a single month is picked.
      const budgetMonths = new Set(activeMonths);
      for (const month of rangeMonths) {
        const state = statesByMonth.get(month);
        if (!state) continue;
        const countsTowardBudget = budgetMonths.has(month);
        for (const id of effectiveTarget.categoryIds) {
          const category = state.categoriesById[id];
          if (!category) continue;
          /*
           * Hidden in this month means it did not contribute in this month.
           *
           * Actual carries `hidden` on the category rather than on the month,
           * so in practice it is the same in every month of a window loaded
           * together - but the state is read per month and the metric this
           * strip compares against skips hidden categories month by month.
           * Asking the same question here keeps the two in step whatever the
           * months turn out to say.
           */
          if (category.hidden) continue;

          // The group map and the span describe the shape of the selection, so
          // they count every category in it regardless of side.
          if (!groupByCategoryId.has(category.id)) {
            groupByCategoryId.set(category.id, category.groupName);
          }
          groupNames.add(category.groupName);

          // The plan only counts on its own side: expense categories carry the
          // expense plan, income categories the income plan.
          if (!countsTowardBudget || category.isIncome !== wantIncome) continue;
          hasBudget = true;
          const budgeted = Math.abs(category.budgeted);
          budgetedByCategory.set(
            category.name,
            (budgetedByCategory.get(category.name) ?? 0) + budgeted
          );
          budgetedByGroup.set(
            category.groupName,
            (budgetedByGroup.get(category.groupName) ?? 0) + budgeted
          );
          signedBudgetTotal += category.budgeted;
        }
      }
    }

    return {
      groupByCategoryId,
      budgetedByCategory,
      budgetedByGroup,
      groupSpan: groupNames.size,
      totalBudgeted: hasBudget ? Math.abs(signedBudgetTotal) : null,
    };
  }, [effectiveTarget, side, rangeMonths, activeMonths, statesByMonth]);

  const groupByCategoryId = categoryFacts.groupByCategoryId;

  /*
   * How many groups the categories on screen actually span.
   *
   * Two or more is what makes a group-level breakdown worth offering: with one,
   * every row would belong to it and the chart would be a single bar restating
   * the total.
   *
   * Counted from the categories rather than from the picker, because the picker
   * is not the only way to get here. A drill-through from a month's "All
   * expenses" figure covers every group in the budget and selects none of them
   * explicitly, so counting picked groups called it zero and withheld the one
   * view that selection is really asking for.
   */
  const groupSpan = categoryFacts.groupSpan;

  // Clear visual + search filters when target or month changes
  useEffect(() => {
    setSpendFilters(EMPTY_FILTERS);
    setWeekFilters(EMPTY_FILTERS);
    setGlobalFilter("");
    // A selection spanning several groups is itself the question "how do these
    // compare", so open on the answer rather than on a list of every category
    // in all of them. One group has nothing to compare, so it opens on its
    // categories as before.
    setBreakdownBy(groupSpan > 1 ? "group" : "category");
  }, [
    effectiveTarget?.id,
    effectiveTarget?.monthStart,
    effectiveTarget?.monthEnd,
    groupSpan,
  ]);

  const [breakdownBy, setBreakdownBy] = useState<BreakdownDimension>("category");

  /*
   * Which dimension the "where" list is actually drawn in, as opposed to which
   * one the toggle last held.
   *
   * A single category has no sub-categories to break into, so it is always
   * payees. And "Groups" is only on offer while two or more groups are
   * selected - deselect one and a toggle still set to it would leave the panel
   * drawing a single bar that restates the total, so it falls back.
   */
  const breakdownDimension: BreakdownDimension = !isGroup
    ? "payee"
    : breakdownBy === "group" && groupSpan < 2
      ? "category"
      : breakdownBy;


  // Rows filtered by spend selection only — drives WeeklySpending (cross-filter)
  const spendFilteredRows = useMemo(() => {
    if (spendFilters.length === 0) return rows;
    // A set, because a selection of twenty categories against thousands of rows
    // would otherwise be a linear scan per row.
    const selected = new Set(spendFilters);
    return rows.filter((row) =>
      selected.has(rowBucketLabel(row, breakdownDimension, groupByCategoryId))
    );
  }, [rows, spendFilters, breakdownDimension, groupByCategoryId]);

  // Rows filtered by week selection only — drives SpendBreakdown (cross-filter)
  const weekFilteredRows = useMemo(() => {
    if (weekFilters.length === 0) return rows;
    const selected = new Set(weekFilters);
    return rows.filter((row) => selected.has(rowTimeBucketId(row.date, timeDimension)));
  }, [rows, weekFilters, timeDimension]);

  /*
   * Rows with both filters — drives the KPIs and the table.
   *
   * Built from a set that is already narrowed rather than from `rows` again.
   * The intersection of two filters was being computed with a third full pass,
   * re-testing the same predicates the two above had just run; starting from
   * `spendFilteredRows` leaves only the week test to apply, over however many
   * rows survived the first. When only one filter is active there is nothing to
   * intersect, so the existing array is handed straight back - same contents
   * and the same identity, which keeps everything downstream from recomputing.
   */
  const visuallyFilteredRows = useMemo(() => {
    if (weekFilters.length === 0) return spendFilteredRows;
    if (spendFilters.length === 0) return weekFilteredRows;
    const selected = new Set(weekFilters);
    return spendFilteredRows.filter((row) =>
      selected.has(rowTimeBucketId(row.date, timeDimension))
    );
  }, [spendFilteredRows, weekFilteredRows, spendFilters, weekFilters, timeDimension]);

  // Analytics for SpendBreakdown — responds to week filter
  const spendBreakdown = useMemo(
    () => buildSpendBreakdown(weekFilteredRows, side),
    [weekFilteredRows, side]
  );

  // Analytics for WeeklySpending — responds to spend/category filter
  const timeBreakdown = useMemo(
    () => buildTimeBreakdown(spendFilteredRows, side),
    [spendFilteredRows, side]
  );

  // Rows for KPIs: only update for category selection (budgets exist at category level),
  // not for payee or week filters (no budget granularity at those levels).
  const kpiRows = useMemo(() => {
    // A payee is not a budget line, so a payee selection leaves the headline
    // figures alone - there is nothing budgeted at that granularity to compare
    // the narrowed spend against. A group or a category has one, so both
    // narrow, and the strip above stays a comparison of like with like.
    const narrowsByBucket =
      isGroup && spendFilters.length > 0 && breakdownDimension !== "payee";
    // A month *is* a budget line, so the strip narrows with it. The budget
    // above narrowed to the same months, so the two stay a comparison of like
    // with like.
    const narrowsByMonth = activeMonths.length < rangeMonths.length;
    if (!narrowsByBucket && !narrowsByMonth) return rows;

    const buckets = narrowsByBucket ? new Set(spendFilters) : null;
    const months = narrowsByMonth ? new Set(activeMonths) : null;
    return rows.filter((row) => {
      if (
        buckets &&
        !buckets.has(rowBucketLabel(row, breakdownDimension, groupByCategoryId))
      ) {
        return false;
      }
      return !months || months.has(row.date.slice(0, 7));
    });
  }, [
    rows,
    spendFilters,
    isGroup,
    breakdownDimension,
    groupByCategoryId,
    activeMonths,
    rangeMonths,
  ]);

  // Headline figures for the strip
  const totals = useMemo(
    () => buildTransactionTotals(kpiRows, side),
    [kpiRows, side]
  );

  const spendByGroup = useMemo(
    () => buildGroupBreakdown(weekFilteredRows, side, groupByCategoryId),
    [weekFilteredRows, side, groupByCategoryId]
  );

  const primaryBreakdown =
    breakdownDimension === "payee"
      ? spendBreakdown.spendByPayee
      : breakdownDimension === "group"
        ? spendByGroup
        : spendBreakdown.spendByCategory;

  /*
   * Timing, likewise. "Over time" says when in the period it happened;
   * "By weekday" says which days of the week it lands on - a habit rather than
   * a date, and one that sharpens as the range grows rather than blurring.
   */
  const timingBuckets =
    timingBy === "weekday"
      ? timeBreakdown.weekdayPattern
      : isRange
        ? timeBreakdown.spendByMonth
        : timeBreakdown.spendByWeek;

  /*
   * The picker's rows: each group followed by its own categories, indented
   * under it. The options list already arrives in that order, so the shape of
   * the menu is the shape of the budget.
   */
  const pickerOptions = useMemo<ComboboxOption[]>(
    () =>
      categoryOptions.map((option) => ({
        id: optionKey(option),
        name: option.title,
        ...(option.entity === "group" ? { isGroupHeader: true as const } : {}),
      })),
    [categoryOptions]
  );

  // What the trigger says before the picker has been touched: the drill-through
  // came from a figure on the page, and that figure's own name is the honest
  // description of what is on screen - including for the synthetic whole-month
  // targets, which have no option to be checked against.
  const pickerPlaceholder = effectiveTarget?.title ?? "Select categories";

  /*
   * Category rows already accounted for by a selected group.
   *
   * They render ticked and inert rather than empty and clickable. An empty box
   * on a row whose transactions are fully counted is simply false, and clicking
   * it changed nothing either way - the ids union through a Set, so a category
   * inside a chosen group adds no transactions when ticked and loses none when
   * unticked. The only thing it did change was the summary, which would then
   * report "1 group + 1 category" for a selection of one group.
   */
  /*
   * The whole-side options - "All expenses", "All income".
   *
   * Exclusive: they already contain everything on their side, so combining one
   * with a category is a selection that cannot mean anything. Clicking one
   * applies it and closes the list.
   */
  const exclusiveKeys = useMemo(
    () =>
      new Set(
        categoryOptions
          .filter((option) => option.id.startsWith("__all_"))
          .map(optionKey)
      ),
    [categoryOptions]
  );

  const coveredCategoryKeys = useMemo(() => {
    const covered = new Set<string>();
    for (const option of selectedOptions ?? []) {
      if (option.entity !== "group") continue;
      for (const id of option.categoryIds) covered.add(`category:${id}`);
    }
    return covered;
  }, [selectedOptions]);

  // How many categories the figures actually cover, after groups are expanded
  // and any overlap between them is removed.
  const selectedCategoryCount = effectiveTarget?.categoryIds.length ?? 0;

  /*
   * One line describing the selection, whatever its size.
   *
   * A single pick says its own name, because at one item the name *is* the
   * summary and a count would be a worse version of it. Past that it counts by
   * kind, which is the distinction the picker is built around: "2 groups" and
   * "2 categories" cover very different amounts of money, and a bare "2
   * selected" would hide that.
   */
  const selectionSummary = useMemo(() => {
    if (!selectedOptions) return undefined;
    if (selectedOptions.length === 1) return selectedOptions[0].title;

    const groups = selectedOptions.filter((option) => option.entity === "group").length;
    const categories = selectedOptions.length - groups;
    const parts: string[] = [];
    if (groups > 0) parts.push(`${groups} ${groups === 1 ? "group" : "groups"}`);
    if (categories > 0) {
      parts.push(`${categories} ${categories === 1 ? "category" : "categories"}`);
    }
    return parts.join(" + ");
  }, [selectedOptions]);
  /*
   * The period the exported rows actually cover.
   *
   * `monthLabel` names the range the dialog is open on, which is the right
   * caption for the header - but the file gets whatever survived the filters,
   * so naming it for the whole range would put a month of transactions in a
   * file called "jan-2026-dec-2026". Non-contiguous selections are named by
   * their ends with a "+" so the name stays short and still says it is partial.
   */
  const exportPeriodLabel = useMemo(() => {
    const first = activeMonths[0];
    const last = activeMonths[activeMonths.length - 1];
    if (!first || !last) return "";
    if (first === last) return formatMonthLabel(first, "long");
    const gapped = activeMonths.length < monthsInRange(first, last).length;
    return `${formatMonthLabel(first, "long")} ${gapped ? "+" : "-"} ${formatMonthLabel(
      last,
      "long"
    )}`;
  }, [activeMonths]);

  const monthLabel = !effectiveTarget
    ? ""
    : isRange
      ? `${formatMonthLabel(effectiveTarget.monthStart, "long")} - ${formatMonthLabel(
          effectiveTarget.monthEnd,
          "long"
        )}`
      : formatMonthLabel(effectiveTarget.monthStart, "long");

  const searchIndex = useMemo(() => buildTransactionSearchIndex(rows), [rows]);
  const searchFilterValue = useMemo(
    () => ({ query: globalFilter, index: searchIndex }),
    [globalFilter, searchIndex]
  );

  const table = useReactTable({
    data: visuallyFilteredRows,
    columns,
    state: { sorting, globalFilter: searchFilterValue },
    onSortingChange: setSorting,
    globalFilterFn: transactionSearchFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const tableRows = table.getRowModel().rows;

  /*
   * Only the rows in view are mounted.
   *
   * Every row used to be put in the DOM - 1,500 of them at the cap, five cells
   * each, and no cap at all once "Load all" is pressed. A year-wide group can
   * run to tens of thousands, which is six figures of DOM nodes and a tab that
   * stops responding.
   *
   * Row height is fixed rather than measured. Every cell either truncates or is
   * `whitespace-nowrap`, so no row is ever taller than one line - and measuring
   * costs a ResizeObserver callback per mounted row on every change to the
   * filter, which is exactly when the list is busiest.
   */
  /*
   * Held in state, not a ref.
   *
   * The dialog's contents are unmounted when it closes, so reopening builds a
   * brand-new scroll container - and attaching a plain ref does not re-render,
   * so nothing told the virtualiser its element had changed. It went on
   * measuring the detached node from the first open, found no height, and
   * returned an empty window: the table drew its header and no rows, with the
   * data sitting right there behind it. A state-backed callback ref makes the
   * element's arrival a render, which is the only signal the virtualiser gets.
   */
  const [tableScrollEl, setTableScrollEl] = useState<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableScrollEl,
    estimateSize: () => TABLE_ROW_HEIGHT,
    // A few rows either side, so a fast scroll finds them already rendered.
    overscan: 12,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  // Spacers stand in for everything above and below the window, so the scroll
  // bar reflects the whole set rather than the handful of mounted rows.
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  function toggleSpendFilter(id: string, additive: boolean) {
    setSpendFilters((current) => nextBucketSelection(current, id, additive));
  }

  function toggleWeekFilter(id: string, additive: boolean) {
    setWeekFilters((current) => nextBucketSelection(current, id, additive));
  }

  function handleRangeChange(monthStart: string, monthEnd: string) {
    setActiveTarget((current) => {
      const base = current ?? target;
      return base ? { ...base, monthStart, monthEnd } : base;
    });
    setSpendFilters(EMPTY_FILTERS);
    setWeekFilters(EMPTY_FILTERS);
    setGlobalFilter("");
  }

  function handleSelectionChange(keys: string[]) {
    // An empty list falls back to the figure that was clicked rather than to
    // nothing at all: a dialog reporting on no categories has nothing to show
    // and no way back, and "clear the selection" reads as "start again", not
    // as "empty the screen".
    // Anything a selected group already covers is dropped rather than recorded
    // twice. The picker no longer offers those rows, but a key can outlive the
    // click that made it - tick a category, then tick the group above it.
    const groupKeys = new Set(keys.filter((key) => key.startsWith("group:")));
    const coveredByGroups = new Set<string>();
    for (const key of groupKeys) {
      const option = categoryOptions.find((candidate) => optionKey(candidate) === key);
      for (const id of option?.categoryIds ?? []) coveredByGroups.add(`category:${id}`);
    }
    const kept = keys.filter((key) => !coveredByGroups.has(key));

    setSelectedKeys(kept.length > 0 ? kept : null);
    setSpendFilters(EMPTY_FILTERS);
    setWeekFilters(EMPTY_FILTERS);
    setGlobalFilter("");
  }

  function closeDialog() {
    setActiveTarget(null);
    setSelectedKeys(null);
    onClose();
  }

  const hasVisualFilters = spendFilters.length > 0 || weekFilters.length > 0;
  /*
   * The chip for the timing selection, named the way the chart named it.
   *
   * It used to read the label out of `spendByWeek` whatever was selected, so a
   * month range chip showed the raw bucket id ("2026-03") and a weekday chip
   * lost its label entirely - the lookup only ever held week buckets. Reading
   * from the buckets currently on screen keeps the chip and the bar saying the
   * same word, and the prefix says which of the two axes it came from.
   */
  const weekFilterLabels = useMemo(() => {
    const dimension = timingBy === "weekday" ? "Weekday" : isRange ? "Month" : "Week";
    return weekFilters.map((id) => ({
      id,
      label: `${dimension}: ${
        timingBuckets.find((bucket) => bucket.id === id)?.label ??
        id.replace("week-", "Week ")
      }`,
    }));
  }, [weekFilters, timingBuckets, timingBy, isRange]);


  /**
   * The plan behind each row of the "where" list, keyed by that row's own
   * label.
   *
   * Keyed by whichever dimension is on screen, so the group view is measured
   * against group budgets exactly as the category view is against category
   * ones. Payees are excluded: a merchant has no plan to be measured against.
   */
  const planByBucketLabel =
    breakdownDimension === "payee"
      ? null
      : breakdownDimension === "group"
        ? categoryFacts.budgetedByGroup
        : categoryFacts.budgetedByCategory;


  /**
   * The budgeted figure the strip compares spending against.
   *
   * Summed across every month in the range, not read from one of them. The
   * spending beside it is a range total, so a single month's budget would make
   * the Variance a comparison between two different periods - the exact
   * mismatch a range drill-through exists to remove.
   *
   * Read off the single pass above rather than walking the months again. Three
   * branches used to live here - a real group, a synthetic whole-month group,
   * and a lone category - and every one converged on the same arithmetic,
   * because a group's budget *is* the sum of its categories'.
   *
   * When a row of the breakdown is selected the strip narrows to that row's own
   * plan, in whichever dimension is on screen, so it describes what is being
   * looked at rather than the whole selection. Payees are skipped: a merchant
   * is not a budget line, so there is nothing to narrow to.
   */
  const budgetValues = useMemo(() => {
    if (!effectiveTarget) return null;
    if (spendFilters.length > 0 && planByBucketLabel) {
      // Several rows selected means several plans, so they add - the strip is
      // then measuring exactly the set of budget lines on screen.
      let narrowed = 0;
      let matched = false;
      for (const label of spendFilters) {
        const plan = planByBucketLabel.get(label);
        if (plan === undefined) continue;
        matched = true;
        narrowed += plan;
      }
      return matched ? { budgeted: narrowed } : null;
    }
    return categoryFacts.totalBudgeted === null
      ? null
      : { budgeted: categoryFacts.totalBudgeted };
  }, [effectiveTarget, spendFilters, planByBucketLabel, categoryFacts.totalBudgeted]);

  /*
   * The headline figures come from the server-side aggregate when nothing is
   * filtered - it is computed over the same set the rows came from, so it is
   * the authoritative total. Visual filters intentionally scope to what is on
   * screen, so they fall back to the row analytics.
   */
  const useAggregateHeadline = !hasVisualFilters && summary != null;
  const headlineNet =
    useAggregateHeadline && summary
      ? isIncome
        ? summary.total
        : -summary.total
      : totals.netSpent;
  const headlineCount =
    useAggregateHeadline && summary ? summary.count : totals.transactionCount;

  // Variance is favorable (positive/green) when spending stays under budget or
  // income comes in at or above plan — so the two sides subtract in opposite
  // directions. `headlineNet` is directional (net outflow vs net inflow).
  const variance =
    budgetValues !== null
      ? isIncome
        ? headlineNet - budgetValues.budgeted
        : budgetValues.budgeted - headlineNet
      : null;

  /*
   * The burn rate: what the period is costing per day it has run.
   *
   * More actionable than the per-transaction average beside it - a daily figure
   * can be held against a daily slice of the budget, where "50 a transaction"
   * mostly says how the spending was split up rather than how much of it there
   * is. Driven by the reconciled headline, so it covers the whole matching set
   * even when the row list is capped.
   */
  // Measured over the months on screen, not the whole range: picking one month
  // out of twelve and still dividing by a year would report a burn rate a
  // twelfth of the real one.
  const elapsedDays = useMemo(() => elapsedDaysInMonths(activeMonths), [activeMonths]);
  const perDay = elapsedDays > 0 ? headlineNet / elapsedDays : 0;

  const hasData = !isLoading && !error && rows.length > 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeDialog(); }}>
      <DialogContent className="flex h-[86vh] max-w-[min(72rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-2rem))]">
        {/* Header */}
        <DialogHeader className="shrink-0 border-b border-border bg-background px-5 py-2.5 pr-12">
          {/*
            One row, not three. The title, its caption and the two controls used
            to stack, and the height that cost came straight out of the panels
            below - where it was the difference between five breakdown rows and
            seven. The caption said "Expense analysis" under a title that read
            "Spending details", so it was the easiest of the three to lose.
          */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <DialogTitle className="flex h-7 shrink-0 items-center text-base leading-none">
              {flowNoun} Analysis
            </DialogTitle>
            <DialogDescription className="sr-only">
              {monthLabel}
              {effectiveTarget ? ` · ${effectiveTarget.title}` : ""}
            </DialogDescription>

            <Field label="Categories">
              <div className="flex min-w-0 items-center gap-2">
                <FolderOpen
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="flex w-[22rem] max-w-full min-w-0">
                  <MultiSearchableCombobox
                    options={pickerOptions}
                    values={selectedKeys ?? EMPTY_SELECTION}
                    onChange={handleSelectionChange}
                    placeholder={pickerPlaceholder}
                    summary={selectionSummary}
                    coveredIds={coveredCategoryKeys}
                    exclusiveIds={exclusiveKeys}
                    onClear={() => handleSelectionChange([])}
                    selectableGroups
                    ariaLabel="Select categories or category groups"
                    triggerClassName="min-h-7 py-0.5"
                  />
                </div>
              </div>
            </Field>

            {/*
              Outside the control, not inside it. It describes what the selected
              value contains rather than offering anything to select, and sitting
              within the bordered box made the control two lines tall to hold a
              caption.

              It is also where the selection can be read in full. The trigger
              says "2 groups + 1 category" because it has one line to say it in;
              this says which ones, on demand, without the picker having to grow
              a row per selection to keep them on screen.
            */}
            <SelectionSummaryBadge
              count={selectedCategoryCount}
              selected={selectedOptions}
              fallbackTitle={effectiveTarget?.title ?? ""}
            />

            <Field label="Period">
              <MonthRangeField
                monthStart={effectiveTarget?.monthStart ?? ""}
                monthEnd={effectiveTarget?.monthEnd ?? ""}
                /*
                  Bounded by the budget file, not by the page's window. The
                  window is where someone last navigated; the file is what
                  actually exists, and it is the only honest limit on what can
                  be asked for.
                */
                availableMonths={availableMonths ?? EMPTY_MONTHS}
                disabled={!effectiveTarget}
                onChange={handleRangeChange}
              />
            </Field>
          </div>
        </DialogHeader>

        {/* Summary strip - only when data is loaded */}
        {hasData && (
          <div className="shrink-0 border-b border-border/70 bg-muted/5 px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              {/*
                A reserved column, not one that sizes to its digits. The bar
                takes whatever the row has left, so a figure growing from 5,000
                to 500,000 would otherwise shorten the bar by the width of the
                two extra digits every time the selection changed. Sized for
                the range it will actually meet - six figures and the longer of
                the two verbs - rather than for a number nobody has.
              */}
              <div className="w-36 shrink-0">
                <div className="whitespace-nowrap font-sans text-[1.35rem] font-semibold leading-none tabular-nums text-foreground">
                  {formatSignedWhole(headlineNet)}
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                    {isIncome ? "received" : "spent"}
                  </span>
                </div>
                {/*
                  The clause is only ever the budgeted figure now. When there is
                  no budget the bar's slot says so instead - saying it in both
                  places put the same sentence twice in one strip, an inch
                  apart. The row is kept at a fixed height either way so the
                  strip does not change shape between the two cases.
                */}
                <div className="mt-1 h-4 text-xs text-muted-foreground">
                  {budgetValues !== null && budgetValues.budgeted > 0
                    ? `of ${formatSignedWhole(budgetValues.budgeted)} budgeted`
                    : ""}
                </div>
              </div>

              {budgetValues !== null && budgetValues.budgeted > 0 ? (
                <BudgetProgress
                  actual={headlineNet}
                  budgeted={budgetValues.budgeted}
                  accent={accent}
                />
              ) : (
                /*
                  No track, because there is no scale to draw one against - a
                  neutral bar filled end to end would be claiming "100% of
                  something" that does not exist. The slot keeps its height and
                  states the absence instead, so the strip holds its shape and
                  the missing bar is explained rather than merely missing.
                */
                <div className="flex h-10 w-[32rem] min-w-0 shrink items-center pr-2">
                  {/*
                    "No budget" is a claim, and it cannot be made until the
                    plans are in. Fetching them per range means there is now a
                    moment where none have arrived, and asserting their absence
                    during it would flash a wrong answer on every open.
                  */}
                  <span
                    className={cn(
                      "text-xs",
                      plansError ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {plansLoading
                      ? "Loading budget…"
                      : plansError
                        ? // A plan that failed to arrive is not a plan that
                          // does not exist, and only one of those is the
                          // user's doing.
                          "Could not load the budget for this period"
                        : "No budget set for this period"}
                  </span>
                </div>
              )}


              {/*
                Pinned right, with the bar flexing into whatever is left over.
                Only one thing in the strip can absorb slack, and it has to be
                the bar: cap the bar instead and the spare width collects in a
                single gap, which reads as a missing element rather than as
                spacing wherever it lands.
              */}
              {/*
                Still pinned right, and now with real slack in front of it: the
                bar no longer absorbs what the row has left over, so the spare
                width collects here. Empty space that changes size is a smaller
                distraction than a bar that changes length, which reads as the
                figure itself moving.
              */}
              <div className="ml-auto flex items-stretch divide-x divide-border/50">
                {variance !== null && budgetValues !== null && (
                  <StripItem
                    label={varianceLabel(variance, budgetValues.budgeted, isIncome)}
                    value={formatSignedWhole(Math.abs(variance))}
                    tone={varianceTone(variance, isIncome)}
                  />
                )}
                <StripItem label="transactions" value={headlineCount.toLocaleString()} />
                {/*
                  Both figures are averages, so each says what it averages over.
                  Side by side under one word they read as the same number
                  disagreeing with itself.
                */}
                <StripItem
                  label="per transaction"
                  value={
                    totals.averageTransaction > 0
                      ? formatSignedWhole(totals.averageTransaction)
                      : "-"
                  }
                />
                <StripItem
                  label="per day"
                  value={perDay > 0 ? formatSignedWhole(perDay) : "-"}
                />
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive">
              Could not load transactions: {errorMessage(error)}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState message="No transactions found for this selection." />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Visual panels, divided by a rule rather than a gap. */}
              <div className="grid h-[362px] shrink-0 grid-cols-2 divide-x divide-border/70 border-b border-border/70">
                <Panel
                  title={isIncome ? "Where the income came from" : "Where the money went"}
                  /*
                    The Ctrl hint is in the caption because nothing about a
                    clickable row suggests that holding a key does something
                    different - and a feature nobody can find is one that is not
                    there.
                  */
                  subtitle={`Click a ${BREAKDOWN_LABELS[
                    breakdownDimension
                  ].toLowerCase()} to filter · Ctrl-click for several`}
                  action={
                    isGroup ? (
                      <PillGroup
                        options={[
                          // Only once two groups are in play: with one, every
                          // row belongs to it and the view is a single bar
                          // restating the total above.
                          ...(groupSpan > 1
                            ? [{ value: "group" as const, label: "Groups" }]
                            : []),
                          { value: "category" as const, label: "Categories" },
                          { value: "payee" as const, label: "Payees" },
                        ]}
                        value={breakdownDimension}
                        onChange={(next) => {
                          setBreakdownBy(next);
                          // The selection is a bucket id from the view being
                          // left, so it means nothing in the one being entered.
                          setSpendFilters(EMPTY_FILTERS);
                        }}
                      />
                    ) : undefined
                  }
                >
                  <SpendBreakdown
                    buckets={primaryBreakdown}
                    columnLabel={BREAKDOWN_LABELS[breakdownDimension]}
                    accent={accent}
                    isIncome={isIncome}
                    budgetsByLabel={planByBucketLabel}
                    monthCount={activeMonths.length}
                    emptyLabel={
                      isIncome
                        ? "No income breakdown available."
                        : "No spending breakdown available."
                    }
                    selectedIds={spendFilters}
                    onSelect={toggleSpendFilter}
                  />
                </Panel>

                <Panel
                  title={isIncome ? "When income arrived" : "When spending happened"}
                  subtitle={`${
                    timingBy === "weekday"
                      ? `${isIncome ? "Income" : "Spending"} by day of week`
                      : isRange
                        ? "Grouped monthly"
                        : "Grouped weekly"
                  } · Ctrl-click for several`}
                  action={
                    <PillGroup
                      options={[
                        { value: "time" as const, label: "Over time" },
                        { value: "weekday" as const, label: "By weekday" },
                      ]}
                      value={timingBy}
                      onChange={(next) => {
                        setTimingBy(next);
                        // Same reason: `week-2` and `Sat` are different
                        // vocabularies, and a stale id matches nothing at all.
                        setWeekFilters(EMPTY_FILTERS);
                      }}
                    />
                  }
                >
                  <WeeklySpending
                    buckets={timingBuckets}
                    month={timingBy === "time" && !isRange ? effectiveTarget?.monthStart ?? "" : ""}
                    accent={accent}
                    /*
                      Named after the bucket, because that is what the line is
                      the mean of. It used to say "Monthly average" over a chart
                      of weeks, and "Daily average" over the weekday view -
                      where each bar is every Monday added together, so the mean
                      of the seven is a per-weekday figure and nothing like a
                      per-day one.
                    */
                    averageLabel={
                      timingBy === "weekday"
                        ? "Weekday average"
                        : isRange
                          ? "Monthly average"
                          : "Weekly average"
                    }
                    selectedIds={weekFilters}
                    onSelect={toggleWeekFilter}
                  />
                </Panel>
              </div>

              {/* Transaction table */}
              <section className="flex min-h-0 flex-1 flex-col">
                {/*
                  One toolbar row, not two. The chips were on a line of their
                  own beneath, which pushed the table down and separated "what
                  is filtered" from the count of what survived it - the two
                  halves of the same sentence.
                */}
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 bg-muted/40 px-4 py-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Transactions</h3>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {/*
                        Either a count of what is listed, or - once a bar or a
                        row has been clicked - what that click narrowed it down
                        from. The second is the useful one: a bare "54 results"
                        after a filter hides the fact that a filter is on.
                      */}
                      {hasVisualFilters || globalFilter.length > 0
                        ? `${tableRows.length.toLocaleString()} of ${rows.length.toLocaleString()}`
                        : `${tableRows.length.toLocaleString()} results`}
                    </span>
                  </div>

                  {hasVisualFilters && (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {/*
                        One chip per selection, each clearing only itself - with
                        several in play, a chip that wiped the whole dimension
                        would undo more than it names.
                      */}
                      {spendFilters.map((id) => (
                        <FilterChip
                          key={`spend-${id}`}
                          label={`${BREAKDOWN_LABELS[breakdownDimension]}: ${id}`}
                          accent={accent}
                          onClear={() =>
                            setSpendFilters((current) =>
                              current.filter((value) => value !== id)
                            )
                          }
                        />
                      ))}
                      {weekFilterLabels.map(({ id, label }) => (
                        <FilterChip
                          key={`week-${id}`}
                          label={label}
                          accent={accent}
                          onClear={() =>
                            setWeekFilters((current) =>
                              current.filter((value) => value !== id)
                            )
                          }
                        />
                      ))}
                      <button
                        type="button"
                        className="whitespace-nowrap text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => {
                          setSpendFilters(EMPTY_FILTERS);
                          setWeekFilters(EMPTY_FILTERS);
                        }}
                      >
                        Clear all
                      </button>
                    </div>
                  )}

                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {/*
                      The Rules filter bar's search field, not the `Input`
                      component: that one carries `text-base ... md:text-sm`, and
                      the responsive variant is emitted after the plain utilities,
                      so a `text-xs` passed in loses to it above 768px.
                    */}
                    <div className="relative flex items-center">
                      <Search
                        className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        value={globalFilter}
                        onChange={(event) => setGlobalFilter(event.target.value)}
                        placeholder="Search transactions"
                        aria-label="Search transactions"
                        className="h-7 w-48 rounded-md border border-border bg-background pl-7 pr-7 text-xs outline-none focus:ring-1 focus:ring-ring"
                      />
                      {globalFilter.length > 0 && (
                        <button
                          type="button"
                          aria-label="Clear search"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setGlobalFilter("")}
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {/*
                      Export sits with the table it exports, not up in the
                      header beside the controls that decide the period - it
                      writes out the rows as filtered and sorted below, and
                      belonged next to them.
                    */}
                    <button
                      type="button"
                      onClick={() =>
                        exportTransactionsCsv(
                          // `.original` unwraps the table's rows, so the file
                          // carries what is on screen in the order it is sorted.
                          tableRows.map((row) => row.original),
                          effectiveTarget?.title ?? "transactions",
                          exportPeriodLabel
                        )
                      }
                      disabled={tableRows.length === 0}
                      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Export ${tableRows.length} transactions as CSV`}
                      title="Export what is shown as CSV"
                    >
                      <Upload className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                      Export
                    </button>
                  </div>
                </div>

                <div ref={setTableScrollEl} className="min-h-0 flex-1 overflow-auto">
                  {tableRows.length === 0 ? (
                    <EmptyState message="No transactions match this search." />
                  ) : (
                    <table className="w-full min-w-[880px] table-fixed border-collapse text-xs">
                      <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                        {table.getHeaderGroups().map((headerGroup) => (
                          <tr key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                              const isSorted = header.column.getIsSorted();
                              const isAmount = header.id === "amount";
                              const isDate = header.id === "date";
                              return (
                                <th
                                  key={header.id}
                                  className={cn(
                                    "px-3 py-2 font-medium",
                                    COLUMN_WIDTHS[header.id],
                                    isDate && "whitespace-nowrap",
                                    isAmount && "whitespace-nowrap text-right"
                                  )}
                                >
                                  <button
                                    type="button"
                                    className={cn(
                                      "inline-flex w-full items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground",
                                      isAmount ? "justify-end" : "justify-start"
                                    )}
                                    onClick={header.column.getToggleSortingHandler()}
                                    aria-label={`Sort by ${header.id}`}
                                  >
                                    <span>
                                      {flexRender(header.column.columnDef.header, header.getContext())}
                                    </span>
                                    {isSorted === "asc" ? (
                                      <ArrowUp className="h-3 w-3" />
                                    ) : isSorted === "desc" ? (
                                      <ArrowDown className="h-3 w-3" />
                                    ) : (
                                      <ArrowUpDown className="h-3 w-3 opacity-35" />
                                    )}
                                  </button>
                                </th>
                              );
                            })}
                          </tr>
                        ))}
                      </thead>
                      <tbody>
                        {paddingTop > 0 && (
                          <tr aria-hidden="true">
                            <td colSpan={columns.length} style={{ height: paddingTop }} />
                          </tr>
                        )}
                        {virtualRows.map((virtualRow) => {
                          const row = tableRows[virtualRow.index];
                          if (!row) return null;
                          return (
                            <tr
                              key={row.id}
                              data-index={virtualRow.index}
                              style={{ height: TABLE_ROW_HEIGHT }}
                              className="border-b border-border/60 hover:bg-muted/30"
                            >
                              {row.getVisibleCells().map((cell) => (
                                <td
                                  key={cell.id}
                                  className={cn(
                                    "px-3 py-2",
                                    // A date locates a row rather than being
                                    // something read off it, so it sits at the
                                    // weight of the other supporting columns
                                    // and leaves the emphasis to the amount.
                                    cell.column.id === "date" &&
                                      "whitespace-nowrap text-muted-foreground",
                                    cell.column.id === "amount" &&
                                      "whitespace-nowrap text-right"
                                  )}
                                >
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                        {paddingBottom > 0 && (
                          <tr aria-hidden="true">
                            <td colSpan={columns.length} style={{ height: paddingBottom }} />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

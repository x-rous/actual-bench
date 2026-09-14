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
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarRange, Clock3, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMonthLabel, monthsInRange, parseMonth } from "@/lib/budget/monthMath";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MonthRangePicker } from "@/components/ui/monthrangepicker";
import { useBudgetTransactions } from "../../hooks/useBudgetTransactions";
import {
  buildBudgetTransactionAnalytics,
  type TransactionSpendBucket,
  type TransactionTimeBucket,
} from "../../lib/budgetTransactionAnalytics";
// The table keeps its cents - a single transaction is where they are the
// point. Everything else in the dialog is a total or an average, read as a
// column of figures, and rounds like the details panel behind it.
import { formatDelta, formatDeltaWhole, formatSignedWhole } from "../../lib/format";
import {
  formatTransactionDateLabel,
  matchesTransactionSearch,
} from "../../lib/budgetTransactionTable";
import type {
  BudgetTransactionBrowserOptions,
  BudgetTransactionCategoryOption,
  BudgetTransactionsDrilldown,
  BudgetTransactionSide,
} from "../../lib/budgetTransactionBrowser";
import {
  BUDGET_TRANSACTIONS_ROW_LIMIT,
  type BudgetTransactionRow,
} from "../../lib/budgetTransactionsQuery";
import type { LoadedMonthState } from "../../types";

type Props = {
  target: BudgetTransactionsDrilldown | null;
  browserOptions: BudgetTransactionBrowserOptions;
  statesByMonth: Map<string, LoadedMonthState>;
  onClose: () => void;
};

const EMPTY_TRANSACTION_ROWS: BudgetTransactionRow[] = [];
const EMPTY_CATEGORY_IDS: string[] = [];
const SELECT_CLASS =
  "h-7 min-w-0 rounded-md border border-input bg-background px-2 text-[11px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-60 dark:bg-input/30";

// ─── column setup ─────────────────────────────────────────────────────────────

const columnHelper = createColumnHelper<BudgetTransactionRow>();

function amountTone(amount: number): string {
  if (amount < 0) return "text-destructive";
  if (amount > 0) return "text-emerald-700 dark:text-emerald-400";
  return "text-muted-foreground";
}

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
          "block max-w-[18rem] truncate font-medium",
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
        className="block max-w-56 truncate text-muted-foreground"
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
        className="block max-w-88 truncate text-muted-foreground"
        title={row.original.notes ?? ""}
      >
        {row.original.notes ?? ""}
      </span>
    ),
    sortingFn: "text",
  }),
];

// Stable module-level filter fn — avoids recreating on every render
const transactionSearchFilter: FilterFn<BudgetTransactionRow> = (
  row,
  _columnId,
  filterValue: string
) => matchesTransactionSearch(row.original, filterValue);
transactionSearchFilter.autoRemove = (val: string) => !val;

// ─── helpers ─────────────────────────────────────────────────────────────────

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function optionKey(option: BudgetTransactionCategoryOption): string {
  return `${option.entity}:${option.id}`;
}

function optionLabel(option: BudgetTransactionCategoryOption): string {
  if (option.entity === "group") return option.title;
  return `${option.title} · ${option.subtitle}`;
}

function targetKey(target: BudgetTransactionsDrilldown): string {
  return `${target.entity}:${target.id}`;
}

/**
 * Which bucket of the "when" panel a row belongs to.
 *
 * It has to answer in the same vocabulary the panel is currently charting, and
 * that vocabulary changes with the range: a single month is bucketed by week
 * (`week-3`), a range of months by month (`2026-03`). Getting this wrong is
 * silent - the ids simply never match, every row is filtered out, and the table
 * reads as "no transactions" rather than as a bug.
 */
export function rowTimeBucketId(date: string, byMonth: boolean): string {
  if (byMonth) return date.slice(0, 7);
  const day = Number(date.slice(-2)) || 1;
  const week = Math.min(5, Math.max(1, Math.floor((day - 1) / 7) + 1));
  return `week-${week}`;
}

function rowMatchesSpendBucket(
  row: BudgetTransactionRow,
  bucketId: string,
  isGroup: boolean
): boolean {
  const label = isGroup
    ? (row.categoryName?.trim() || "Uncategorized")
    : (row.payeeName?.trim() || "No payee");
  return label === bucketId;
}

// ─── primitives ───────────────────────────────────────────────────────────────

function StripItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 truncate font-sans text-sm font-semibold tabular-nums", tone ?? "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      {label}
      <button
        type="button"
        aria-label={`Remove filter: ${label}`}
        className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20"
        onClick={onClear}
      >
        <X className="h-2.5 w-2.5" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * One region of the dialog body.
 *
 * Flush to the dialog's edges and separated by single rules rather than floated
 * as a rounded card. Three cards inside a bordered dialog stack four rounded
 * edges within a few pixels of each other, and the nesting reads as decoration
 * rather than as structure; a straight rule says "these are different things"
 * with one line. The padding moves inward so the content still breathes.
 */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex h-full min-h-0 flex-col p-3">
      <h3 className="mb-2 shrink-0 text-xs font-semibold text-foreground">{title}</h3>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

const BREAKDOWN_VISIBLE_LIMIT = 6;

function SpendBreakdown({
  buckets,
  emptyLabel,
  selectedId,
  onSelect,
}: {
  buckets: TransactionSpendBucket[];
  emptyLabel: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const visible = buckets.slice(0, BREAKDOWN_VISIBLE_LIMIT);
  const hiddenCount = Math.max(0, buckets.length - BREAKDOWN_VISIBLE_LIMIT);
  const hasSelection = selectedId !== null;

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1.5">
        {visible.map((bucket) => {
          const isActive = selectedId === bucket.id;
          return (
          <button
            key={bucket.id}
            type="button"
            aria-pressed={isActive}
            className={cn(
              "w-full cursor-pointer rounded px-1.5 py-1 text-left transition-all",
              isActive
                ? "bg-primary/10 ring-1 ring-primary/30"
                : hasSelection
                  ? "opacity-40 hover:opacity-100 hover:bg-muted/40"
                  : "hover:bg-muted/40"
            )}
            onClick={() => onSelect(bucket.id)}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                {bucket.label}
              </span>
              <span className="shrink-0 font-sans text-xs tabular-nums text-foreground">
                {formatSignedWhole(bucket.amount)}
                <span className="ml-1.5 text-muted-foreground">
                  {Math.round(bucket.percentage * 100)}%
                </span>
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-colors",
                  isActive ? "bg-primary" : "bg-foreground/50"
                )}
                style={{ width: `${Math.max(bucket.percentage * 100, bucket.amount > 0 ? 3 : 0)}%` }}
              />
            </div>
          </button>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <div className="mt-2 text-center text-[10px] text-muted-foreground">
          + {hiddenCount} more
        </div>
      )}
    </div>
  );
}

function weekStartDate(month: string, weekId: string): string {
  const week = Number(weekId.replace("week-", ""));
  if (!week || !/^\d{4}-\d{2}$/.test(month)) return "";
  const [year, mon] = month.split("-").map(Number);
  const firstDay = (week - 1) * 7 + 1;
  const start = new Date(Date.UTC(year, mon - 1, firstDay));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(start);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

function WeeklySpending({
  buckets,
  month,
  selectedId,
  onSelect,
}: {
  buckets: TransactionTimeBucket[];
  month: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const maxAmount = Math.max(...buckets.map((b) => b.amount), 1);

  return (
    <div className="flex h-full flex-col gap-1">
      {/* Amount labels - row above bars, outside each bar button */}
      <div className="flex shrink-0 gap-1.5">
        {buckets.map((bucket) => (
          <div
            key={bucket.id}
            className="flex-1 truncate text-center font-sans text-[11px] tabular-nums text-foreground"
          >
            {bucket.amount > 0 ? formatSignedWhole(bucket.amount) : ""}
          </div>
        ))}
      </div>

      {/* Bar chart - flex-1 so each button gets a properly defined height */}
      <div className="flex min-h-0 flex-1 gap-1.5">
        {buckets.map((bucket) => {
          const isActive = selectedId === bucket.id;
          // Normalize: tallest bar fills 70% of chart height
          const heightPct = bucket.amount > 0
            ? Math.max((bucket.amount / maxAmount) * 70, 8)
            : 2;
          return (
            <button
              key={bucket.id}
              type="button"
              aria-pressed={isActive}
              title={`${bucket.label}: ${formatSignedWhole(bucket.amount)}`}
              className={cn(
                "group relative flex-1 cursor-pointer rounded-sm bg-muted/50 transition-colors",
                isActive ? "ring-2 ring-primary/40" : "hover:bg-muted/70"
              )}
              onClick={() => onSelect(bucket.id)}
            >
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 rounded-sm transition-colors",
                  isActive
                    ? "bg-primary"
                    : "bg-primary/55 group-hover:bg-primary/75"
                )}
                style={{ height: `${heightPct}%` }}
              />
            </button>
          );
        })}
      </div>

      {/* Week labels with start dates */}
      <div className="flex shrink-0 gap-1.5">
        {buckets.map((bucket) => (
          <div
            key={bucket.id}
            className={cn(
              "flex-1 text-center transition-colors",
              selectedId === bucket.id ? "text-primary" : "text-muted-foreground"
            )}
          >
            <div className={cn("text-[10px]", selectedId === bucket.id && "font-semibold")}>
              {bucket.label.replace("Week ", "W")}
            </div>
            <div className="text-[9px]">{weekStartDate(month, bucket.id)}</div>
          </div>
        ))}
      </div>
    </div>
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

export function BudgetTransactionsDialog({ target, browserOptions, statesByMonth, onClose }: Props) {
  const [spendFilter, setSpendFilter] = useState<string | null>(null);
  const [weekFilter, setWeekFilter] = useState<string | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "amount", desc: true }]);
  const [activeTarget, setActiveTarget] = useState<BudgetTransactionsDrilldown | null>(target);

  const open = target != null;
  const effectiveTarget = activeTarget ?? target;

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

  const rows = data?.rows ?? EMPTY_TRANSACTION_ROWS;
  const summary = data?.summary ?? null;
  const isGroup = effectiveTarget?.entity === "group";
  // BM-04: income drill-throughs read as inflow, expense as outflow. The copy
  // and the KPI direction below follow the target's side so income never gets
  // presented through the expense/"spent" lens.
  const side: BudgetTransactionSide = effectiveTarget?.side ?? "expense";
  const isIncome = side === "income";
  const flowNoun = isIncome ? "Income" : "Spending";
  const flowVerb = isIncome ? "Received" : "Spent";

  // Clear visual + search filters when target or month changes
  useEffect(() => {
    setSpendFilter(null);
    setWeekFilter(null);
    setGlobalFilter("");
  }, [effectiveTarget?.id, effectiveTarget?.monthStart, effectiveTarget?.monthEnd]);

  // Rows filtered by spend selection only — drives WeeklySpending (cross-filter)
  const spendFilteredRows = useMemo(() => {
    if (!spendFilter) return rows;
    return rows.filter((row) => rowMatchesSpendBucket(row, spendFilter, isGroup));
  }, [rows, spendFilter, isGroup]);

  // Rows filtered by week selection only — drives SpendBreakdown (cross-filter)
  const weekFilteredRows = useMemo(() => {
    if (!weekFilter) return rows;
    return rows.filter((row) => rowTimeBucketId(row.date, isRange) === weekFilter);
  }, [rows, weekFilter, isRange]);

  // Rows with both filters — drives KPIs and table
  const visuallyFilteredRows = useMemo(() => {
    if (!spendFilter && !weekFilter) return rows;
    return rows.filter((row) => {
      if (spendFilter && !rowMatchesSpendBucket(row, spendFilter, isGroup)) return false;
      if (weekFilter && rowTimeBucketId(row.date, isRange) !== weekFilter) return false;
      return true;
    });
  }, [rows, spendFilter, weekFilter, isGroup, isRange]);

  // Analytics for SpendBreakdown — responds to week filter
  const spendBreakdownAnalytics = useMemo(
    () => buildBudgetTransactionAnalytics(weekFilteredRows, side),
    [weekFilteredRows, side]
  );

  // Analytics for WeeklySpending — responds to spend/category filter
  const weeklyAnalytics = useMemo(
    () => buildBudgetTransactionAnalytics(spendFilteredRows, side),
    [spendFilteredRows, side]
  );

  // Rows for KPIs: only update for category selection (budgets exist at category level),
  // not for payee or week filters (no budget granularity at those levels).
  const kpiRows = useMemo(() => {
    if (isGroup && spendFilter) {
      return rows.filter((row) => rowMatchesSpendBucket(row, spendFilter, true));
    }
    return rows;
  }, [rows, spendFilter, isGroup]);

  // Analytics for KPIs
  const analytics = useMemo(
    () => buildBudgetTransactionAnalytics(kpiRows, side),
    [kpiRows, side]
  );

  const primaryBreakdown = isGroup ? spendBreakdownAnalytics.spendByCategory : spendBreakdownAnalytics.spendByPayee;

  // The category/group picker only offers options on the same side as the
  // current target, so an income drill can't switch to an expense category.
  const categoryOptions = useMemo(
    () => browserOptions.categories.filter((option) => option.side === side),
    [browserOptions.categories, side]
  );

  const selectedCategoryKey = effectiveTarget ? targetKey(effectiveTarget) : "";
  const hasSelectedCategoryOption = categoryOptions.some(
    (option) => optionKey(option) === selectedCategoryKey
  );
  const monthLabel = !effectiveTarget
    ? ""
    : isRange
      ? `${formatMonthLabel(effectiveTarget.monthStart, "long")} - ${formatMonthLabel(
          effectiveTarget.monthEnd,
          "long"
        )}`
      : formatMonthLabel(effectiveTarget.monthStart, "long");

  const table = useReactTable({
    data: visuallyFilteredRows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: transactionSearchFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const tableRows = table.getRowModel().rows;

  function toggleSpendFilter(id: string) {
    setSpendFilter((current) => (current === id ? null : id));
  }

  function toggleWeekFilter(id: string) {
    setWeekFilter((current) => (current === id ? null : id));
  }

  function handleRangeChange(monthStart: string, monthEnd: string) {
    setActiveTarget((current) => {
      const base = current ?? target;
      return base ? { ...base, monthStart, monthEnd } : base;
    });
    setSpendFilter(null);
    setWeekFilter(null);
    setGlobalFilter("");
  }

  function handleCategoryChange(key: string) {
    const option = categoryOptions.find((candidate) => optionKey(candidate) === key);
    if (!option) return;
    setActiveTarget((current) => {
      const base = current ?? target;
      if (!base) return base;
      return {
        ...base,
        id: option.id,
        title: option.title,
        entity: option.entity,
        side: option.side,
        categoryIds: option.categoryIds,
      };
    });
    setSpendFilter(null);
    setWeekFilter(null);
    setGlobalFilter("");
  }

  function closeDialog() {
    setActiveTarget(null);
    onClose();
  }

  const hasVisualFilters = spendFilter !== null || weekFilter !== null;
  const weekFilterLabel = weekFilter
    ? (analytics.spendByWeek.find((b) => b.id === weekFilter)?.label ?? weekFilter.replace("week-", "Week "))
    : "";

  /**
   * The budgeted figure the strip compares spending against.
   *
   * Summed across every month in the range, not read from one of them. The
   * spending beside it is a range total, so a single month's budget would make
   * the Variance a comparison between two different periods - the exact
   * mismatch a range drill-through exists to remove.
   *
   * A month with no loaded state contributes nothing rather than voiding the
   * total: a gap in the window is a gap in the plan, not a reason to withhold
   * the figure.
   */
  const budgetValues = useMemo(() => {
    if (!effectiveTarget) return null;
    const wantIncome = side === "income";

    // A category's budgeted figure only shares the target's side (expense
    // categories carry the expense plan, income categories the income plan).
    const budgetedIn = (state: LoadedMonthState): number | null => {
      if (effectiveTarget.entity === "group") {
        // When a sub-category is selected in the breakdown, drill into its budget
        if (spendFilter) {
          const subCategory = Object.values(state.categoriesById).find(
            (cat) =>
              cat.isIncome === wantIncome &&
              cat.groupId === effectiveTarget.id &&
              cat.name === spendFilter
          );
          if (subCategory) return subCategory.budgeted;
        }
        const group = state.groupsById[effectiveTarget.id];
        if (group && group.isIncome === wantIncome) return group.budgeted;
        if (group) return null;
        // Synthetic whole-month group (e.g. "All expenses" / "All income"): there
        // is no real group entry, so sum the target's own same-side categories.
        let sum = 0;
        let hasMatch = false;
        for (const id of effectiveTarget.categoryIds) {
          const cat = state.categoriesById[id];
          if (!cat || cat.isIncome !== wantIncome) continue;
          hasMatch = true;
          sum += cat.budgeted;
        }
        return hasMatch ? sum : null;
      }
      const category = state.categoriesById[effectiveTarget.id];
      if (!category || category.isIncome !== wantIncome) return null;
      return category.budgeted;
    };

    let total = 0;
    let hasAny = false;
    for (const month of rangeMonths) {
      const state = statesByMonth.get(month);
      if (!state) continue;
      const budgeted = budgetedIn(state);
      if (budgeted == null) continue;
      hasAny = true;
      total += budgeted;
    }
    return hasAny ? { budgeted: Math.abs(total) } : null;
  }, [effectiveTarget, statesByMonth, spendFilter, side, rangeMonths]);

  // BM-05: the row list is capped at BUDGET_TRANSACTIONS_ROW_LIMIT. The
  // aggregate summary covers the whole set, so drive the headline KPIs from it
  // (they reconcile to the budget panel even past the cap). Visual filters
  // intentionally scope to the loaded page, so they fall back to row analytics.
  const totalCount = summary?.count ?? null;
  const isTruncated =
    totalCount != null
      ? totalCount > rows.length
      : rows.length >= BUDGET_TRANSACTIONS_ROW_LIMIT;
  const useAggregateHeadline = !hasVisualFilters && summary != null;
  const headlineNet =
    useAggregateHeadline && summary
      ? isIncome
        ? summary.total
        : -summary.total
      : analytics.netSpent;
  const headlineCount =
    useAggregateHeadline && summary ? summary.count : analytics.transactionCount;

  // Variance is favorable (positive/green) when spending stays under budget or
  // income comes in at or above plan — so the two sides subtract in opposite
  // directions. `headlineNet` is directional (net outflow vs net inflow).
  const variance =
    budgetValues !== null
      ? isIncome
        ? headlineNet - budgetValues.budgeted
        : budgetValues.budgeted - headlineNet
      : null;

  const hasData = !isLoading && !error && rows.length > 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeDialog(); }}>
      <DialogContent className="flex max-h-[86vh] max-w-[min(72rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-2rem))]">
        {/* Header */}
        <DialogHeader className="shrink-0 border-b border-border bg-background px-4 py-3 pr-12">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-base">{flowNoun} details</DialogTitle>
                <Badge variant={isGroup ? "secondary" : "outline"}>
                  {isGroup ? "Category group" : "Single category"}
                </Badge>
                {isGroup && (
                  <Badge variant="outline">
                    {effectiveTarget?.categoryIds.length ?? 0} categories
                  </Badge>
                )}
              </div>
              {/*
                Kept for the screen reader, hidden from the page.
                
                The range and the category are both on screen already, in the
                two controls opposite - repeating them under the title was the
                same sentence twice. They are still worth announcing, though:
                the controls carry their own labels, and a dialog that opens
                without saying what it covers makes the reader go looking.
              */}
              <DialogDescription className="sr-only">
                {monthLabel}
                {effectiveTarget ? ` · ${effectiveTarget.title}` : ""}
              </DialogDescription>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
              <MonthRangeField
                monthStart={effectiveTarget?.monthStart ?? ""}
                monthEnd={effectiveTarget?.monthEnd ?? ""}
                availableMonths={browserOptions.months.map((option) => option.month)}
                disabled={!effectiveTarget}
                onChange={handleRangeChange}
              />

              <select
                value={selectedCategoryKey}
                onChange={(event) => handleCategoryChange(event.target.value)}
                className={cn(SELECT_CLASS, "w-96 max-w-full")}
                disabled={!effectiveTarget || categoryOptions.length === 0}
                aria-label="Select category or group"
              >
                {effectiveTarget && !hasSelectedCategoryOption && (
                  <option value={selectedCategoryKey}>{effectiveTarget.title}</option>
                )}
                {categoryOptions.map((option) => (
                  <option key={optionKey(option)} value={optionKey(option)}>
                    {optionLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </DialogHeader>

        {/* Summary strip - only when data is loaded */}
        {hasData && (
          <div className="shrink-0 border-b border-border/70 bg-muted/5 px-4 py-2">
            <div className="flex items-stretch divide-x divide-border/50">
              <StripItem label={flowVerb} value={formatSignedWhole(headlineNet)} />
              {budgetValues !== null && (
                <>
                  <StripItem label="Budgeted" value={formatSignedWhole(budgetValues.budgeted)} />
                  {variance !== null && (
                    <StripItem
                      label="Variance"
                      value={formatDeltaWhole(variance)}
                      tone={
                        variance < 0
                          ? "text-destructive"
                          : variance > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-muted-foreground"
                      }
                    />
                  )}
                </>
              )}
              <StripItem
                label="Transactions"
                value={headlineCount.toLocaleString()}
              />
              <StripItem
                label="Average"
                value={analytics.averageTransaction > 0 ? formatSignedWhole(analytics.averageTransaction) : "-"}
              />
            </div>
          </div>
        )}

        {/* Truncation notice: the row list is capped, so disclose that the
            charts/table below are a partial page. The headline KPIs stay
            reconciled via the aggregate when it is available (BM-05). */}
        {hasData && isTruncated && (
          <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            {summary != null
              ? `Showing the first ${rows.length.toLocaleString()} of ${summary.count.toLocaleString()} transactions. ${flowVerb}, Variance, and the count above cover all ${summary.count.toLocaleString()}; the breakdowns and table below reflect only the first ${rows.length.toLocaleString()}.`
              : `Showing the first ${rows.length.toLocaleString()} transactions - there may be more, so the figures below can be incomplete.`}
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
              <div className="grid h-[256px] shrink-0 grid-cols-2 divide-x divide-border/70 border-b border-border/70">
                <Panel
                  title={
                    isIncome
                      ? isGroup
                        ? "Where the income came from"
                        : "Where the income came from (by payee)"
                      : isGroup
                        ? "Where the group spend went"
                        : "Where the spend went (by payee)"
                  }
                >
                  <SpendBreakdown
                    buckets={primaryBreakdown}
                    emptyLabel={
                      isIncome
                        ? "No income breakdown available."
                        : "No spending breakdown available."
                    }
                    selectedId={spendFilter}
                    onSelect={toggleSpendFilter}
                  />
                </Panel>

                <Panel title={isIncome ? "When income arrived" : "When spending happened"}>
                  <WeeklySpending
                    buckets={isRange ? weeklyAnalytics.spendByMonth : weeklyAnalytics.spendByWeek}
                    month={isRange ? "" : effectiveTarget?.monthStart ?? ""}
                    selectedId={weekFilter}
                    onSelect={toggleWeekFilter}
                  />
                </Panel>
              </div>

              {/* Active filter chips */}
              {hasVisualFilters && (
                // The body no longer pads, so this row carries its own gutter
                // and its own rule - otherwise the chips sit against the edge
                // and run into the table header below them.
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/70 px-3 py-1">
                  <span className="text-[10px] text-muted-foreground">Filtered by:</span>
                  {spendFilter && (
                    <FilterChip label={spendFilter} onClear={() => setSpendFilter(null)} />
                  )}
                  {weekFilter && (
                    <FilterChip label={weekFilterLabel} onClear={() => setWeekFilter(null)} />
                  )}
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground underline hover:text-foreground"
                    onClick={() => { setSpendFilter(null); setWeekFilter(null); }}
                  >
                    Clear all
                  </button>
                </div>
              )}

              {/* Transaction table */}
              <section className="flex min-h-0 flex-1 flex-col">
                {/*
                  The Rules filter bar's search field, not the `Input`
                  component: that one carries `text-base ... md:text-sm`, and
                  the responsive variant is emitted after the plain utilities,
                  so a `text-xs` passed in loses to it above 768px.
                */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
                  <div className="relative flex items-center">
                    <Search
                      className="pointer-events-none absolute left-1.5 h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <input
                      value={globalFilter}
                      onChange={(event) => setGlobalFilter(event.target.value)}
                      placeholder="Search transactions"
                      aria-label="Search transactions"
                      className="h-6 w-56 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                    {globalFilter.length > 0 && (
                      <button
                        type="button"
                        aria-label="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setGlobalFilter("")}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="text-[10px] tabular-nums text-muted-foreground">
                    {tableRows.length.toLocaleString()} of {rows.length.toLocaleString()} rows
                    {hasVisualFilters ? " (filtered)" : ""}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {tableRows.length === 0 ? (
                    <EmptyState message="No transactions match this search." />
                  ) : (
                    <table className="w-full min-w-[760px] border-collapse text-xs">
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
                                    isDate && "w-px whitespace-nowrap",
                                    isAmount && "w-px whitespace-nowrap text-right"
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
                        {tableRows.map((row) => (
                          <tr
                            key={row.id}
                            className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                          >
                            {row.getVisibleCells().map((cell) => (
                              <td
                                key={cell.id}
                                className={cn(
                                  "px-3 py-2",
                                  cell.column.id === "date" && "w-px whitespace-nowrap font-medium text-foreground",
                                  cell.column.id === "amount" && "w-px whitespace-nowrap text-right"
                                )}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </td>
                            ))}
                          </tr>
                        ))}
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

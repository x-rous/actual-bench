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
import { ArrowDown, ArrowUp, ArrowUpDown, Clock3, Search, X } from "lucide-react";
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
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { useBudgetTransactions } from "../../hooks/useBudgetTransactions";
import {
  buildBudgetTransactionAnalytics,
  type TransactionSpendBucket,
  type TransactionTimeBucket,
} from "../../lib/budgetTransactionAnalytics";
import { formatDelta, formatSigned } from "../../lib/format";
import {
  formatTransactionDateLabel,
  matchesTransactionSearch,
} from "../../lib/budgetTransactionTable";
import type {
  BudgetTransactionBrowserOptions,
  BudgetTransactionCategoryOption,
  BudgetTransactionsDrilldown,
} from "../../lib/budgetTransactionBrowser";
import type { BudgetTransactionRow } from "../../lib/budgetTransactionsQuery";
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
  columnHelper.accessor((row) => (row.amount < 0 ? Math.abs(row.amount) : 0), {
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

function rowWeekId(date: string): string {
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-md border border-border/70 bg-background p-3">
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
                {formatSigned(bucket.amount)}
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
      {/* Amount labels — row above bars, outside each bar button */}
      <div className="flex shrink-0 gap-1.5">
        {buckets.map((bucket) => (
          <div
            key={bucket.id}
            className="flex-1 truncate text-center font-sans text-[11px] tabular-nums text-foreground"
          >
            {bucket.amount > 0 ? formatSigned(bucket.amount) : ""}
          </div>
        ))}
      </div>

      {/* Bar chart — flex-1 so each button gets a properly defined height */}
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
              title={`${bucket.label}: ${formatSigned(bucket.amount)}`}
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
    month: effectiveTarget?.month ?? "",
    categoryIds: effectiveTarget?.categoryIds ?? EMPTY_CATEGORY_IDS,
    enabled: open && effectiveTarget != null,
  });

  const rows = data ?? EMPTY_TRANSACTION_ROWS;
  const isGroup = effectiveTarget?.entity === "group";

  // Clear visual + search filters when target or month changes
  useEffect(() => {
    setSpendFilter(null);
    setWeekFilter(null);
    setGlobalFilter("");
  }, [effectiveTarget?.id, effectiveTarget?.month]);

  // Rows filtered by spend selection only — drives WeeklySpending (cross-filter)
  const spendFilteredRows = useMemo(() => {
    if (!spendFilter) return rows;
    return rows.filter((row) => rowMatchesSpendBucket(row, spendFilter, isGroup));
  }, [rows, spendFilter, isGroup]);

  // Rows filtered by week selection only — drives SpendBreakdown (cross-filter)
  const weekFilteredRows = useMemo(() => {
    if (!weekFilter) return rows;
    return rows.filter((row) => rowWeekId(row.date) === weekFilter);
  }, [rows, weekFilter]);

  // Rows with both filters — drives KPIs and table
  const visuallyFilteredRows = useMemo(() => {
    if (!spendFilter && !weekFilter) return rows;
    return rows.filter((row) => {
      if (spendFilter && !rowMatchesSpendBucket(row, spendFilter, isGroup)) return false;
      if (weekFilter && rowWeekId(row.date) !== weekFilter) return false;
      return true;
    });
  }, [rows, spendFilter, weekFilter, isGroup]);

  // Analytics for SpendBreakdown — responds to week filter
  const spendBreakdownAnalytics = useMemo(
    () => buildBudgetTransactionAnalytics(weekFilteredRows),
    [weekFilteredRows]
  );

  // Analytics for WeeklySpending — responds to spend/category filter
  const weeklyAnalytics = useMemo(
    () => buildBudgetTransactionAnalytics(spendFilteredRows),
    [spendFilteredRows]
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
    () => buildBudgetTransactionAnalytics(kpiRows),
    [kpiRows]
  );

  const primaryBreakdown = isGroup ? spendBreakdownAnalytics.spendByCategory : spendBreakdownAnalytics.spendByPayee;

  const selectedCategoryKey = effectiveTarget ? targetKey(effectiveTarget) : "";
  const hasSelectedCategoryOption = browserOptions.categories.some(
    (option) => optionKey(option) === selectedCategoryKey
  );
  const monthLabel = effectiveTarget ? formatMonthLabel(effectiveTarget.month, "long") : "";

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

  function handleMonthChange(month: string) {
    setActiveTarget((current) => {
      const base = current ?? target;
      return base ? { ...base, month } : base;
    });
    setSpendFilter(null);
    setWeekFilter(null);
    setGlobalFilter("");
  }

  function handleCategoryChange(key: string) {
    const option = browserOptions.categories.find((candidate) => optionKey(candidate) === key);
    if (!option) return;
    setActiveTarget((current) => {
      const base = current ?? target;
      if (!base) return base;
      return { ...base, id: option.id, title: option.title, entity: option.entity, categoryIds: option.categoryIds };
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

  const budgetValues = useMemo(() => {
    if (!effectiveTarget) return null;
    const state = statesByMonth.get(effectiveTarget.month);
    if (!state) return null;
    if (effectiveTarget.entity === "group") {
      // When a sub-category is selected in the breakdown, drill into its budget
      if (spendFilter) {
        const subCategory = Object.values(state.categoriesById).find(
          (cat) => !cat.isIncome && cat.groupId === effectiveTarget.id && cat.name === spendFilter
        );
        if (subCategory) return { budgeted: Math.abs(subCategory.budgeted) };
      }
      const group = state.groupsById[effectiveTarget.id];
      if (!group || group.isIncome) return null;
      return { budgeted: Math.abs(group.budgeted) };
    }
    const category = state.categoriesById[effectiveTarget.id];
    if (!category || category.isIncome) return null;
    return { budgeted: Math.abs(category.budgeted) };
  }, [effectiveTarget, statesByMonth, spendFilter]);

  const variance = budgetValues !== null ? budgetValues.budgeted - analytics.netSpent : null;

  const hasData = !isLoading && !error && rows.length > 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeDialog(); }}>
      <DialogContent className="flex max-h-[86vh] max-w-[min(72rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-2rem))]">
        {/* Header */}
        <DialogHeader className="shrink-0 border-b border-border bg-background px-4 py-3 pr-12">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-base">Spending details</DialogTitle>
                <Badge variant={isGroup ? "secondary" : "outline"}>
                  {isGroup ? "Category group" : "Single category"}
                </Badge>
                {isGroup && (
                  <Badge variant="outline">
                    {effectiveTarget?.categoryIds.length ?? 0} categories
                  </Badge>
                )}
              </div>
              <DialogDescription className="mt-1 truncate text-xs">
                {monthLabel}
                {effectiveTarget ? ` · ${effectiveTarget.title}` : ""}
              </DialogDescription>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
              <select
                value={effectiveTarget?.month ?? ""}
                onChange={(event) => handleMonthChange(event.target.value)}
                className={cn(SELECT_CLASS, "w-32")}
                disabled={!effectiveTarget || browserOptions.months.length === 0}
                aria-label="Select spending month"
              >
                {browserOptions.months.map((option) => (
                  <option key={option.month} value={option.month}>
                    {formatMonthLabel(option.month, "long")}
                  </option>
                ))}
              </select>

              <select
                value={selectedCategoryKey}
                onChange={(event) => handleCategoryChange(event.target.value)}
                className={cn(SELECT_CLASS, "w-96 max-w-full")}
                disabled={!effectiveTarget || browserOptions.categories.length === 0}
                aria-label="Select spending category or group"
              >
                {effectiveTarget && !hasSelectedCategoryOption && (
                  <option value={selectedCategoryKey}>{effectiveTarget.title}</option>
                )}
                {browserOptions.categories.map((option) => (
                  <option key={optionKey(option)} value={optionKey(option)}>
                    {optionLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </DialogHeader>

        {/* Summary strip — only when data is loaded */}
        {hasData && (
          <div className="shrink-0 border-b border-border/70 bg-muted/5 px-4 py-2">
            <div className="flex items-stretch divide-x divide-border/50">
              <StripItem label="Spent" value={formatSigned(analytics.netSpent)} />
              {budgetValues !== null && (
                <>
                  <StripItem label="Budgeted" value={formatSigned(budgetValues.budgeted)} />
                  {variance !== null && (
                    <StripItem
                      label="Variance"
                      value={formatDelta(variance)}
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
                value={analytics.transactionCount.toLocaleString()}
              />
              <StripItem
                label="Average"
                value={analytics.averageTransaction > 0 ? formatSigned(analytics.averageTransaction) : "—"}
              />
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
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3">
              {/* Visual panels */}
              <div className="grid h-[256px] shrink-0 grid-cols-2 gap-2.5">
                <Panel title={isGroup ? "Where the group spend went" : "Where the spend went (by payee)"}>
                  <SpendBreakdown
                    buckets={primaryBreakdown}
                    emptyLabel="No spending breakdown available."
                    selectedId={spendFilter}
                    onSelect={toggleSpendFilter}
                  />
                </Panel>

                <Panel title="When spending happened">
                  <WeeklySpending
                    buckets={weeklyAnalytics.spendByWeek}
                    month={effectiveTarget?.month ?? ""}
                    selectedId={weekFilter}
                    onSelect={toggleWeekFilter}
                  />
                </Panel>
              </div>

              {/* Active filter chips */}
              {hasVisualFilters && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 py-0.5">
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
              <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border/70 bg-background">
                <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative max-w-sm flex-1">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      value={globalFilter}
                      onChange={(event) => setGlobalFilter(event.target.value)}
                      placeholder="Search transactions"
                      aria-label="Search transactions"
                      className="h-8 rounded-md pl-8 pr-8 text-xs"
                    />
                    {globalFilter.length > 0 && (
                      <button
                        type="button"
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setGlobalFilter("")}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="text-[10px] text-muted-foreground">
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

                <div className="shrink-0 border-t border-border/70 px-3 py-1.5 text-[10px] text-muted-foreground">
                  Showing {tableRows.length.toLocaleString()} of {rows.length.toLocaleString()} transactions
                </div>
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useMemo, useState, type ReactNode } from "react";
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
  prepareBudgetTransactionRows,
  type BudgetTransactionSort,
  type BudgetTransactionSortKey,
} from "../../lib/budgetTransactionTable";
import type {
  BudgetTransactionBrowserOptions,
  BudgetTransactionCategoryOption,
  BudgetTransactionsDrilldown,
} from "../../lib/budgetTransactionBrowser";
import type { BudgetTransactionRow } from "../../lib/budgetTransactionsQuery";

type Props = {
  target: BudgetTransactionsDrilldown | null;
  browserOptions: BudgetTransactionBrowserOptions;
  onClose: () => void;
};

const DEFAULT_SORT: BudgetTransactionSort = { key: "amount", direction: "desc" };
const EMPTY_TRANSACTION_ROWS: BudgetTransactionRow[] = [];
const EMPTY_CATEGORY_IDS: string[] = [];
const SELECT_CLASS =
  "h-7 min-w-0 rounded-md border border-input bg-background px-2 text-[11px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-60 dark:bg-input/30";

const SORT_LABELS: Record<BudgetTransactionSortKey, string> = {
  date: "Date",
  amount: "Amount",
  payee: "Payee",
  category: "Category",
  notes: "Notes",
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function amountTone(amount: number): string {
  if (amount < 0) return "text-destructive";
  if (amount > 0) return "text-emerald-700 dark:text-emerald-400";
  return "text-muted-foreground";
}

function defaultDirectionFor(key: BudgetTransactionSortKey) {
  return key === "date" || key === "amount" ? "desc" : "asc";
}

function targetKey(target: BudgetTransactionsDrilldown): string {
  return `${target.entity}:${target.id}`;
}

function optionKey(option: BudgetTransactionCategoryOption): string {
  return `${option.entity}:${option.id}`;
}

function optionLabel(option: BudgetTransactionCategoryOption): string {
  if (option.entity === "group") return option.title;
  return `${option.title} · ${option.subtitle}`;
}

function formatSortStatus(sort: BudgetTransactionSort): string {
  return `Sorted by ${SORT_LABELS[sort.key]} ${sort.direction === "desc" ? "↓" : "↑"}`;
}

function weekRangeLabel(month: string, bucket: TransactionTimeBucket): string {
  const week = Number(bucket.id.replace("week-", ""));
  if (!week || !/^\d{4}-\d{2}$/.test(month)) return bucket.label;

  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = (week - 1) * 7 + 1;
  const lastDay = Math.min(week * 7, new Date(year, monthNumber, 0).getDate());
  const start = new Date(Date.UTC(year, monthNumber - 1, firstDay));
  const end = new Date(Date.UTC(year, monthNumber - 1, lastDay));
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${fmt.format(start)} - ${fmt.format(end)}`;
}

function mostActiveWeek(buckets: TransactionTimeBucket[]): TransactionTimeBucket | null {
  return buckets.reduce<TransactionTimeBucket | null>(
    (best, bucket) => (!best || bucket.amount > best.amount ? bucket : best),
    null
  );
}

function weekOverWeekInsight(
  buckets: TransactionTimeBucket[]
): { label: string; delta: number } | null {
  let best: { label: string; delta: number } | null = null;
  for (let i = 1; i < buckets.length; i++) {
    const previous = buckets[i - 1];
    const current = buckets[i];
    if (!previous || !current) continue;
    const delta = current.amount - previous.amount;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = {
        label: `${previous.label.replace("Week ", "W")} → ${current.label.replace("Week ", "W")}`,
        delta,
      };
    }
  }
  return best;
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: BudgetTransactionSort["direction"];
}) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-35" />;
  if (direction === "asc") return <ArrowUp className="h-3 w-3" />;
  return <ArrowDown className="h-3 w-3" />;
}

function SortHeader({
  sortKey,
  sort,
  align = "left",
  className,
  onSort,
}: {
  sortKey: BudgetTransactionSortKey;
  sort: BudgetTransactionSort;
  align?: "left" | "right";
  className?: string;
  onSort: (key: BudgetTransactionSortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn("px-3 py-2 font-medium", className)}>
      <button
        type="button"
        className={cn(
          "inline-flex w-full items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground",
          align === "right" ? "justify-end" : "justify-start"
        )}
        aria-label={`Sort by ${SORT_LABELS[sortKey]}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{SORT_LABELS[sortKey]}</span>
        <SortIcon active={active} direction={sort.direction} />
      </button>
    </th>
  );
}

function Kpi({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-muted/10 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate font-sans text-[15px] font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{helper}</div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="min-h-0 rounded-md border border-border/70 bg-background p-3">
      <h3 className="mb-2 text-xs font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function SpendBreakdown({
  buckets,
  emptyLabel,
}: {
  buckets: TransactionSpendBucket[];
  emptyLabel: string;
}) {
  const visible = buckets.slice(0, 6);
  if (visible.length === 0) {
    return <div className="py-8 text-center text-xs text-muted-foreground">{emptyLabel}</div>;
  }

  return (
    <div className="space-y-2">
      {visible.map((bucket) => (
        <div key={bucket.id}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs font-medium text-foreground">
              {bucket.label}
            </span>
            <span className="shrink-0 font-sans text-[11px] tabular-nums text-foreground">
              {formatSigned(bucket.amount)}
              <span className="ml-2 text-muted-foreground">
                {Math.round(bucket.percentage * 100)}%
              </span>
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/60"
              style={{
                width: `${Math.max(bucket.percentage * 100, bucket.amount > 0 ? 3 : 0)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function WeeklySpending({
  buckets,
  month,
}: {
  buckets: TransactionTimeBucket[];
  month: string;
}) {
  const active = mostActiveWeek(buckets);
  const wow = weekOverWeekInsight(buckets);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1.5">
        {buckets.map((bucket) => (
          <div key={bucket.id} className="min-w-0">
            <div className="mb-1 truncate text-center font-sans text-[10px] tabular-nums text-foreground">
              {formatSigned(bucket.amount)}
            </div>
            <div className="flex h-16 items-end rounded bg-muted/50 px-1">
              <div
                className="w-full rounded-t bg-primary/60"
                style={{
                  height: `${Math.max(bucket.percentage * 100, bucket.amount > 0 ? 7 : 2)}%`,
                }}
                title={`${bucket.label}: ${formatSigned(bucket.amount)}`}
              />
            </div>
            <div className="mt-1 text-center text-[10px] text-muted-foreground">
              {bucket.label.replace("Week ", "W")}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 text-[11px] sm:grid-cols-2">
        <div className="rounded-md bg-muted/35 px-2 py-1.5">
          <div className="text-muted-foreground">Most active week</div>
          <div className="mt-0.5 truncate font-medium text-foreground">
            {active && active.amount > 0
              ? `${active.label.replace("Week ", "W")} · ${weekRangeLabel(month, active)} · ${formatSigned(active.amount)} (${Math.round(active.percentage * 100)}%)`
              : "No active week"}
          </div>
        </div>
        <div className="rounded-md bg-muted/35 px-2 py-1.5">
          <div className="text-muted-foreground">Week-over-week</div>
          <div className="mt-0.5 truncate font-medium text-foreground">
            {wow
              ? `${formatDelta(wow.delta)} · ${wow.label}`
              : "No weekly change"}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="px-4 py-12 text-center">
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-muted">
        <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="text-sm font-medium text-foreground">Loading transactions</div>
      <div className="mt-1 text-xs text-muted-foreground">Fetching read-only transaction rows.</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{message}</div>;
}

export function BudgetTransactionsDialog({
  target,
  browserOptions,
  onClose,
}: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<BudgetTransactionSort>(DEFAULT_SORT);
  const [activeTarget, setActiveTarget] =
    useState<BudgetTransactionsDrilldown | null>(target);
  const open = target != null;
  const effectiveTarget = activeTarget ?? target;
  const { data, isLoading, error } = useBudgetTransactions({
    month: effectiveTarget?.month ?? "",
    categoryIds: effectiveTarget?.categoryIds ?? EMPTY_CATEGORY_IDS,
    enabled: open && effectiveTarget != null,
  });

  const rows = data ?? EMPTY_TRANSACTION_ROWS;
  const analytics = useMemo(() => buildBudgetTransactionAnalytics(rows), [rows]);
  const visibleRows = useMemo(
    () => prepareBudgetTransactionRows(rows, search, sort),
    [rows, search, sort]
  );
  const isGroup = effectiveTarget?.entity === "group";
  const primaryBreakdown = isGroup ? analytics.spendByCategory : analytics.spendByPayee;
  const topPayee = analytics.spendByPayee[0];
  const selectedCategoryKey = effectiveTarget ? targetKey(effectiveTarget) : "";
  const hasSelectedCategoryOption = browserOptions.categories.some(
    (option) => optionKey(option) === selectedCategoryKey
  );
  const monthLabel = effectiveTarget
    ? formatMonthLabel(effectiveTarget.month, "long")
    : "";

  function handleSort(sortKey: BudgetTransactionSortKey) {
    setSort((current) => {
      if (current.key !== sortKey) {
        return { key: sortKey, direction: defaultDirectionFor(sortKey) };
      }
      return {
        key: sortKey,
        direction: current.direction === "asc" ? "desc" : "asc",
      };
    });
  }

  function handleMonthChange(month: string) {
    setActiveTarget((current) => {
      const base = current ?? target;
      return base ? { ...base, month } : base;
    });
    setSearch("");
  }

  function handleCategoryChange(key: string) {
    const option = browserOptions.categories.find(
      (candidate) => optionKey(candidate) === key
    );
    if (!option) return;

    setActiveTarget((current) => {
      const base = current ?? target;
      if (!base) return base;
      return {
        ...base,
        id: option.id,
        title: option.title,
        entity: option.entity,
        categoryIds: option.categoryIds,
      };
    });
    setSearch("");
  }

  function closeDialog() {
    setActiveTarget(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeDialog();
      }}
    >
      <DialogContent className="max-h-[86vh] max-w-[min(68rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0 sm:max-w-[min(68rem,calc(100vw-2rem))]">
        <DialogHeader className="border-b border-border bg-background px-4 py-3 pr-12">
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
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  Press D
                </Badge>
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
                className={cn(SELECT_CLASS, "w-64 max-w-full")}
                disabled={!effectiveTarget || browserOptions.categories.length === 0}
                aria-label="Select spending category or group"
              >
                {effectiveTarget && !hasSelectedCategoryOption && (
                  <option value={selectedCategoryKey}>
                    {effectiveTarget.title}
                  </option>
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

        <div className="max-h-[calc(86vh-4.25rem)] overflow-hidden">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <div className="px-4 py-12 text-center text-xs text-destructive">
              Could not load transactions: {errorMessage(error)}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState message="No transactions found for this selection." />
          ) : (
            <div className="grid max-h-[calc(86vh-4.25rem)] grid-rows-[auto_auto_minmax(14rem,1fr)] gap-3 overflow-hidden p-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi
                  label="Total spent"
                  value={formatSigned(analytics.totalSpent)}
                  helper={
                    isGroup
                      ? `Across ${effectiveTarget?.categoryIds.length ?? 0} categories`
                      : "Across this category"
                  }
                />
                <Kpi
                  label="Transactions"
                  value={analytics.transactionCount.toLocaleString()}
                  helper={`${analytics.distinctPayeeCount} payees`}
                />
                <Kpi
                  label="Average"
                  value={formatSigned(analytics.averageTransaction)}
                  helper="Per transaction"
                />
                <Kpi
                  label="Top payee"
                  value={topPayee?.label ?? "None"}
                  helper={topPayee ? `${formatSigned(topPayee.amount)} · ${topPayee.count} transactions` : "No payee"}
                />
              </div>

              <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
                <Panel
                  title={
                    isGroup
                      ? "Where the group spend went"
                      : "Where the spend went (by payee)"
                  }
                >
                  <SpendBreakdown
                    buckets={primaryBreakdown}
                    emptyLabel="No spending breakdown available."
                  />
                </Panel>

                <Panel title="When spending happened">
                  <WeeklySpending
                    buckets={analytics.spendByWeek}
                    month={effectiveTarget?.month ?? ""}
                  />
                </Panel>
              </div>

              <section className="flex min-h-0 flex-col rounded-md border border-border/70 bg-background">
                <div className="flex flex-col gap-2 border-b border-border/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative max-w-sm flex-1">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search transactions"
                      aria-label="Search transactions"
                      className="h-8 rounded-md pl-8 pr-8 text-xs"
                    />
                    {search.length > 0 && (
                      <button
                        type="button"
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setSearch("")}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="text-[10px] text-muted-foreground">
                    {visibleRows.length.toLocaleString()} of {rows.length.toLocaleString()} rows ·{" "}
                    {formatSortStatus(sort)}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {visibleRows.length === 0 ? (
                    <EmptyState message="No transactions match this search." />
                  ) : (
                    <table className="w-full min-w-[760px] border-collapse text-xs">
                      <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                        <tr>
                          <SortHeader
                            sortKey="date"
                            sort={sort}
                            className="w-px whitespace-nowrap text-left"
                            onSort={handleSort}
                          />
                          <SortHeader
                            sortKey="amount"
                            sort={sort}
                            align="right"
                            className="w-px whitespace-nowrap text-right"
                            onSort={handleSort}
                          />
                          <SortHeader
                            sortKey="payee"
                            sort={sort}
                            className="min-w-44 text-left"
                            onSort={handleSort}
                          />
                          <SortHeader
                            sortKey="category"
                            sort={sort}
                            className="w-48 text-left"
                            onSort={handleSort}
                          />
                          <SortHeader
                            sortKey="notes"
                            sort={sort}
                            className="min-w-56 text-left"
                            onSort={handleSort}
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((row) => (
                          <tr
                            key={row.id}
                            className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                          >
                            <td className="w-px whitespace-nowrap px-3 py-2 font-medium text-foreground">
                              <span title={row.date}>{formatTransactionDateLabel(row.date)}</span>
                            </td>
                            <td
                              className={cn(
                                "w-px whitespace-nowrap px-3 py-2 text-right font-sans font-semibold tabular-nums",
                                amountTone(row.amount)
                              )}
                            >
                              {formatDelta(row.amount)}
                            </td>
                            <td className="px-3 py-2">
                              <div
                                className={cn(
                                  "max-w-[20rem] truncate font-medium text-foreground",
                                  !row.payeeName && "italic text-muted-foreground"
                                )}
                                title={row.payeeName ?? "No payee"}
                              >
                                {row.payeeName ?? "No payee"}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div
                                className="max-w-[14rem] truncate font-medium text-muted-foreground"
                                title={row.categoryName ?? "Uncategorized"}
                              >
                                {row.categoryName ?? "Uncategorized"}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div
                                className="max-w-[26rem] truncate text-muted-foreground"
                                title={row.notes ?? ""}
                              >
                                {row.notes ?? ""}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="border-t border-border/70 px-3 py-1.5 text-[10px] text-muted-foreground">
                  Showing {visibleRows.length.toLocaleString()} of{" "}
                  {rows.length.toLocaleString()} transactions
                </div>
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

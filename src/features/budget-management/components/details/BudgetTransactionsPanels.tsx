"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSignedWhole } from "../../lib/format";
import type { TransactionSpendBucket } from "../../lib/budgetTransactionAnalytics";
import type { Accent, BreakdownDimension } from "./budgetTransactionsDialog.helpers";

/**
 * One region of the dialog body.
 *
 * Flush to the dialog's edges and separated by single rules rather than floated
 * as a rounded card. Three cards inside a bordered dialog stack four rounded
 * edges within a few pixels of each other, and the nesting reads as decoration
 * rather than as structure; a straight rule says "these are different things"
 * with one line. The padding moves inward so the content still breathes.
 */
export function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  /**
   * What the panel is showing, or what to do with it. It changes with the
   * state - once a row is selectable the caption says so, because a bar chart
   * that filters a table is not self-evidently clickable.
   */
  subtitle?: string;
  /** Optional control on the title row - a view toggle, not a command. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col px-4 pb-2 pt-3">
      <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

const BREAKDOWN_VISIBLE_LIMIT = 8;

/** What one row of the "where" list is, in each dimension. */
export const BREAKDOWN_LABELS: Record<BreakdownDimension, string> = {
  group: "Group",
  category: "Category",
  payee: "Payee",
};

/*
 * Name on the left, three right-aligned numeric columns, bar on its own line.
 *
 * Amount, count and share used to run together on one line, so reading "is
 * this one bigger than that one" meant re-finding each figure on every row. In
 * columns the comparison is vertical and needs no reading at all. The bar drops
 * below them and takes the full row width: squeezed into a column between the
 * name and the figures it was a few dozen pixels long, which is too short to
 * show a difference - and length is the only thing a bar has to say with.
 */
const BREAKDOWN_GRID =
  "grid grid-cols-[minmax(0,1fr)_4.25rem_2.5rem_2.5rem] items-baseline gap-x-1.5";
/*
 * The same grid with a monthly-average column, used when the range spans more
 * than one month. Over eight months a row's total is hard to hold against a
 * budget that is written per month; the same figure divided by the months is
 * directly comparable to one. It adds no information - every row is divided by
 * the same number, so the ranking is untouched - only readability, which is
 * why it appears exactly when the division is not one.
 */
const BREAKDOWN_GRID_RANGE =
  "grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_2.5rem_2.5rem] items-baseline gap-x-1.5";

export type BreakdownSortKey = "label" | "amount" | "count";

/** One sortable column heading in the "where" list. */
function BreakdownHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  sortKey: BreakdownSortKey;
  sort: { key: BreakdownSortKey; desc: boolean };
  onSort: (key: BreakdownSortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label === "%" ? "share" : label.toLowerCase()}`}
      className={cn(
        "flex min-w-0 items-center gap-0.5 transition-colors hover:text-foreground",
        align === "right" ? "justify-end" : "justify-start",
        active && "text-foreground",
        className
      )}
    >
      <span className="truncate">{label}</span>
      <Icon className={cn("h-2.5 w-2.5 shrink-0", !active && "opacity-35")} aria-hidden="true" />
    </button>
  );
}

export function SpendBreakdown({
  buckets,
  emptyLabel,
  columnLabel,
  accent,
  isIncome,
  budgetsByLabel,
  monthCount,
  selectedIds,
  onSelect,
}: {
  buckets: TransactionSpendBucket[];
  emptyLabel: string;
  /** What the first column holds - "Category" or "Payee". */
  columnLabel: string;
  accent: Accent;
  isIncome: boolean;
  /**
   * Budgeted total per bucket label, summed over the same months the amounts
   * cover. Null when the list is payees - a merchant has no plan to be measured
   * against - and a label missing from the map simply has no budget.
   */
  budgetsByLabel: Map<string, number> | null;
  /** Months the amounts cover. Above one, each row also shows its per-month average. */
  monthCount: number;
  selectedIds: string[];
  /**
   * `additive` is set when the click carried Ctrl or Cmd, meaning "add this to
   * what is already selected" rather than "show me only this".
   */
  onSelect: (id: string, additive: boolean) => void;
}) {
  /*
   * Six by default, all of them on request.
   *
   * The tail used to be an inert "+ 4 more": it named what was missing and gave
   * no way to see it, which on a payee breakdown can hide most of the list. The
   * list scrolls, so showing everything costs nothing but the scroll - and the
   * expander stays pinned below it rather than scrolling away with the rows.
   */
  const [expanded, setExpanded] = useState(false);
  /*
   * Grey means "this one is not measured against a plan", which only says
   * anything when some other row is. With nothing budgeted at all there is no
   * distinction to draw, and greying the whole list would drain the panel to
   * report that every row is alike.
   */
  const showsPlanState =
    budgetsByLabel != null &&
    buckets.some((bucket) => (budgetsByLabel.get(bucket.label) ?? 0) > 0);
  const showsMonthlyAverage = monthCount > 1;
  const grid = showsMonthlyAverage ? BREAKDOWN_GRID_RANGE : BREAKDOWN_GRID;

  /*
   * Biggest first, until asked otherwise.
   *
   * The list arrives sorted by amount and that is the right default - the
   * question a breakdown answers first is "what was the most of it". But it is
   * the wrong order for finding a particular category among forty, where the
   * name is the only thing known in advance, so the name column sorts too.
   *
   * Avg/mo and Share are monotonic in Amount - every row is divided by the same
   * months, and by the same total - so they order identically to it. They are
   * still clickable, because a column that looks like the others and does
   * nothing is worse than one that agrees with its neighbour.
   */
  const [sort, setSort] = useState<{ key: BreakdownSortKey; desc: boolean }>({
    key: "amount",
    desc: true,
  });

  const sorted = useMemo(() => {
    const direction = sort.desc ? -1 : 1;
    return [...buckets].sort((a, b) => {
      if (sort.key === "label") {
        return a.label.localeCompare(b.label) * direction;
      }
      if (sort.key === "count") {
        // Ties on count fall back to amount, so equal-sized lists of
        // transactions still read largest-first rather than arbitrarily.
        return ((a.count - b.count) * direction) || (b.amount - a.amount);
      }
      return (a.amount - b.amount) * direction;
    });
  }, [buckets, sort]);

  function toggleSort(key: BreakdownSortKey) {
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : // A fresh column opens the way that column is usually read: names
          // from A, figures from the top.
          { key, desc: key !== "label" }
    );
  }

  const visible = expanded ? sorted : sorted.slice(0, BREAKDOWN_VISIBLE_LIMIT);
  const hiddenCount = Math.max(0, buckets.length - BREAKDOWN_VISIBLE_LIMIT);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hasSelection = selected.size > 0;

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          grid,
          "shrink-0 border-b border-border/60 px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        )}
      >
        <BreakdownHeader
          label={columnLabel}
          sortKey="label"
          sort={sort}
          onSort={toggleSort}
          className="pr-2"
        />
        <BreakdownHeader label="Amount" sortKey="amount" sort={sort} onSort={toggleSort} align="right" />
        {showsMonthlyAverage && (
          <BreakdownHeader label="Avg/mo" sortKey="amount" sort={sort} onSort={toggleSort} align="right" />
        )}
        <BreakdownHeader label="Txns" sortKey="count" sort={sort} onSort={toggleSort} align="right" />
        <BreakdownHeader label="%" sortKey="amount" sort={sort} onSort={toggleSort} align="right" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((bucket) => {
          const isActive = selected.has(bucket.id);
          /*
           * How this bucket sat against its own plan, said in colour alone.
           *
           * The bar's length already answers "how much of the group was this",
           * which is a different question from "was that more than intended" -
           * and the second was nowhere on the panel, so a category could be the
           * smallest line in the group and still be the one overspent. A marker
           * or a figure would have answered it too, but at six or seven rows
           * that is six or seven more things to read; a colour is read without
           * being looked at.
           *
           * Expense: the stretch beyond the budget turns destructive, so the
           * red is proportional to the overspend rather than a flag. Income:
           * there is no tail to colour when receipts fall short of target, so
           * the whole bar goes amber. Both tones are the ones the variance pill
           * above already uses for the same two states.
           */
          const budgeted = budgetsByLabel?.get(bucket.label) ?? null;
          /*
           * Zero counts as no plan, because by the time the data reaches here
           * the two cannot be told apart: the month loader reads the budgeted
           * figure as `c.budgeted ?? 0`, so a category nobody has ever budgeted
           * and one deliberately held at zero arrive as the same number. Given
           * the ambiguity, the neutral reading is the safe one - calling it
           * overspend would accuse on a guess.
           */
          const hasPlan = budgeted != null && budgeted > 0;
          const overspend = hasPlan && !isIncome && bucket.amount > budgeted
            ? bucket.amount - budgeted
            : 0;
          const shortfall = hasPlan && isIncome && bucket.amount < budgeted;
          // Shares of this bucket's own bar, not of the panel.
          const overShare = overspend > 0 && bucket.amount > 0 ? overspend / bucket.amount : 0;
          const planNote = !hasPlan
            ? " - no budget set"
            : overspend > 0
              ? ` - ${formatSignedWhole(overspend)} over its ${formatSignedWhole(budgeted)} budget`
              : shortfall
                ? ` - ${formatSignedWhole(budgeted - bucket.amount)} below its ${formatSignedWhole(budgeted)} target`
                : ` - within its ${formatSignedWhole(budgeted)} ${isIncome ? "target" : "budget"}`;
          return (
            <button
              key={bucket.id}
              type="button"
              aria-pressed={isActive}
              /*
               * Colour is the whole signal, and colour alone is not a signal
               * everyone receives. The same reading is spelled out here, where
               * a screen reader and a hover both reach it.
               */
              title={`${bucket.label}: ${formatSignedWhole(bucket.amount)}${planNote}`}
              className={cn(
                "w-full cursor-pointer rounded px-2 py-1 text-left transition-all",
                isActive
                  ? cn(accent.tint, "ring-1", accent.ring)
                  : hasSelection
                    ? "opacity-40 hover:bg-muted/40 hover:opacity-100"
                    : "hover:bg-muted/40"
              )}
              onClick={(event) => onSelect(bucket.id, event.ctrlKey || event.metaKey)}
            >
              <span className={grid}>
                <span className="min-w-0 truncate pr-2 text-[11px] font-medium text-foreground">
                  {bucket.label}
                </span>
                <span className="text-right font-sans text-[11px] tabular-nums text-foreground">
                  {formatSignedWhole(bucket.amount)}
                </span>
                {showsMonthlyAverage && (
                  <span className="text-right font-sans text-[11px] tabular-nums text-muted-foreground">
                    {formatSignedWhole(bucket.amount / monthCount)}
                  </span>
                )}
                <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                  {bucket.count > 0 ? bucket.count.toLocaleString() : "-"}
                </span>
                <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(bucket.percentage * 100)}%
                </span>
              </span>

              <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="flex h-full overflow-hidden rounded-full"
                  style={{
                    width: `${Math.max(bucket.percentage * 100, bucket.amount > 0 ? 2 : 0)}%`,
                  }}
                >
                  <span
                    className={cn(
                      "h-full transition-colors",
                      shortfall
                        ? "bg-amber-500"
                        : showsPlanState && !hasPlan
                          ? // Not a verdict - an absence. Red here would mean
                            // "unbudgeted" and "overspent" shared a colour, and
                            // a file budgeted in part would read as a file in
                            // trouble, burying the rows that actually are.
                            "bg-muted-foreground/40"
                          : isActive
                            ? accent.solid
                            : accent.soft
                    )}
                    style={{ width: `${(1 - overShare) * 100}%` }}
                  />
                  {overShare > 0 && (
                    <span
                      className="h-full bg-destructive transition-colors"
                      style={{ width: `${overShare * 100}%` }}
                    />
                  )}
                </span>
              </span>

              {/*
                The bar's colour is the only thing saying whether this row is
                over its budget, and colour announces nothing. The reading the
                hover title carries goes in here too, where a screen reader
                reaches it.
              */}
              {planNote && <span className="sr-only">{planNote}</span>}
            </button>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="w-full shrink-0 rounded text-center text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          {expanded ? "Show fewer" : `+ ${hiddenCount} more`}
        </button>
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

/** Tallest bar's share of the plot height, leaving room for its value label. */
const CHART_MAX_BAR_PCT = 85;

export function WeeklySpending({
  buckets,
  month,
  accent,
  averageLabel,
  selectedIds,
  onSelect,
}: {
  /*
   * The wider bucket type, because this chart never reads `sortKey` - the
   * buckets arrive in the order they should be drawn. Requiring the narrower
   * one would have kept the weekday pattern out for a field nothing uses.
   */
  buckets: TransactionSpendBucket[];
  month: string;
  accent: Accent;
  /** What the mean is a mean of - "Monthly average" or "Daily average". */
  averageLabel: string;
  selectedIds: string[];
  /** See `SpendBreakdown` - set when the click carried Ctrl or Cmd. */
  onSelect: (id: string, additive: boolean) => void;
}) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const maxAmount = Math.max(...buckets.map((b) => b.amount), 1);
  /*
   * The mean across every bucket in the period, empty ones included.
   *
   * A month with nothing in it is a month that was budgeted for and not spent,
   * so it belongs in the denominator: excluding it answers "what did I average
   * in the months I spent" rather than "what did I average", and the second is
   * the figure the plan is written against. It also keeps the line comparable
   * to the budget strip above, which divides by the same months.
   */
  const meanAmount =
    buckets.length > 1
      ? buckets.reduce((total, bucket) => total + bucket.amount, 0) / buckets.length
      : 0;
  const meanPct = meanAmount > 0 ? (meanAmount / maxAmount) * CHART_MAX_BAR_PCT : 0;

  return (
    <div className="flex h-full flex-col">
      {/*
        The plot. Columns are drawn as columns rather than as filled slots: the
        slot used to carry its own muted background for the full height, so
        every bucket read as a block of roughly equal weight and the actual bar
        was the darker part of it. Only the bar is painted now, and it is capped
        in width so that a chart of five buckets does not turn each one into a
        panel-wide slab.
      */}
      <div className="relative min-h-0 flex-1 border-b border-border">
        {meanPct > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 z-10"
            style={{ bottom: `${meanPct}%` }}
          >
            <div className={cn("border-t border-dashed", accent.border)} />
            {/*
              The label rides the line, on an opaque chip. It used to float
              above the line at the panel edge with no background, where it
              collided with whichever bar happened to be tallest and read as
              one more number in a row of numbers rather than as the line's
              name.
            */}
            <span
              className={cn(
                "absolute right-0 top-0 -translate-y-1/2 whitespace-nowrap rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums shadow-sm",
                accent.border,
                accent.text
              )}
            >
              {averageLabel} {formatSignedWhole(meanAmount)}
            </span>
          </div>
        )}

        <div className="flex h-full items-end gap-1.5">
          {buckets.map((bucket) => {
            const isActive = selected.has(bucket.id);
            const isEmpty = bucket.amount <= 0;
            const heightPct = isEmpty
              ? 0
              : Math.max((bucket.amount / maxAmount) * CHART_MAX_BAR_PCT, 4);
            return (
              <button
                key={bucket.id}
                type="button"
                aria-pressed={isActive}
                aria-label={`${bucket.label}: ${formatSignedWhole(bucket.amount)}`}
                title={`${bucket.label}: ${formatSignedWhole(bucket.amount)}`}
                className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end overflow-hidden rounded-t-sm transition-colors hover:bg-muted/40"
                onClick={(event) => onSelect(bucket.id, event.ctrlKey || event.metaKey)}
              >
                <span
                  className={cn(
                    "block w-full shrink-0 truncate pb-1 text-center font-sans text-[11px] tabular-nums",
                    isActive ? cn("font-semibold", accent.text) : "text-muted-foreground"
                  )}
                >
                  {isEmpty ? "" : formatSignedWhole(bucket.amount)}
                </span>
                {/*
                  An empty bucket draws nothing at all. It used to get a 2px
                  stub, which is exactly what a very small real amount looks
                  like - so "no transactions" and "one small transaction" were
                  the same picture.
                */}
                <span
                  className={cn(
                    "mx-auto block w-full max-w-[2.25rem] shrink-0 rounded-t-sm transition-[height,background-color]",
                    isActive ? accent.solid : cn(accent.soft, "group-hover:opacity-80")
                  )}
                  style={{ height: `${heightPct}%` }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Bucket labels - week number plus start date, or the bucket's own name */}
      <div className="flex shrink-0 gap-1.5 pt-1.5">
        {buckets.map((bucket) => {
          const isWeek = bucket.id.startsWith("week-");
          const isActive = selected.has(bucket.id);
          /*
           * A month bucket's year drops to its own line.
           *
           * Twelve months across half a dialog leaves each slot about forty
           * pixels, and "Jan 2026" on one line simply does not fit - it
           * truncated to "Jan 2..." and the year, the thing that distinguishes
           * one January from another, was the half that got cut. Stacking it
           * matches the weekly view, which already puts its start date
           * underneath.
           */
          const monthId = /^\d{4}-\d{2}$/.test(bucket.id) ? bucket.id : null;
          const primary = isWeek
            ? bucket.label.replace("Week ", "W")
            : monthId
              ? bucket.label.replace(` ${monthId.slice(0, 4)}`, "")
              : bucket.label;
          const secondary = isWeek
            ? weekStartDate(month, bucket.id)
            : (monthId?.slice(0, 4) ?? "");
          return (
            <div
              key={bucket.id}
              className={cn(
                "min-w-0 flex-1 text-center transition-colors",
                isActive ? accent.text : "text-muted-foreground"
              )}
            >
              <div className={cn("truncate text-[10px]", isActive && "font-semibold")}>
                {primary}
              </div>
              {secondary && <div className="truncate text-[9px]">{secondary}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

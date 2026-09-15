import type { BudgetTransactionSide } from "./budgetTransactionBrowser";
import type { BudgetTransactionRow } from "./budgetTransactionsQuery";

export type TransactionSpendBucket = {
  id: string;
  label: string;
  amount: number;
  count: number;
  percentage: number;
};

export type TransactionTimeBucket = TransactionSpendBucket & {
  sortKey: string;
};

/**
 * Headline figures over a set of rows.
 *
 * Split from the breakdowns below because the dialog needs the three groups
 * over three *different* row sets - the strip narrows on a category selection,
 * the chart on a breakdown selection, the breakdown on a chart selection - and
 * a single builder meant computing all three for each of them. Nine bucket sets
 * were produced per render where three were read.
 */
export type TransactionTotals = {
  totalSpent: number;
  netSpent: number;
  transactionCount: number;
  spendingTransactionCount: number;
  averageTransaction: number;
};

/** Who and what the money went to. */
export type TransactionSpendBreakdown = {
  spendByPayee: TransactionSpendBucket[];
  spendByCategory: TransactionSpendBucket[];
};

/** When it happened. */
export type TransactionTimeBreakdown = {
  spendByWeek: TransactionTimeBucket[];
  /**
   * One bucket per calendar month present in the rows, oldest first.
   *
   * The week buckets are weeks *of a month*, so across a range they would add
   * every first week together and call it Week 1. A range is grouped by month
   * instead, which is the unit it actually spans.
   */
  spendByMonth: TransactionTimeBucket[];
  weekdayPattern: TransactionSpendBucket[];
};

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseTransactionDate(date: string): Date | null {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function transactionSpendAmount(row: BudgetTransactionRow): number {
  return row.amount < 0 ? Math.abs(row.amount) : 0;
}

/**
 * The magnitude of a transaction in the natural direction of `side`: an
 * expense outflow counts its negative amount, an income inflow counts its
 * positive amount, and anything moving the other way (a refund on the expense
 * side, a chargeback on the income side) contributes zero to the gross figure.
 * The signed net is tracked separately so those reversals still net out.
 */
function transactionFlowAmount(
  row: BudgetTransactionRow,
  side: BudgetTransactionSide
): number {
  if (side === "income") return row.amount > 0 ? row.amount : 0;
  return row.amount < 0 ? Math.abs(row.amount) : 0;
}

function percentage(amount: number, total: number): number {
  return total > 0 ? amount / total : 0;
}

function sortedBuckets(
  values: Map<string, { label: string; amount: number; count: number }>,
  totalSpent: number
): TransactionSpendBucket[] {
  return [...values.entries()]
    .map(([id, bucket]) => ({
      id,
      label: bucket.label,
      amount: bucket.amount,
      count: bucket.count,
      percentage: percentage(bucket.amount, totalSpent),
    }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

function addBucketAmount(
  values: Map<string, { label: string; amount: number; count: number }>,
  id: string,
  label: string,
  amount: number
) {
  const current = values.get(id) ?? { label, amount: 0, count: 0 };
  current.amount += amount;
  current.count += 1;
  values.set(id, current);
}

function weekBucket(date: string): { id: string; label: string; sortKey: string } {
  const parsed = parseTransactionDate(date);
  const day = parsed ? parsed.getUTCDate() : Number(date.slice(-2));
  const week = Math.min(5, Math.max(1, Math.floor((day - 1) / 7) + 1));
  return {
    id: `week-${week}`,
    label: `Week ${week}`,
    sortKey: String(week).padStart(2, "0"),
  };
}

function weekdayBucket(date: string): string {
  const parsed = parseTransactionDate(date);
  if (!parsed) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(parsed);
}

/** "2026-03" → "Mar 2026", without pulling in a formatter for one label. */
function monthLabelFor(month: string): string {
  const [year, mo] = month.split("-").map(Number);
  if (!year || !mo) return month;
  const name = new Date(Date.UTC(year, mo - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${name} ${year}`;
}

function sortTimeBuckets(
  values: Map<string, { label: string; amount: number; count: number; sortKey: string }>,
  totalSpent: number
): TransactionTimeBucket[] {
  return [...values.entries()]
    .map(([id, bucket]) => ({
      id,
      label: bucket.label,
      amount: bucket.amount,
      count: bucket.count,
      sortKey: bucket.sortKey,
      percentage: percentage(bucket.amount, totalSpent),
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function buildWeekBuckets(
  values: Map<string, { label: string; amount: number; count: number; sortKey: string }>,
  totalSpent: number
): TransactionTimeBucket[] {
  return [1, 2, 3, 4, 5].map((week) => {
    const id = `week-${week}`;
    const bucket = values.get(id) ?? {
      label: `Week ${week}`,
      amount: 0,
      count: 0,
      sortKey: String(week).padStart(2, "0"),
    };
    return {
      id,
      label: bucket.label,
      amount: bucket.amount,
      count: bucket.count,
      sortKey: bucket.sortKey,
      percentage: percentage(bucket.amount, totalSpent),
    };
  });
}

export function buildTransactionTotals(
  rows: BudgetTransactionRow[],
  side: BudgetTransactionSide = "expense"
): TransactionTotals {
  let totalSpent = 0;
  let spendingTransactionCount = 0;
  let signedSum = 0;

  for (const row of rows) {
    const amount = transactionFlowAmount(row, side);
    if (amount > 0) {
      totalSpent += amount;
      spendingTransactionCount += 1;
    }
    signedSum += row.amount;
  }

  // netSpent is the signed net in the side's natural direction: -(sum of signed
  // amounts) for expenses (a net outflow is positive), +(sum) for income (a net
  // inflow is positive). It must stay signed — a net refund on the expense side
  // (inflow > outflow) is legitimately negative and must not be clamped to zero,
  // or refunds would vanish from the "Spent" figure and the variance. totalSpent
  // above counts only rows moving the natural way and drives bar-chart geometry.
  const netSpent = side === "income" ? signedSum : -signedSum;

  return {
    totalSpent,
    netSpent,
    transactionCount: rows.length,
    spendingTransactionCount,
    averageTransaction: rows.length > 0 ? Math.round(totalSpent / rows.length) : 0,
  };
}

export function buildSpendBreakdown(
  rows: BudgetTransactionRow[],
  side: BudgetTransactionSide = "expense"
): TransactionSpendBreakdown {
  const byPayee = new Map<string, { label: string; amount: number; count: number }>();
  const byCategory = new Map<string, { label: string; amount: number; count: number }>();
  let totalSpent = 0;

  for (const row of rows) {
    const amount = transactionFlowAmount(row, side);
    if (amount > 0) totalSpent += amount;

    addBucketAmount(byPayee, row.payeeName?.trim() || "No payee", row.payeeName?.trim() || "No payee", amount);
    const categoryLabel = row.categoryName?.trim() || "Uncategorized";
    addBucketAmount(byCategory, categoryLabel, categoryLabel, amount);
  }

  return {
    spendByPayee: sortedBuckets(byPayee, totalSpent),
    spendByCategory: sortedBuckets(byCategory, totalSpent),
  };
}

export function buildTimeBreakdown(
  rows: BudgetTransactionRow[],
  side: BudgetTransactionSide = "expense"
): TransactionTimeBreakdown {
  const byWeek = new Map<
    string,
    { label: string; amount: number; count: number; sortKey: string }
  >();
  const byMonth = new Map<
    string,
    { label: string; amount: number; count: number; sortKey: string }
  >();
  const byWeekday = new Map<string, { label: string; amount: number; count: number }>();
  let totalSpent = 0;

  for (const row of rows) {
    const amount = transactionFlowAmount(row, side);
    if (amount > 0) totalSpent += amount;

    const week = weekBucket(row.date);
    const currentWeek = byWeek.get(week.id) ?? {
      label: week.label,
      amount: 0,
      count: 0,
      sortKey: week.sortKey,
    };
    currentWeek.amount += amount;
    currentWeek.count += 1;
    byWeek.set(week.id, currentWeek);

    const monthId = row.date.slice(0, 7);
    if (monthId.length === 7) {
      const currentMonth = byMonth.get(monthId) ?? {
        label: monthLabelFor(monthId),
        amount: 0,
        count: 0,
        sortKey: monthId,
      };
      currentMonth.amount += amount;
      currentMonth.count += 1;
      byMonth.set(monthId, currentMonth);
    }

    const weekday = weekdayBucket(row.date);
    addBucketAmount(byWeekday, weekday, weekday, amount);
  }

  return {
    spendByWeek: buildWeekBuckets(byWeek, totalSpent),
    spendByMonth: sortTimeBuckets(byMonth, totalSpent),
    // Every weekday is present whether or not it carries anything, so the chart
    // draws Mon-Sun rather than only the days that happened to have spending.
    weekdayPattern: WEEKDAY_ORDER.map((label) => {
      const bucket = byWeekday.get(label) ?? { label, amount: 0, count: 0 };
      return {
        id: label,
        label,
        amount: bucket.amount,
        count: bucket.count,
        percentage: percentage(bucket.amount, totalSpent),
      };
    }),
  };
}

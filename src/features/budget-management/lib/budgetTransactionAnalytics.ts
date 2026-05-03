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

export type RepeatedPayee = {
  payeeName: string;
  count: number;
  amount: number;
};

export type BudgetTransactionAnalytics = {
  totalSpent: number;
  netSpent: number;
  transactionCount: number;
  spendingTransactionCount: number;
  averageTransaction: number;
  largestTransaction: BudgetTransactionRow | null;
  distinctPayeeCount: number;
  noPayeeCount: number;
  spendByPayee: TransactionSpendBucket[];
  spendByCategory: TransactionSpendBucket[];
  spendByWeek: TransactionTimeBucket[];
  spendByDay: TransactionTimeBucket[];
  weekdayPattern: TransactionSpendBucket[];
  topTransactions: BudgetTransactionRow[];
  outlierTransactions: BudgetTransactionRow[];
  repeatedPayees: RepeatedPayee[];
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

function transactionMagnitude(row: BudgetTransactionRow): number {
  return Math.abs(row.amount);
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

function dayBucket(date: string): { id: string; label: string; sortKey: string } {
  const parsed = parseTransactionDate(date);
  if (!parsed) return { id: date, label: date, sortKey: date };
  const label = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
  return { id: date, label, sortKey: date };
}

function weekdayBucket(date: string): string {
  const parsed = parseTransactionDate(date);
  if (!parsed) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(parsed);
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

export function buildBudgetTransactionAnalytics(
  rows: BudgetTransactionRow[]
): BudgetTransactionAnalytics {
  const byPayee = new Map<string, { label: string; amount: number; count: number }>();
  const byCategory = new Map<string, { label: string; amount: number; count: number }>();
  const byWeek = new Map<
    string,
    { label: string; amount: number; count: number; sortKey: string }
  >();
  const byDay = new Map<
    string,
    { label: string; amount: number; count: number; sortKey: string }
  >();
  const byWeekday = new Map<string, { label: string; amount: number; count: number }>();
  const repeatedPayeeMap = new Map<string, { count: number; amount: number }>();
  const distinctPayees = new Set<string>();

  let totalSpent = 0;
  let spendingTransactionCount = 0;
  let noPayeeCount = 0;
  let largestTransaction: BudgetTransactionRow | null = null;

  for (const row of rows) {
    const amount = transactionSpendAmount(row);
    const payeeName = row.payeeName?.trim() || "";
    const payeeLabel = payeeName || "No payee";
    const categoryLabel = row.categoryName?.trim() || "Uncategorized";

    if (amount > 0) {
      totalSpent += amount;
      spendingTransactionCount += 1;
    }

    if (payeeName) {
      distinctPayees.add(payeeName);
      const repeated = repeatedPayeeMap.get(payeeName) ?? { count: 0, amount: 0 };
      repeated.count += 1;
      repeated.amount += amount;
      repeatedPayeeMap.set(payeeName, repeated);
    } else {
      noPayeeCount += 1;
    }

    addBucketAmount(byPayee, payeeLabel, payeeLabel, amount);
    addBucketAmount(byCategory, categoryLabel, categoryLabel, amount);

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

    const day = dayBucket(row.date);
    const currentDay = byDay.get(day.id) ?? {
      label: day.label,
      amount: 0,
      count: 0,
      sortKey: day.sortKey,
    };
    currentDay.amount += amount;
    currentDay.count += 1;
    byDay.set(day.id, currentDay);

    const weekday = weekdayBucket(row.date);
    addBucketAmount(byWeekday, weekday, weekday, amount);

    if (
      !largestTransaction ||
      transactionMagnitude(row) > transactionMagnitude(largestTransaction)
    ) {
      largestTransaction = row;
    }
  }

  // netSpent matches the budget panel: -(sum of all signed amounts).
  // totalSpent only counts spending rows (ignoring refunds) and is used for
  // bar-chart percentages. netSpent is what the dialog shows as "Spent".
  const netSpent = Math.max(0, rows.reduce((sum, row) => sum - row.amount, 0));

  const averageTransaction =
    rows.length > 0 ? Math.round(totalSpent / rows.length) : 0;
  const topTransactions = [...rows]
    .sort(
      (a, b) =>
        transactionMagnitude(b) - transactionMagnitude(a) ||
        b.date.localeCompare(a.date)
    )
    .slice(0, 10);
  const outlierThreshold =
    spendingTransactionCount > 0
      ? Math.max(totalSpent / spendingTransactionCount * 2.5, 0)
      : 0;
  const outlierTransactions =
    outlierThreshold > 0
      ? rows.filter((row) => transactionSpendAmount(row) >= outlierThreshold)
      : [];
  const repeatedPayees = [...repeatedPayeeMap.entries()]
    .filter(([, value]) => value.count > 1)
    .map(([payeeName, value]) => ({ payeeName, ...value }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count)
    .slice(0, 5);

  const weekdayBuckets = WEEKDAY_ORDER.map((label) => {
    const bucket = byWeekday.get(label) ?? { label, amount: 0, count: 0 };
    return {
      id: label,
      label,
      amount: bucket.amount,
      count: bucket.count,
      percentage: percentage(bucket.amount, totalSpent),
    };
  });

  return {
    totalSpent,
    netSpent,
    transactionCount: rows.length,
    spendingTransactionCount,
    averageTransaction,
    largestTransaction,
    distinctPayeeCount: distinctPayees.size,
    noPayeeCount,
    spendByPayee: sortedBuckets(byPayee, totalSpent),
    spendByCategory: sortedBuckets(byCategory, totalSpent),
    spendByWeek: buildWeekBuckets(byWeek, totalSpent),
    spendByDay: sortTimeBuckets(byDay, totalSpent),
    weekdayPattern: weekdayBuckets,
    topTransactions,
    outlierTransactions,
    repeatedPayees,
  };
}

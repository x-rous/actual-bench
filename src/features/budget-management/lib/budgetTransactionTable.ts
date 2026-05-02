import { formatDelta, formatSigned } from "./format";
import type { BudgetTransactionRow } from "./budgetTransactionsQuery";

export type BudgetTransactionSortKey =
  | "date"
  | "amount"
  | "payee"
  | "category"
  | "notes";

export type BudgetTransactionSortDirection = "asc" | "desc";

export type BudgetTransactionSort = {
  key: BudgetTransactionSortKey;
  direction: BudgetTransactionSortDirection;
};

const TEXT_SORT_KEYS = new Set<BudgetTransactionSortKey>([
  "payee",
  "category",
  "notes",
]);

function normalizeSearchValue(value: string): string {
  return value.replace(/\u2212/g, "-").trim().toLowerCase();
}

function nullableText(value: string | null): string {
  return value?.trim() ?? "";
}

export function formatTransactionDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;

  const value = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`.trim();
}

function rowSearchText(row: BudgetTransactionRow): string {
  return normalizeSearchValue(
    [
      row.date,
      formatTransactionDateLabel(row.date),
      row.amount.toString(),
      (row.amount / 100).toFixed(2),
      formatDelta(row.amount),
      formatSigned(row.amount),
      nullableText(row.payeeName),
      nullableText(row.categoryName),
      nullableText(row.notes),
    ].join(" ")
  );
}

export function filterBudgetTransactions(
  rows: BudgetTransactionRow[],
  query: string
): BudgetTransactionRow[] {
  const search = normalizeSearchValue(query);
  if (search.length === 0) return rows;
  return rows.filter((row) => rowSearchText(row).includes(search));
}

function textValue(row: BudgetTransactionRow, key: BudgetTransactionSortKey) {
  if (key === "payee") return nullableText(row.payeeName);
  if (key === "category") return nullableText(row.categoryName);
  if (key === "notes") return nullableText(row.notes);
  return "";
}

function compareText(
  a: BudgetTransactionRow,
  b: BudgetTransactionRow,
  key: BudgetTransactionSortKey,
  direction: BudgetTransactionSortDirection
): number {
  const left = textValue(a, key);
  const right = textValue(b, key);
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const result = left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return direction === "asc" ? result : -result;
}

function compareRows(
  a: BudgetTransactionRow,
  b: BudgetTransactionRow,
  sort: BudgetTransactionSort
): number {
  const direction = sort.direction === "asc" ? 1 : -1;

  if (sort.key === "date") {
    return a.date.localeCompare(b.date) * direction;
  }

  if (sort.key === "amount") {
    const aSpend = a.amount < 0 ? Math.abs(a.amount) : 0;
    const bSpend = b.amount < 0 ? Math.abs(b.amount) : 0;
    return (aSpend - bSpend || Math.abs(a.amount) - Math.abs(b.amount)) * direction;
  }

  if (TEXT_SORT_KEYS.has(sort.key)) {
    return compareText(a, b, sort.key, sort.direction);
  }

  return 0;
}

export function sortBudgetTransactions(
  rows: BudgetTransactionRow[],
  sort: BudgetTransactionSort
): BudgetTransactionRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const result = compareRows(a.row, b.row, sort);
      return result === 0 ? a.index - b.index : result;
    })
    .map(({ row }) => row);
}

export function prepareBudgetTransactionRows(
  rows: BudgetTransactionRow[],
  query: string,
  sort: BudgetTransactionSort
): BudgetTransactionRow[] {
  return sortBudgetTransactions(filterBudgetTransactions(rows, query), sort);
}

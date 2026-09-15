import { runQuery } from "@/lib/api/query";
import { firstDayOfMonth, lastDayOfMonth } from "@/lib/budget/monthMath";
import type { ConnectionInstance } from "@/store/connection";

export type BudgetTransactionRow = {
  id: string;
  date: string;
  amount: number;
  payeeName: string | null;
  categoryName: string | null;
  notes: string | null;
};

type RawBudgetTransactionRow = {
  id?: unknown;
  date?: unknown;
  amount?: unknown;
  "payee.name"?: unknown;
  "category.name"?: unknown;
  notes?: unknown;
};

type BudgetTransactionsResponse = {
  data: RawBudgetTransactionRow[];
};

export type BudgetTransactionsQueryParams = {
  /** First month of the range, `YYYY-MM`. */
  monthStart: string;
  /** Last month of the range, inclusive. Equal to `monthStart` for one month. */
  monthEnd: string;
  categoryIds: string[];
  /**
   * Optional row cap. Omitted - the normal case - returns every matching row.
   *
   * The drill-down used to cap at 1,500 and disclose the truncation, because
   * every row went into the DOM and a busy group over a year would lock the
   * tab. The table windows its rows now, so the cap was protecting against a
   * cost that no longer exists - and it made the breakdowns and the chart
   * describe a partial page while the headline described the whole set.
   */
  limit?: number | null;
};

/**
 * Shared filter for a month range + category set, on-budget accounts only.
 *
 * A date range rather than a month equality, because the figures this backs are
 * sums over a period: a category group's eight closed months is one number on
 * screen, and a dialog that could only answer for one month could never agree
 * with it.
 *
 * One month is simply a range whose ends match, so there is no second code path
 * to keep in step - the case that used `$transform: "$month"` now runs through
 * the same filter as every other. The ends come from `lastDayOfMonth`, which
 * derives the length rather than assuming it, so a February in a leap year does
 * not quietly lose its 29th.
 */
function budgetTransactionsFilter(
  monthStart: string,
  monthEnd: string,
  categoryIds: string[]
) {
  return {
    $and: [
      { date: { $gte: firstDayOfMonth(monthStart) } },
      { date: { $lte: lastDayOfMonth(monthEnd) } },
      { category: { $oneof: categoryIds } },
      { "account.offbudget": false },
    ],
  };
}

export function buildBudgetTransactionsQuery({
  monthStart,
  monthEnd,
  categoryIds,
  limit = null,
}: BudgetTransactionsQueryParams) {
  return {
    ActualQLquery: {
      table: "transactions",
      options: { splits: "inline" },
      filter: budgetTransactionsFilter(monthStart, monthEnd, categoryIds),
      select: [
        "id",
        "date",
        "amount",
        "payee.name",
        "category.name",
        "notes",
      ],
      orderBy: [{ date: "desc" }],
      // The key is left off entirely rather than set to something huge: an
      // absent limit is the query language's own way of saying "all of them",
      // and a sentinel would only be a cap we had guessed was large enough.
      ...(limit == null ? {} : { limit }),
    },
  };
}

/**
 * Aggregate companion to the row query: the true signed total and row count
 * across the *entire* matching set, with no row limit. Drives the reconciled
 * headline KPIs so they stay correct even when the row list is capped.
 */
export function buildBudgetTransactionsSummaryQuery({
  monthStart,
  monthEnd,
  categoryIds,
}: BudgetTransactionsQueryParams) {
  return {
    ActualQLquery: {
      table: "transactions",
      options: { splits: "inline" },
      filter: budgetTransactionsFilter(monthStart, monthEnd, categoryIds),
      select: [
        { total: { $sum: "$amount" } },
        { count: { $count: "$id" } },
      ],
    },
  };
}

export type BudgetTransactionsSummary = {
  /** Row count across the whole matching set (not just the fetched page). */
  count: number;
  /** Signed sum of `amount` across the whole matching set. */
  total: number;
};

function parseString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseAmount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeTransactionRow(
  row: RawBudgetTransactionRow
): BudgetTransactionRow | null {
  const id = parseString(row.id);
  const date = parseString(row.date);
  if (!id || !date) return null;

  return {
    id,
    date,
    amount: parseAmount(row.amount),
    payeeName: parseString(row["payee.name"]),
    categoryName: parseString(row["category.name"]),
    notes: parseString(row.notes),
  };
}

function hasTransactionData(
  response: BudgetTransactionsResponse | null | undefined
): response is BudgetTransactionsResponse {
  return response != null && Array.isArray(response.data);
}

function isRawTransactionRow(row: unknown): row is RawBudgetTransactionRow {
  return row != null && typeof row === "object" && !Array.isArray(row);
}

export async function fetchBudgetTransactions(
  connection: ConnectionInstance,
  params: BudgetTransactionsQueryParams
): Promise<BudgetTransactionRow[]> {
  if (params.categoryIds.length === 0) return [];

  const response = await runQuery<BudgetTransactionsResponse>(
    connection,
    buildBudgetTransactionsQuery(params)
  );

  if (!hasTransactionData(response)) {
    throw new Error(
      "Budget transactions query returned an invalid response: missing data array"
    );
  }

  return response.data
    .filter(isRawTransactionRow)
    .map(normalizeTransactionRow)
    .filter((row): row is BudgetTransactionRow => row != null);
}

type RawSummaryRow = { total?: unknown; count?: unknown };

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Fetches the aggregate total + count for the drill-down's full matching set.
 * Returns `null` when the aggregate response can't be understood (e.g. a
 * transport that doesn't support aggregate selects) so callers can fall back to
 * row-derived figures plus an explicit truncation notice.
 */
export async function fetchBudgetTransactionsSummary(
  connection: ConnectionInstance,
  params: BudgetTransactionsQueryParams
): Promise<BudgetTransactionsSummary | null> {
  if (params.categoryIds.length === 0) return { count: 0, total: 0 };

  const response = await runQuery<{ data?: unknown }>(
    connection,
    buildBudgetTransactionsSummaryQuery(params)
  );

  const data = (response as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  // No matching transactions is a valid, understood result: zero of both.
  if (data.length === 0) return { count: 0, total: 0 };

  const row = data[0] as RawSummaryRow;
  const count = parseFiniteNumber(row?.count);
  const total = parseFiniteNumber(row?.total);
  if (count == null) return null;
  return { count, total: total ?? 0 };
}

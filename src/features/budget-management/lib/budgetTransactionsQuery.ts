import { runQuery } from "@/lib/api/query";
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
  month: string;
  categoryIds: string[];
  limit?: number;
};

export function buildBudgetTransactionsQuery({
  month,
  categoryIds,
  limit = 500,
}: BudgetTransactionsQueryParams) {
  return {
    ActualQLquery: {
      table: "transactions",
      options: { splits: "inline" },
      filter: {
        $and: [
          { date: { $transform: "$month", $eq: month } },
          { category: { $oneof: categoryIds } },
          { "account.offbudget": false },
        ],
      },
      select: [
        "id",
        "date",
        "amount",
        "payee.name",
        "category.name",
        "notes",
      ],
      orderBy: [{ date: "desc" }],
      limit,
    },
  };
}

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

export async function fetchBudgetTransactions(
  connection: ConnectionInstance,
  params: BudgetTransactionsQueryParams
): Promise<BudgetTransactionRow[]> {
  if (params.categoryIds.length === 0) return [];

  const response = await runQuery<BudgetTransactionsResponse>(
    connection,
    buildBudgetTransactionsQuery(params)
  );

  return response.data
    .map(normalizeTransactionRow)
    .filter((row): row is BudgetTransactionRow => row != null);
}

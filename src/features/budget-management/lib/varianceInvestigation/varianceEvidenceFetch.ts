import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";
import {
  fetchBudgetTransactionsSummary,
  parseBudgetTransactionRows,
  type BudgetTransactionRow,
} from "../budgetTransactionsQuery";
import {
  buildLargestTransactionsQuery,
  type EvidenceQueryParams,
} from "./varianceEvidence";

export type LargestTransactions = {
  /** The largest rows, in order, at most `limit` of them. */
  rows: BudgetTransactionRow[];
  /**
   * How many transactions match in all, or `null` when the transport cannot
   * count. The panel then drops the "of N" rather than guessing.
   */
  total: number | null;
};

/**
 * One small page of the largest transactions for a category set and range.
 *
 * The count is best-effort: a transport that cannot run an aggregate select
 * still returns the rows, as in the spending drill-down.
 */
export async function fetchLargestTransactions(
  connection: ConnectionInstance,
  params: EvidenceQueryParams
): Promise<LargestTransactions> {
  if (params.categoryIds.length === 0) return { rows: [], total: 0 };

  const [response, summary] = await Promise.all([
    runQuery<{ data?: unknown }>(connection, buildLargestTransactionsQuery(params)),
    fetchBudgetTransactionsSummary(connection, {
      monthStart: params.monthStart,
      monthEnd: params.monthEnd,
      categoryIds: params.categoryIds,
    }).catch(() => null),
  ]);

  return { rows: parseBudgetTransactionRows(response), total: summary?.count ?? null };
}

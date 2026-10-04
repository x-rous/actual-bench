import {
  budgetTransactionsFilter,
  type BudgetTransactionRow,
} from "../budgetTransactionsQuery";
import type { VarianceModel } from "./varianceViewModel";
import type { VarianceSide } from "./varianceMath";

/**
 * Largest-transactions evidence for the Variance Drivers dialog.
 *
 * This is a supporting view, loaded on demand. Every variance figure comes
 * from the monthly budget payload; nothing summed from these rows can change
 * one, and the panel says so.
 */

/** Rows asked for at first, then on each "Show more". */
export const EVIDENCE_PAGE_SIZES = [10, 25, 50] as const;

export function nextEvidenceLimit(current: number): number {
  return EVIDENCE_PAGE_SIZES.find((size) => size > current) ?? current;
}

export function hasMoreEvidence(current: number): boolean {
  return nextEvidenceLimit(current) !== current;
}

export type EvidenceQueryParams = {
  /** First month of the range, `YYYY-MM`. */
  monthStart: string;
  /** Last month of the range, inclusive. */
  monthEnd: string;
  categoryIds: string[];
  side: VarianceSide;
  limit: number;
};

/**
 * The biggest movements first, capped at `limit`.
 *
 * Same filter as Spending Analysis (on-budget accounts, the category set, the
 * month range, splits inline), so a row seen here is a row seen there. Expenses
 * are negative, so the largest outflow is the smallest amount; refunds, being
 * positive, sort to the end. Date and id break ties so the order is stable.
 */
export function buildLargestTransactionsQuery(params: EvidenceQueryParams) {
  return {
    ActualQLquery: {
      table: "transactions",
      options: { splits: "inline" },
      filter: budgetTransactionsFilter(
        params.monthStart,
        params.monthEnd,
        params.categoryIds
      ),
      select: [
        "id",
        "date",
        "amount",
        "payee.name",
        "category.id",
        "category.name",
        "notes",
      ],
      orderBy: [
        { amount: params.side === "expense" ? "asc" : "desc" },
        { date: "desc" },
        { id: "asc" },
      ],
      limit: params.limit,
    },
  };
}

/** A transaction amount as a display magnitude: spending is positive, a refund negative. */
export function displayAmount(side: VarianceSide, amount: number): number {
  return side === "expense" ? -amount : amount;
}

export type TransactionSignal = "unbudgeted" | "refund" | "largest" | "deficit-month";

export const TRANSACTION_SIGNAL_LABELS: Record<TransactionSignal, string> = {
  unbudgeted: "Unbudgeted",
  refund: "Refund",
  largest: "Largest in view",
  "deficit-month": "Month in deficit",
};

/**
 * Deterministic badges for one row. Each is a fact that can be checked against
 * the budget, never a judgement about the purchase.
 *
 * - Unbudgeted: the category had no budget that month and money moved.
 * - Refund: it reduced an expense.
 * - Largest in view: first row of the current ordering.
 * - Month ended in deficit (Envelope): the category's balance was below zero
 *   at the end of the transaction's month.
 */
export function transactionSignals(
  model: VarianceModel,
  row: BudgetTransactionRow,
  rank: number
): TransactionSignal[] {
  const signals: TransactionSignal[] = [];
  const amount = displayAmount(model.side, row.amount);
  const cell = row.categoryId
    ? model.categories.find((c) => c.id === row.categoryId)?.cells.get(row.date.slice(0, 7))
    : undefined;

  if (cell?.present && cell.budget === 0 && amount > 0) signals.push("unbudgeted");
  if (model.side === "expense" && amount < 0) signals.push("refund");
  if (model.mode === "envelope" && cell?.present && cell.balance < 0) {
    signals.push("deficit-month");
  }
  if (rank === 0 && amount > 0) signals.push("largest");
  return signals;
}

/**
 * How much of a total the first `topN` rows account for, against the budget
 * payload's figure rather than the rows' own sum. `null` when there is
 * nothing to divide by.
 */
export function concentration(
  rows: readonly BudgetTransactionRow[],
  side: VarianceSide,
  denominator: number,
  topN: number
): number | null {
  if (denominator <= 0 || rows.length === 0) return null;
  const top = rows
    .slice(0, topN)
    .reduce((total, row) => total + Math.max(displayAmount(side, row.amount), 0), 0);
  return top / denominator;
}

/** Top 3 for one month, top 5 across several, as the brief set it. */
export function concentrationSize(monthCount: number): number {
  return monthCount > 1 ? 5 : 3;
}

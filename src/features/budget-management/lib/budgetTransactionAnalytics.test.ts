import { buildBudgetTransactionAnalytics } from "./budgetTransactionAnalytics";
import type { BudgetTransactionRow } from "./budgetTransactionsQuery";

const rows: BudgetTransactionRow[] = [
  {
    id: "tx-1",
    date: "2026-04-02",
    amount: -1200,
    payeeName: "Coffee Shop",
    categoryName: "Dining",
    notes: null,
  },
  {
    id: "tx-2",
    date: "2026-04-09",
    amount: -5000,
    payeeName: "Market",
    categoryName: "Groceries",
    notes: "weekly",
  },
  {
    id: "tx-3",
    date: "2026-04-10",
    amount: -3000,
    payeeName: "Market",
    categoryName: "Groceries",
    notes: null,
  },
  {
    id: "tx-4",
    date: "2026-04-22",
    amount: 1000,
    payeeName: null,
    categoryName: "Groceries",
    notes: "refund",
  },
];

describe("buildBudgetTransactionAnalytics", () => {
  it("computes spending KPIs from fetched transaction rows", () => {
    const analytics = buildBudgetTransactionAnalytics(rows);

    expect(analytics.totalSpent).toBe(9200);
    expect(analytics.transactionCount).toBe(4);
    expect(analytics.spendingTransactionCount).toBe(3);
    expect(analytics.averageTransaction).toBe(2300);
    expect(analytics.largestTransaction?.id).toBe("tx-2");
    expect(analytics.distinctPayeeCount).toBe(2);
    expect(analytics.noPayeeCount).toBe(1);
  });

  it("builds ranked payee and category breakdowns", () => {
    const analytics = buildBudgetTransactionAnalytics(rows);

    expect(analytics.spendByPayee.map((bucket) => bucket.label)).toEqual([
      "Market",
      "Coffee Shop",
      "No payee",
    ]);
    expect(analytics.spendByPayee[0]).toMatchObject({
      amount: 8000,
      count: 2,
    });
    expect(analytics.spendByCategory[0]).toMatchObject({
      label: "Groceries",
      amount: 8000,
      count: 3,
    });
  });

  it("builds time buckets, top transactions, outliers, and repeated payees", () => {
    const analytics = buildBudgetTransactionAnalytics(rows);

    expect(analytics.spendByWeek.map((bucket) => bucket.label)).toEqual([
      "Week 1",
      "Week 2",
      "Week 3",
      "Week 4",
      "Week 5",
    ]);
    expect(analytics.spendByWeek.map((bucket) => bucket.amount)).toEqual([
      1200,
      8000,
      0,
      0,
      0,
    ]);
    expect(analytics.spendByDay.map((bucket) => bucket.id)).toEqual([
      "2026-04-02",
      "2026-04-09",
      "2026-04-10",
      "2026-04-22",
    ]);
    expect(analytics.topTransactions.map((row) => row.id)).toEqual([
      "tx-2",
      "tx-3",
      "tx-1",
      "tx-4",
    ]);
    expect(analytics.outlierTransactions).toEqual([]);
    expect(analytics.repeatedPayees).toEqual([
      { payeeName: "Market", count: 2, amount: 8000 },
    ]);
  });
});

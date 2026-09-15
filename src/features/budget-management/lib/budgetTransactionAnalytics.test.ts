import {
  buildSpendBreakdown,
  buildTimeBreakdown,
  buildTransactionTotals,
} from "./budgetTransactionAnalytics";
import type { BudgetTransactionRow } from "./budgetTransactionsQuery";

const rows: BudgetTransactionRow[] = [
  {
    id: "tx-1",
    date: "2026-04-02",
    amount: -1200,
    payeeName: "Coffee Shop",
    categoryId: "dining", categoryName: "Dining",
    notes: null,
  },
  {
    id: "tx-2",
    date: "2026-04-09",
    amount: -5000,
    payeeName: "Market",
    categoryId: "groceries", categoryName: "Groceries",
    notes: "weekly",
  },
  {
    id: "tx-3",
    date: "2026-04-10",
    amount: -3000,
    payeeName: "Market",
    categoryId: "groceries", categoryName: "Groceries",
    notes: null,
  },
  {
    id: "tx-4",
    date: "2026-04-22",
    amount: 1000,
    payeeName: null,
    categoryId: "groceries", categoryName: "Groceries",
    notes: "refund",
  },
];

describe("buildTransactionTotals", () => {
  it("computes spending KPIs from fetched transaction rows", () => {
    const analytics = buildTransactionTotals(rows);

    expect(analytics.totalSpent).toBe(9200); // gross outflow, ignores the refund
    expect(analytics.netSpent).toBe(8200); // net = gross − 1,000 refund (signed)
    expect(analytics.transactionCount).toBe(4);
    expect(analytics.spendingTransactionCount).toBe(3);
    expect(analytics.averageTransaction).toBe(2300);
  });

  it("keeps net spent signed when refunds exceed spending (not clamped to 0)", () => {
    const refundHeavy: BudgetTransactionRow[] = [
      { id: "s", date: "2026-04-02", amount: -2000, payeeName: "Store", categoryId: "gear", categoryName: "Gear", notes: null },
      { id: "r", date: "2026-04-20", amount: 5000, payeeName: "Store", categoryId: "gear", categoryName: "Gear", notes: "big refund" },
    ];
    const analytics = buildTransactionTotals(refundHeavy);
    expect(analytics.netSpent).toBe(-3000); // net inflow of 3,000 — refund not lost
    expect(analytics.totalSpent).toBe(2000); // gross outflow unchanged
  });

});

describe("buildSpendBreakdown", () => {
  it("builds ranked payee and category breakdowns", () => {
    const analytics = buildSpendBreakdown(rows);

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

});

describe("buildTimeBreakdown", () => {
  it("builds time buckets", () => {
    const analytics = buildTimeBreakdown(rows);

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
  });
});

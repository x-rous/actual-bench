import {
  filterBudgetTransactions,
  formatTransactionDateLabel,
  prepareBudgetTransactionRows,
  sortBudgetTransactions,
  type BudgetTransactionSort,
} from "./budgetTransactionTable";
import type { BudgetTransactionRow } from "./budgetTransactionsQuery";

const rows: BudgetTransactionRow[] = [
  {
    id: "tx-1",
    date: "2026-04-15",
    amount: -1234,
    payeeName: "Corner Market",
    categoryName: "Groceries",
    notes: "weekly shop",
  },
  {
    id: "tx-2",
    date: "2026-04-10",
    amount: -4500,
    payeeName: "Metro",
    categoryName: "Transport",
    notes: null,
  },
  {
    id: "tx-3",
    date: "2026-04-18",
    amount: 2000,
    payeeName: null,
    categoryName: "Groceries",
    notes: "refund",
  },
];

describe("budget transaction table helpers", () => {
  it("formats transaction dates as compact weekday labels", () => {
    expect(formatTransactionDateLabel("2026-04-23")).toBe("Thu 23 Apr 2026");
  });

  it("filters by payee, category, notes, date, and displayed amount", () => {
    expect(filterBudgetTransactions(rows, "market").map((row) => row.id)).toEqual([
      "tx-1",
    ]);
    expect(filterBudgetTransactions(rows, "transport").map((row) => row.id)).toEqual([
      "tx-2",
    ]);
    expect(filterBudgetTransactions(rows, "refund").map((row) => row.id)).toEqual([
      "tx-3",
    ]);
    expect(filterBudgetTransactions(rows, "2026-04-10").map((row) => row.id)).toEqual([
      "tx-2",
    ]);
    expect(filterBudgetTransactions(rows, "-12.34").map((row) => row.id)).toEqual([
      "tx-1",
    ]);
    expect(filterBudgetTransactions(rows, "Wed 15 Apr").map((row) => row.id)).toEqual([
      "tx-1",
    ]);
  });

  it("sorts by amount in either direction without mutating the source rows", () => {
    const ascending: BudgetTransactionSort = {
      key: "amount",
      direction: "asc",
    };
    const descending: BudgetTransactionSort = {
      key: "amount",
      direction: "desc",
    };

    expect(sortBudgetTransactions(rows, ascending).map((row) => row.id)).toEqual([
      "tx-3",
      "tx-1",
      "tx-2",
    ]);
    expect(sortBudgetTransactions(rows, descending).map((row) => row.id)).toEqual([
      "tx-2",
      "tx-1",
      "tx-3",
    ]);
    expect(rows.map((row) => row.id)).toEqual(["tx-1", "tx-2", "tx-3"]);
  });

  it("sorts date and text columns with empty text values last", () => {
    expect(
      sortBudgetTransactions(rows, { key: "date", direction: "desc" }).map(
        (row) => row.id
      )
    ).toEqual(["tx-3", "tx-1", "tx-2"]);
    expect(
      sortBudgetTransactions(rows, { key: "payee", direction: "asc" }).map(
        (row) => row.id
      )
    ).toEqual(["tx-1", "tx-2", "tx-3"]);
  });

  it("filters and sorts the prepared rows", () => {
    expect(
      prepareBudgetTransactionRows(rows, "groceries", {
        key: "amount",
        direction: "desc",
      }).map((row) => row.id)
    ).toEqual(["tx-1", "tx-3"]);
  });
});

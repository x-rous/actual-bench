import {
  BUDGET_TRANSACTIONS_ROW_LIMIT,
  buildBudgetTransactionsQuery,
  buildBudgetTransactionsSummaryQuery,
} from "./budgetTransactionsQuery";

const params = { month: "2026-04", categoryIds: ["food", "rent"] };

// The filter is shared between the row and aggregate queries so both cover the
// exact same set — that identity is what lets the aggregate reconcile the rows.
const sharedFilter = {
  $and: [
    { date: { $transform: "$month", $eq: "2026-04" } },
    { category: { $oneof: ["food", "rent"] } },
    { "account.offbudget": false },
  ],
};

describe("buildBudgetTransactionsQuery", () => {
  it("caps rows at the shared row limit by default and orders newest first", () => {
    const query = buildBudgetTransactionsQuery(params).ActualQLquery;
    expect(query.limit).toBe(BUDGET_TRANSACTIONS_ROW_LIMIT);
    expect(query.orderBy).toEqual([{ date: "desc" }]);
    expect(query.filter).toEqual(sharedFilter);
  });

  it("honours an explicit limit override", () => {
    const query = buildBudgetTransactionsQuery({ ...params, limit: 10 }).ActualQLquery;
    expect(query.limit).toBe(10);
  });
});

describe("buildBudgetTransactionsSummaryQuery", () => {
  it("aggregates the signed total and count over the same filter, without a limit", () => {
    const query = buildBudgetTransactionsSummaryQuery(params).ActualQLquery;
    expect(query.filter).toEqual(sharedFilter);
    expect(query.select).toEqual([
      { total: { $sum: "$amount" } },
      { count: { $count: "$id" } },
    ]);
    expect(query).not.toHaveProperty("limit");
    expect(query).not.toHaveProperty("orderBy");
  });
});

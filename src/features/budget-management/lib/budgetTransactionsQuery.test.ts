import {
  BUDGET_TRANSACTIONS_ROW_LIMIT,
  buildBudgetTransactionsQuery,
  buildBudgetTransactionsSummaryQuery,
} from "./budgetTransactionsQuery";

const params = { monthStart: "2026-04", monthEnd: "2026-04", categoryIds: ["food", "rent"] };

// The filter is shared between the row and aggregate queries so both cover the
// exact same set — that identity is what lets the aggregate reconcile the rows.
const sharedFilter = {
  $and: [
    { date: { $gte: "2026-04-01" } },
    { date: { $lte: "2026-04-30" } },
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

/*
 * The figures these back are sums over a period, so the filter is a date range
 * rather than a month equality. One month is a range whose ends match, which is
 * why there is no second code path: the single-month case above runs through
 * exactly the same filter as the multi-month ones here.
 */
describe("filtering a range of months", () => {
  const range = (monthStart: string, monthEnd: string) =>
    buildBudgetTransactionsQuery({ monthStart, monthEnd, categoryIds: ["food"] })
      .ActualQLquery.filter;

  it("spans from the first day of the first month to the last of the last", () => {
    expect(range("2026-01", "2026-08")).toEqual({
      $and: [
        { date: { $gte: "2026-01-01" } },
        { date: { $lte: "2026-08-31" } },
        { category: { $oneof: ["food"] } },
        { "account.offbudget": false },
      ],
    });
  });

  it("crosses a year boundary", () => {
    const filter = range("2025-11", "2026-02") as { $and: Record<string, unknown>[] };
    expect(filter.$and[0]).toEqual({ date: { $gte: "2025-11-01" } });
    expect(filter.$and[1]).toEqual({ date: { $lte: "2026-02-28" } });
  });

  it("ends on the 29th when the range closes in a leap February", () => {
    // A hard-coded 28 here would silently drop a day of transactions, and the
    // dialog's total would stop matching the figure that was clicked.
    const filter = range("2028-01", "2028-02") as { $and: Record<string, unknown>[] };
    expect(filter.$and[1]).toEqual({ date: { $lte: "2028-02-29" } });
  });

  it("gives the aggregate the identical filter, so it still reconciles the rows", () => {
    const rows = buildBudgetTransactionsQuery({
      monthStart: "2026-01",
      monthEnd: "2026-08",
      categoryIds: ["food"],
    }).ActualQLquery.filter;
    const summary = buildBudgetTransactionsSummaryQuery({
      monthStart: "2026-01",
      monthEnd: "2026-08",
      categoryIds: ["food"],
    }).ActualQLquery.filter;
    expect(summary).toEqual(rows);
  });
});

import type { BudgetTransactionRow } from "../budgetTransactionsQuery";
import {
  buildLargestTransactionsQuery,
  concentration,
  concentrationSize,
  displayAmount,
  hasMoreEvidence,
  nextEvidenceLimit,
  transactionSignals,
} from "./varianceEvidence";
import { buildVarianceModel } from "./varianceViewModel";
import { statesFor } from "./testing";

const row = (over: Partial<BudgetTransactionRow>): BudgetTransactionRow => ({
  id: "t1",
  date: "2026-08-17",
  amount: -150_00,
  payeeName: "Fly Dubai",
  categoryId: "flights",
  categoryName: "Flights",
  notes: null,
  ...over,
});

describe("buildLargestTransactionsQuery", () => {
  const params = {
    monthStart: "2026-08",
    monthEnd: "2026-08",
    categoryIds: ["flights", "hotels"],
    side: "expense" as const,
    limit: 8,
  };

  it("filters like Spending Analysis: dates, categories, on-budget only", () => {
    expect(buildLargestTransactionsQuery(params).ActualQLquery.filter).toEqual({
      $and: [
        { date: { $gte: "2026-08-01" } },
        { date: { $lte: "2026-08-31" } },
        { category: { $oneof: ["flights", "hotels"] } },
        { "account.offbudget": false },
      ],
    });
  });

  it("asks for the largest outflow first, capped, with a stable tie-break", () => {
    const query = buildLargestTransactionsQuery(params).ActualQLquery;
    expect(query.orderBy).toEqual([{ amount: "asc" }, { date: "desc" }, { id: "asc" }]);
    expect(query.limit).toBe(8);
    expect(query.options).toEqual({ splits: "inline" });
  });

  it("asks for the largest inflow first for income", () => {
    const query = buildLargestTransactionsQuery({ ...params, side: "income" }).ActualQLquery;
    expect(query.orderBy[0]).toEqual({ amount: "desc" });
  });

  it("spans a multi-month range", () => {
    const query = buildLargestTransactionsQuery({ ...params, monthStart: "2026-01", monthEnd: "2026-08" });
    expect(query.ActualQLquery.filter.$and.slice(0, 2)).toEqual([
      { date: { $gte: "2026-01-01" } },
      { date: { $lte: "2026-08-31" } },
    ]);
  });
});

describe("paging", () => {
  it("steps 8, 25, 50 and stops", () => {
    expect(nextEvidenceLimit(8)).toBe(25);
    expect(nextEvidenceLimit(25)).toBe(50);
    expect(nextEvidenceLimit(50)).toBe(50);
    expect(hasMoreEvidence(25)).toBe(true);
    expect(hasMoreEvidence(50)).toBe(false);
  });
});

describe("amounts and concentration", () => {
  it("shows spending as positive and a refund as negative", () => {
    expect(displayAmount("expense", -4500)).toBe(4500);
    expect(displayAmount("expense", 700)).toBe(-700);
    expect(displayAmount("income", 3000)).toBe(3000);
  });

  it("divides the top rows by the budget payload's figure", () => {
    const rows = [row({ amount: -500 }), row({ id: "2", amount: -300 }), row({ id: "3", amount: -100 }), row({ id: "4", amount: -50 })];
    expect(concentration(rows, "expense", 1000, 3)).toBe(0.9);
    expect(concentration(rows, "expense", 0, 3)).toBeNull();
    expect(concentration([], "expense", 1000, 3)).toBeNull();
  });

  it("does not count a refund towards concentration", () => {
    expect(concentration([row({ amount: 400 })], "expense", 1000, 3)).toBe(0);
  });

  it("uses the top 3 for a month and the top 5 for a range", () => {
    expect(concentrationSize(1)).toBe(3);
    expect(concentrationSize(8)).toBe(5);
  });
});

describe("transaction signals", () => {
  const model = (mode: "tracking" | "envelope") =>
    buildVarianceModel({
      mode,
      side: "expense",
      months: ["2026-08"],
      statesByMonth: statesFor({
        "2026-08": [
          { id: "flights", budgeted: mode === "tracking" ? -5000 : 5000, actuals: -6000, balance: -1000 },
          { id: "surprise", group: "g2", budgeted: 0, actuals: -400, balance: -400 },
        ],
      }),
    });

  it("marks spending in a category with no budget as unbudgeted", () => {
    expect(transactionSignals(model("tracking"), row({ categoryId: "surprise" }), 3)).toEqual(["unbudgeted"]);
  });

  it("marks a positive expense row as a refund", () => {
    expect(transactionSignals(model("tracking"), row({ amount: 200_00 }), 3)).toEqual(["refund"]);
  });

  it("marks the first row as the largest in view", () => {
    expect(transactionSignals(model("tracking"), row({}), 0)).toEqual(["largest"]);
    expect(transactionSignals(model("tracking"), row({}), 1)).toEqual([]);
  });

  it("marks a row from a month the Envelope category ended in deficit", () => {
    expect(transactionSignals(model("envelope"), row({}), 2)).toEqual(["deficit-month"]);
    expect(transactionSignals(model("tracking"), row({}), 2)).toEqual([]);
  });

  it("gives an uncategorised row no budget-based signal", () => {
    expect(transactionSignals(model("tracking"), row({ categoryId: null }), 2)).toEqual([]);
  });
});

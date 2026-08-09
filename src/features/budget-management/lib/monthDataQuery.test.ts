import { normalizeBudgetMonthData } from "./monthDataQuery";
import type { TransportBudgetMonth } from "@/lib/actual/transport";

function month(overrides: Partial<TransportBudgetMonth> = {}): TransportBudgetMonth {
  return {
    month: "2026-04",
    incomeAvailable: 0,
    lastMonthOverspent: 0,
    forNextMonth: 0,
    totalBudgeted: -100_000,
    toBudget: 0,
    fromLastMonth: 0,
    totalIncome: 500_000,
    totalSpent: -80_000,
    totalBalance: 20_000,
    categoryGroups: [
      {
        id: "income",
        name: "Income",
        is_income: true,
        hidden: false,
        received: 500_000,
        budgeted: 500_000,
        balance: 0,
        categories: [
          {
            id: "salary",
            name: "Salary",
            is_income: true,
            hidden: false,
            group_id: "income",
            received: 500_000,
            budgeted: 500_000,
            balance: 0,
          },
        ],
      },
      {
        id: "expenses",
        name: "Expenses",
        is_income: false,
        hidden: false,
        budgeted: -100_000,
        spent: -80_000,
        balance: 20_000,
        categories: [
          {
            id: "rent",
            name: "Rent",
            is_income: false,
            hidden: false,
            group_id: "expenses",
            budgeted: -100_000,
            spent: -80_000,
            balance: 20_000,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("normalizeBudgetMonthData", () => {
  it("records no income fallback when the payload carries income budgets (26.8+)", () => {
    const state = normalizeBudgetMonthData(month());
    expect(state.incomeBudgetFallbackIds).toEqual([]);
    expect(state.categoriesById.salary!.budgeted).toBe(500_000);
  });

  it("flags income categories whose budgeted is absent for the fallback", () => {
    const raw = month();
    // Older-server shape: income budget omitted from the month payload.
    raw.categoryGroups[0]!.categories[0]!.budgeted = null;
    const state = normalizeBudgetMonthData(raw);
    expect(state.incomeBudgetFallbackIds).toEqual(["salary"]);
    // Placeholder 0 until the reflect_budgets overlay fills it.
    expect(state.categoriesById.salary!.budgeted).toBe(0);
  });

  it("coerces non-finite summary fields to 0 instead of propagating NaN (BM-08)", () => {
    const raw = month();
    // Simulate a malformed payload where a numeric field is missing.
    (raw as { totalIncome: unknown }).totalIncome = undefined;
    const state = normalizeBudgetMonthData(raw);
    expect(state.summary.totalIncome).toBe(0);
    expect(Number.isFinite(state.summary.totalIncome)).toBe(true);
  });
});

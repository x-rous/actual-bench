import { hasPartialFailure } from "./useBudgetOverview";
import type { BudgetOverviewSnapshot } from "../types";

const complete: BudgetOverviewSnapshot = {
  stats: { transactions: 1, accounts: 2, payees: 3, categories: 4, rules: 5, schedules: 6 },
  details: { closedAccounts: 0, transferPayees: 2, hiddenCategories: 1, completedSchedules: 0 },
  budgetMode: "Tracking",
  budgetingSince: "Jan 2019",
};

it("treats a read as incomplete when any count, breakdown or context value is missing", () => {
  expect(hasPartialFailure(complete)).toBe(false);
  expect(hasPartialFailure({ ...complete, details: { ...complete.details, closedAccounts: null } })).toBe(true);
  expect(hasPartialFailure({ ...complete, stats: { ...complete.stats, rules: null } })).toBe(true);
  expect(hasPartialFailure({ ...complete, budgetMode: null })).toBe(true);
  expect(hasPartialFailure(null)).toBe(false);
});

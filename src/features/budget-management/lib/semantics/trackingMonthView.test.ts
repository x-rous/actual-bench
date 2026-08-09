import { parseBudgetMonth } from "./parseBudgetMonth";
import { deriveTrackingMonth } from "./trackingBudgetSemantics";
import { buildTrackingMonthView } from "./trackingMonthView";
import { trackingInputsFromState } from "./fromLoadedState";
import { computeTrackingMonth } from "./trackingBudgetSemantics";
import trackingMonth from "./__fixtures__/tracking-month.json";
import type { LoadedMonthState } from "../../types";

const sem = (() => {
  const r = parseBudgetMonth(trackingMonth);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return deriveTrackingMonth(r.month);
})();

describe("buildTrackingMonthView — headline by time phase", () => {
  it("past → Saved/Overspent from actual savings", () => {
    const v = buildTrackingMonthView(sem, "past");
    expect(v.headline).toEqual({ label: "Saved", value: 1500, tone: "positive" });
    expect(v.supporting).toBeNull();
    expect(v.provisional).toBe(false);
  });

  it("past overspend flips the label and tone", () => {
    const overspent = computeTrackingMonth({
      budgetedIncome: 1000,
      actualIncome: 800,
      budgetedExpenseAllocation: 900,
      signedExpenseActivity: -1200,
      balance: -300,
    });
    const v = buildTrackingMonthView(overspent, "past");
    expect(v.headline).toEqual({ label: "Overspent", value: 400, tone: "negative" });
  });

  it("current → Projected savings + Actual savings to date, provisional", () => {
    const v = buildTrackingMonthView(sem, "current");
    expect(v.headline).toEqual({ label: "Projected savings", value: 500, tone: "positive" });
    expect(v.supporting).toEqual({ label: "Actual savings to date", value: 1500, tone: "positive" });
    expect(v.provisional).toBe(true);
  });

  it("future → Projected savings, no actuals", () => {
    const v = buildTrackingMonthView(sem, "future");
    expect(v.headline.label).toBe("Projected savings");
    expect(v.income.actual).toBeNull();
    expect(v.income.variance).toBeNull();
    expect(v.expenses.actual).toBeNull();
  });
});

describe("buildTrackingMonthView — lines keep Variance and Balance independent", () => {
  const v = buildTrackingMonthView(sem, "past");

  it("income line = budget / actual / variance", () => {
    expect(v.income).toEqual({ budgeted: 5000, actual: 5200, variance: 200 });
  });

  it("expense line uses signed activity and true variance", () => {
    expect(v.expenses).toEqual({ budgeted: 4500, actual: -3700, variance: 800 });
  });

  it("balance is its own row and diverges from variance under carryover", () => {
    expect(v.balance.value).toBe(1300);
    expect(v.balance.distinctFromVariance).toBe(true); // 1300 ≠ 800
  });
});

describe("trackingInputsFromState — recovers positive allocation from coerced state", () => {
  it("abs-recovers Tracking totalBudgeted and sums visible income group budgets", () => {
    // Mirror the live LoadedMonthState: summary.totalBudgeted coerced negative.
    const state = {
      summary: {
        totalIncome: 5200,
        totalSpent: -3700,
        totalBudgeted: -4500, // coerced negative for Tracking
        totalBalance: 1300,
      },
      groupOrder: ["g-income", "g-hidden-income"],
      groupsById: {
        "g-income": { id: "g-income", isIncome: true, hidden: false, budgeted: 5000, categoryIds: ["c-salary"] },
        "g-hidden-income": { id: "g-hidden-income", isIncome: true, hidden: true, budgeted: 9999, categoryIds: ["c-secret"] },
      },
      categoriesById: {
        "c-salary": { id: "c-salary", isIncome: true, hidden: false, budgeted: 5000 },
        "c-secret": { id: "c-secret", isIncome: true, hidden: false, budgeted: 9999 },
      },
    } as unknown as LoadedMonthState;

    const inputs = trackingInputsFromState(state);
    expect(inputs.budgetedExpenseAllocation).toBe(4500); // recovered positive
    expect(inputs.signedExpenseActivity).toBe(-3700);
    expect(inputs.budgetedIncome).toBe(5000); // hidden income group excluded
    const view = buildTrackingMonthView(computeTrackingMonth(inputs), "past");
    expect(view.expenses.variance).toBe(800);
    expect(view.headline).toEqual({ label: "Saved", value: 1500, tone: "positive" });
  });
});

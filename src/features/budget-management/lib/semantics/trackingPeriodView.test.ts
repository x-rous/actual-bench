import {
  buildTrackingPeriodView,
  type TrackingPeriodMonth,
} from "./trackingPeriodView";
import type { MonthTimePhase } from "./trackingMonthView";

function m(
  month: string,
  phase: MonthTimePhase,
  budgetedIncome: number,
  actualIncome: number,
  budgetedExpenseAllocation: number,
  signedExpenseActivity: number,
  balance: number
): TrackingPeriodMonth {
  return {
    month,
    phase,
    inputs: {
      budgetedIncome,
      actualIncome,
      budgetedExpenseAllocation,
      signedExpenseActivity,
      balance,
    },
  };
}

describe("buildTrackingPeriodView", () => {
  const months = [
    m("2026-05", "past", 5000, 5200, 4000, -3800, 700),
    m("2026-06", "past", 5000, 4800, 4000, -4200, 300),
    m("2026-07", "current", 5000, 2600, 4000, -1900, 900),
    m("2026-08", "future", 5000, 0, 4000, 0, 900),
  ];
  const v = buildTrackingPeriodView(months)!;

  it("aggregates closed months into income/expense variance and refund-safe savings", () => {
    expect(v.closed).toMatchObject({
      monthCount: 2,
      budgetedIncome: 10000,
      actualIncome: 10000, // 5200 + 4800
      incomeVariance: 0,
      budgetedExpenseAllocation: 8000,
      signedExpenseActivity: -8000, // −3800 −4200
      expenseVariance: 0, // 8000 + (−8000)
      actualSavings: 2000, // 10000 + (−8000)
    });
  });

  it("uses an Ending Balance snapshot, never a sum of monthly balances", () => {
    expect(v.closed!.endingBalance).toBe(300); // last closed month, not 700+300
  });

  it("headline leads with realized Saved/Overspent over closed months", () => {
    expect(v.headline).toEqual({ label: "Saved", value: 2000, tone: "positive" });
  });

  it("splits current month into projected + actual-to-date", () => {
    expect(v.current).toEqual({ projectedSavings: 1000, actualSavingsToDate: 700 });
  });

  it("future months are plan-only (Projected Savings, no actuals)", () => {
    expect(v.future).toEqual({
      monthCount: 1,
      budgetedIncome: 5000,
      budgetedExpenseAllocation: 4000,
      projectedSavings: 1000,
    });
  });

  it("falls back to a projection when no months are closed yet", () => {
    const early = buildTrackingPeriodView([
      m("2026-07", "current", 5000, 1000, 4000, -800, 100),
      m("2026-08", "future", 5000, 0, 4000, 0, 100),
    ])!;
    expect(early.closed).toBeNull();
    expect(early.headline).toEqual({ label: "Projected savings", value: 1000, tone: "positive" });
  });
});

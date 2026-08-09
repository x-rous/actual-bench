import { computeEnvelopeFunding } from "./envelopeBudgetSemantics";
import {
  buildEnvelopePeriodView,
  type EnvelopePeriodMonth,
} from "./envelopePeriodView";
import type { MonthTimePhase } from "./trackingMonthView";

function month(
  m: string,
  phase: MonthTimePhase,
  budgetedAllocation: number,
  signedSpent: number,
  toBudget: number,
  balance: number
): EnvelopePeriodMonth {
  return {
    month: m,
    phase,
    funding: computeEnvelopeFunding({
      incomeReceived: 0,
      fromLastMonth: 0,
      availableFunds: 0,
      lastMonthOverspent: 0,
      budgetedAllocation,
      forNextMonthHold: 0,
      toBudget,
      balance,
      signedSpent,
    }),
  };
}

describe("buildEnvelopePeriodView", () => {
  const months = [
    month("2026-05", "past", -1000, -900, 200, 300),
    month("2026-06", "past", -1000, -1100, 150, 250),
    month("2026-07", "current", -1000, -400, 500, 900),
    month("2026-08", "future", -1000, 0, 700, 900),
  ];

  it("takes the headline + bridge from the current focus month (never summed)", () => {
    const v = buildEnvelopePeriodView(months)!;
    expect(v.focusMonth).toBe("2026-07");
    expect(v.headline).toEqual({ label: "To Budget", value: 500, tone: "positive" });
    // NOT the sum of To Budget (200+150+500+700 = 1550).
    expect(v.headline.value).not.toBe(1550);
  });

  it("sums Budgeted over all months and signed Spent over months with actuals", () => {
    const v = buildEnvelopePeriodView(months)!;
    expect(v.periodBudgeted).toBe(4000); // 4 × 1000 magnitude
    expect(v.periodSpent).toBe(-2400); // −900 −1100 −400 (future excluded)
    expect(v.coverage).toEqual({ actualMonths: 3, totalMonths: 4 });
  });

  it("reports Balance as the focus-month snapshot, not a sum", () => {
    const v = buildEnvelopePeriodView(months)!;
    expect(v.focusBalance).toBe(900); // focus month only, not 300+250+900+900
  });

  it("falls back to the latest month with actuals when there is no current month", () => {
    const noCurrent = [
      month("2026-05", "past", -1000, -900, 200, 300),
      month("2026-06", "past", -1000, -1100, 150, 250),
      month("2026-07", "future", -1000, 0, 700, 900),
    ];
    const v = buildEnvelopePeriodView(noCurrent)!;
    expect(v.focusMonth).toBe("2026-06");
    expect(v.headline.value).toBe(150);
  });

  it("returns null for an empty period", () => {
    expect(buildEnvelopePeriodView([])).toBeNull();
  });
});

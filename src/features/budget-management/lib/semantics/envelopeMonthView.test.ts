import { parseBudgetMonth } from "./parseBudgetMonth";
import {
  computeEnvelopeFunding,
  deriveEnvelopeFunding,
} from "./envelopeBudgetSemantics";
import { buildEnvelopeMonthView } from "./envelopeMonthView";
import envelopeMonth from "./__fixtures__/envelope-month.json";

const funding = (() => {
  const r = parseBudgetMonth(envelopeMonth);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return deriveEnvelopeFunding(r.month);
})();

describe("buildEnvelopeMonthView", () => {
  it("headline is To Budget when funding is positive", () => {
    const v = buildEnvelopeMonthView(funding, "past");
    expect(v.headline).toEqual({ label: "To Budget", value: 3750, tone: "positive" });
  });

  it("headline is Overbudgeted when funding is negative", () => {
    const over = computeEnvelopeFunding({
      incomeReceived: 1000,
      fromLastMonth: 0,
      availableFunds: 1000,
      lastMonthOverspent: -100,
      budgetedAllocation: -1200,
      forNextMonthHold: 0,
      toBudget: -300,
      balance: 500,
      signedSpent: -900,
    });
    const v = buildEnvelopeMonthView(over, "current");
    expect(v.headline).toEqual({ label: "Overbudgeted", value: 300, tone: "negative" });
    expect(v.reconciles).toBe(true); // 1000 + (−100) + (−1200) − 0 = −300
  });

  it("headline is Fully budgeted at exactly zero", () => {
    const v = buildEnvelopeMonthView({ ...funding, toBudget: 0, toBudgetComputed: 0 }, "past");
    expect(v.headline.label).toBe("Fully budgeted");
  });

  it("exposes the operator bridge with positive magnitudes, reconciling to To Budget", () => {
    const v = buildEnvelopeMonthView(funding, "past");
    expect(v.bridge).toEqual([
      { label: "Available funds", operator: "+", display: 7000 },
      { label: "Overspent last month", operator: "-", display: 50 },
      { label: "Budgeted", operator: "-", display: 3200 },
      { label: "Hold for next month", operator: "-", display: 0 },
    ]);
    expect(v.reconciles).toBe(true);
    expect(v.toBudget).toBe(3750);
  });

  it("explains available funds and keeps signed spent (refund-safe)", () => {
    const v = buildEnvelopeMonthView(funding, "past");
    expect(v.availableFundsBreakdown).toEqual({ incomeReceived: 6000, fromLastMonth: 1000 });
    expect(v.incomeReceived).toBe(6000);
    expect(v.signedSpent).toBe(-3130);
    expect(v.balance).toBe(3870); // money still assigned, includes hidden
  });

  it("omits actual activity on future months", () => {
    expect(buildEnvelopeMonthView(funding, "future").showActivity).toBe(false);
    expect(buildEnvelopeMonthView(funding, "past").showActivity).toBe(true);
    expect(buildEnvelopeMonthView(funding, "current").showActivity).toBe(true);
  });
});

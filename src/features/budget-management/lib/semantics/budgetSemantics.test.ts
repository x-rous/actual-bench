import { parseBudgetMonth, type ParsedBudgetMonth } from "./parseBudgetMonth";
import { deriveTrackingMonth } from "./trackingBudgetSemantics";
import {
  deriveEnvelopeFunding,
  envelopeBridgeRows,
} from "./envelopeBudgetSemantics";
import trackingMonth from "./__fixtures__/tracking-month.json";
import envelopeMonth from "./__fixtures__/envelope-month.json";

function parsed(input: unknown): ParsedBudgetMonth {
  const r = parseBudgetMonth(input);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.month;
}

describe("deriveTrackingMonth", () => {
  const t = deriveTrackingMonth(parsed(trackingMonth));

  it("derives income budget from visible income groups (excl. hidden)", () => {
    expect(t.budgetedIncome).toBe(5000);
    expect(t.actualIncome).toBe(5200);
    expect(t.incomeVariance).toBe(200); // received − budgeted
  });

  it("derives expense variance as allocation + signed activity (excl. carryover)", () => {
    expect(t.budgetedExpenseAllocation).toBe(4500);
    expect(t.signedExpenseActivity).toBe(-3700);
    expect(t.expenseVariance).toBe(800); // 4500 + (−3700) = under budget by 800
  });

  it("derives refund-safe savings", () => {
    expect(t.actualSavings).toBe(1500); // 5200 + (−3700)
    expect(t.projectedSavings).toBe(500); // 5000 − 4500
  });

  it("keeps Balance independent of Variance (BM-06)", () => {
    // totalBalance includes the carryover category's prior leftover; expense
    // variance does not. They must not be equal here.
    expect(t.balance).toBe(1300);
    expect(t.balance).not.toBe(t.expenseVariance);
  });
});

describe("deriveEnvelopeFunding", () => {
  const e = deriveEnvelopeFunding(parsed(envelopeMonth));

  it("reconciles To Budget from raw signs (never Income − Budgeted)", () => {
    // 7000 + (−50) + (−3200) − 0 = 3750
    expect(e.toBudgetComputed).toBe(3750);
    expect(e.toBudget).toBe(3750);
    expect(e.toBudgetComputed).toBe(e.toBudget);
  });

  it("available funds = received + from last month", () => {
    expect(e.incomeReceived).toBe(6000);
    expect(e.fromLastMonth).toBe(1000);
    expect(e.availableFunds).toBe(7000);
  });

  it("exposes Balance (money still assigned), not a variance", () => {
    expect(e.balance).toBe(3870); // includes hidden group balance
  });

  it("bridge rows use positive display magnitudes with directional operators", () => {
    expect(envelopeBridgeRows(e)).toEqual([
      { label: "Available funds", operator: "+", display: 7000 },
      { label: "Overspent last month", operator: "-", display: 50 },
      { label: "Budgeted", operator: "-", display: 3200 },
      { label: "Hold for next month", operator: "-", display: 0 },
    ]);
  });
});

describe("hidden aggregation (reconciles to authoritative summary)", () => {
  it("Tracking summary excludes hidden — derived totals do too", () => {
    const t = deriveTrackingMonth(parsed(trackingMonth));
    // Visible expense budgeted = 3000+1000+500 = 4500 (hidden 400 excluded).
    expect(t.budgetedExpenseAllocation).toBe(4500);
  });

  it("Envelope summary includes hidden — derived funding does too", () => {
    const e = deriveEnvelopeFunding(parsed(envelopeMonth));
    // totalBudgeted −3200 includes the hidden group's −200 allocation.
    expect(e.budgetedAllocation).toBe(-3200);
  });
});

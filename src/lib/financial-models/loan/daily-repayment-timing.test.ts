import type { LoanModelSnapshot } from "./model";
import { simulateDaily, simulateDailyV8 } from "./daily-engine";
import { allocateObservedRepayments } from "./statementAllocation";

// 36,500 at 10% Act/365: exactly 10.00 of interest a day on the opening balance.
const MODEL = {
  debtId: "d", revision: 1, currency: { code: "AED", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
  terms: { openingDate: "2024-01-01", openingPrincipalMinor: 3_650_000, maturityDate: null, contractualTermMonths: 12, amortizationTermMonths: 12, contractualPaymentMinor: 100_000, creditLimitMinor: null, firstPaymentDate: "2024-02-01", firstInterestChargeDate: null },
  profile: {
    amortization: "level-payment", rateQuote: "nominal-simple-periodic", dayCount: "actual-365-fixed", accrual: "daily-simple", chargeFrequency: "at-repayment", chargeDay: null,
    capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "contractual-fixed", recast: "never", rateEffectiveTiming: "on-accrual-effective-date",
    repaymentEffectiveTiming: "transaction-date",
    rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" },
    eventOrder: { timing: "start-of-day" }, finalPayment: "true-up-to-zero", shortMonth: "clamp-to-last-calendar-day", negativeAmortizationAllowed: false,
    interestOnlyRepayment: "charged-interest-outstanding", presetId: null,
  },
  rates: [{ accrualEffectiveFrom: "2024-01-01", annualRateDecimal: "0.10" }],
  phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
} as LoanModelSnapshot;

const nextDay = { ...MODEL, profile: { ...MODEL.profile, repaymentEffectiveTiming: "next-calendar-day" as const } };
const anchor = { date: "2024-01-01", principalMinor: 3_650_000, accruedInterestMinor: 0, source: "opening" };
const extra = { kind: "extra-repayment" as const, date: "2024-01-16", amountMinor: 365_000, ref: { source: "actual" as const, id: "x" } };

function repayments(model: LoanModelSnapshot, simulate = simulateDaily) {
  const result = simulate({ model, anchor, events: [extra], to: "2024-03-05" });
  if (!result.ok) throw new Error(result.blocked[0].message);
  return result.events.filter((e) => e.type === "repayment").map((e) => e.interestMinor);
}

describe('daily "A repayment counts: From the next day" (loan-daily@9)', () => {
  it("leaves loans counting repayments on the repayment date unchanged", () => {
    expect(repayments(MODEL)).toEqual(repayments(MODEL, simulateDailyV8));
  });

  it("charges one more day of interest on the old balance for each repayment and extra repayment", () => {
    const [sameDay1, sameDay2] = repayments(MODEL);
    const [next1, next2] = repayments(nextDay);
    // First repayment: the extra counts a day later (one more day on 3,650: 1.00) and the repayment day itself now
    // accrues on the balance after the extra (32,850: 9.00).
    expect(next1 - sameDay1).toBe(1_000);
    // Second repayment: the day shift of the first repayment's principal, nothing else.
    expect(next2 - sameDay2).toBeGreaterThan(0);
  });

  it("agrees with the observed-repayment allocator, which already counts from the next day", () => {
    const allocated = (model: LoanModelSnapshot) => {
      const result = allocateObservedRepayments({ model, opening: { date: "2024-01-01", principalMinor: 3_650_000 }, repayments: [
        { dueDate: "2024-01-16", paidDate: "2024-01-16", amountMinor: 365_000, extra: true },
        { dueDate: "2024-02-01", paidDate: "2024-02-01", amountMinor: 100_000 },
      ] });
      if (!result.ok) throw new Error(result.message);
      return result.rows[1].interestMinor;
    };
    expect(allocated(nextDay) - allocated(MODEL)).toBe(repayments(nextDay)[0] - repayments(MODEL)[0]);
  });

  it("is ignored by the historical loan-daily@8", () => {
    expect(repayments(nextDay, simulateDailyV8)).toEqual(repayments(MODEL, simulateDailyV8));
  });
});

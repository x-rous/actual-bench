import type { LoanModelSnapshot } from "./model";
import { allocateObservedRepayments, compareLenderStatement } from "./statementAllocation";

// AED 36,500 at 10% Act/365: exactly 10.00 a day, so expectations are readable.
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

const opening = { date: "2024-01-01", principalMinor: 3_650_000 };

describe("observed repayment allocation", () => {
  it("as calculated: interest up to the actual date, the fee kept as its own line", () => {
    const result = allocateObservedRepayments({ model: MODEL, opening, repayments: [{ dueDate: "2024-02-01", paidDate: "2024-01-21", amountMinor: 100_000, feesMinor: 500 }] });
    if (!result.ok) throw new Error(result.message);
    expect(result.rows[0]).toMatchObject({ interestMinor: 20_000, feesMinor: 500, principalMinor: 79_500, balanceAfterMinor: 3_570_500 });
  });

  it("accrued to the due date: a late payment carries interest to its actual date", () => {
    const result = allocateObservedRepayments({ model: MODEL, opening, allocation: "accrued-to-due-date", repayments: [{ dueDate: "2024-02-01", paidDate: "2024-02-05", amountMinor: 100_000 }] });
    if (!result.ok) throw new Error(result.message);
    expect(result.rows[0].interestMinor).toBe(35_000);
  });

  it("gives interest accrued before the opening to the first repayment", () => {
    const result = allocateObservedRepayments({ model: MODEL, opening: { ...opening, accruedInterestMinor: 1_234 }, repayments: [{ dueDate: "2024-02-01", paidDate: "2024-01-11", amountMinor: 100_000 }] });
    if (!result.ok) throw new Error(result.message);
    expect(result.rows[0].interestMinor).toBe(11_234);
  });

  it("refuses bad input without throwing", () => {
    const bad = (repayments: Parameters<typeof allocateObservedRepayments>[0]["repayments"]) => allocateObservedRepayments({ model: MODEL, opening, repayments });
    expect(bad([{ dueDate: "2024-02-01", paidDate: "2024-02-01", amountMinor: 0 }]).ok).toBe(false);
    expect(bad([{ dueDate: "2024-02-01", paidDate: "2024-02-01", amountMinor: 100, feesMinor: 200 }]).ok).toBe(false);
    expect(bad([{ dueDate: "2024-02-01", paidDate: "2023-12-01", amountMinor: 100_000 }]).ok).toBe(false);
    expect(bad([{ dueDate: "2024-02-01", paidDate: "2024-02-01", amountMinor: 1_000 }])).toMatchObject({ ok: false, message: expect.stringMatching(/does not cover the interest/) });
    expect(allocateObservedRepayments({ model: { ...MODEL, profile: { ...MODEL.profile, accrual: "per-period" } }, opening, repayments: [] }).ok).toBe(false);
  });

  it("flags a lender difference beyond the tolerance instead of absorbing it", () => {
    const result = allocateObservedRepayments({ model: MODEL, opening, repayments: [{ dueDate: "2024-02-01", paidDate: "2024-01-21", amountMinor: 100_000 }] });
    if (!result.ok) throw new Error(result.message);
    expect(compareLenderStatement(result.rows, [{ paidDate: "2024-01-21", principalMinor: 70_000, interestMinor: 30_000 }], 1)).toEqual([{ paidDate: "2024-01-21", status: "unexplained-difference", interestDifferenceMinor: 10_000 }]);
    expect(compareLenderStatement(result.rows, [{ paidDate: "2024-01-21", principalMinor: 80_001, interestMinor: 19_999 }], 1)[0].status).toBe("matches");
  });
});

describe("applied interest (T291)", () => {
  it("uses the applied interest and builds the next repayment on the principal actually applied", () => {
    const calculated = allocateObservedRepayments({ model: MODEL, opening, repayments: [{ dueDate: "2024-02-01", paidDate: "2024-01-21", amountMinor: 100_000 }, { dueDate: "2024-03-01", paidDate: "2024-02-20", amountMinor: 100_000 }] });
    const edited = allocateObservedRepayments({ model: MODEL, opening, repayments: [{ dueDate: "2024-02-01", paidDate: "2024-01-21", amountMinor: 100_000, appliedInterestMinor: 20_001 }, { dueDate: "2024-03-01", paidDate: "2024-02-20", amountMinor: 100_000 }] });
    if (!calculated.ok || !edited.ok) throw new Error("allocation failed");
    expect(edited.rows[0]).toMatchObject({ interestMinor: 20_001, principalMinor: 79_999, balanceAfterMinor: calculated.rows[0].balanceAfterMinor + 1 });
    expect(edited.rows[1].balanceBeforeMinor).toBe(calculated.rows[1].balanceBeforeMinor + 1);
    expect(allocateObservedRepayments({ model: MODEL, opening, repayments: [{ dueDate: "2024-02-01", paidDate: "2024-01-21", amountMinor: 100_000, appliedInterestMinor: -1 }] }).ok).toBe(false);
  });
});

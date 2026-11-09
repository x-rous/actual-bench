import type { LoanModelSnapshot } from "./model";
import { simulatePeriodic } from "./periodic-engine";

// 500,000 at 5.4% (0.45% a month), monthly on the 15th, level payment 3,411.26.
const MODEL = {
  debtId: "d", revision: 1, currency: { code: "EUR", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
  terms: { openingDate: "2024-01-15", openingPrincipalMinor: 500_000_00, maturityDate: null, contractualTermMonths: 240, amortizationTermMonths: 240, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2024-02-15", firstInterestChargeDate: null },
  profile: {
    amortization: "level-payment", rateQuote: "nominal-simple-periodic", dayCount: "actual-365-fixed", accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null,
    capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "annuity-at-payment-frequency", recast: "never", rateEffectiveTiming: "on-accrual-effective-date",
    repaymentEffectiveTiming: "transaction-date",
    rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" },
    eventOrder: { timing: "end-of-day" }, finalPayment: "true-up-to-zero", shortMonth: "clamp-to-last-calendar-day", negativeAmortizationAllowed: false,
    interestOnlyRepayment: "charged-interest-outstanding", presetId: null,
  },
  rates: [{ accrualEffectiveFrom: "2024-01-15", annualRateDecimal: "0.054" }],
  phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
} as LoanModelSnapshot;

const anchor = { date: "2024-01-15", principalMinor: 500_000_00, accruedInterestMinor: 0, source: "opening" };
const extra = (date: string, amountMinor = 20_000_00) => ({ kind: "extra-repayment" as const, date, amountMinor, ref: { source: "actual" as const, id: `x-${date}` } });

function run(events: ReturnType<typeof extra>[], model: LoanModelSnapshot = MODEL) {
  const result = simulatePeriodic({ model, anchor, events, to: "2024-07-31" });
  if (!result.ok) throw new Error(result.blocked[0].message);
  return result.events;
}
const repaymentOn = (events: ReturnType<typeof run>, date: string) => events.find((e) => e.type === "repayment" && e.date === date)!;
const monthInterest = (balanceMinor: number) => Math.round(balanceMinor * 0.0045);

describe("per-period interest with an extra repayment between due dates (loan-periodic@3)", () => {
  const plain = run([]);
  const between = run([extra("2024-03-20")]);

  it("keeps the transaction date and lowers the balance on that day", () => {
    const paid = between.find((e) => e.type === "extra-repayment")!;
    expect(paid).toMatchObject({ date: "2024-03-20", principalMovementMinor: -20_000_00, balanceBeforeMinor: repaymentOn(plain, "2024-03-15").balanceAfterMinor });
    expect(paid.balanceAfterMinor).toBe(repaymentOn(plain, "2024-03-15").balanceAfterMinor - 20_000_00);
  });

  it("charges the period it falls in on the period-opening balance, then the lower balance from the next period", () => {
    // 15 Mar: before the extra, unchanged.
    expect(repaymentOn(between, "2024-03-15").interestMinor).toBe(repaymentOn(plain, "2024-03-15").interestMinor);
    // 15 Apr: the period 15 Mar–15 Apr opened before the extra, so its interest is unchanged.
    const april = repaymentOn(between, "2024-04-15");
    expect(april.interestMinor).toBe(repaymentOn(plain, "2024-04-15").interestMinor);
    expect(april.interestMinor).toBe(monthInterest(repaymentOn(plain, "2024-03-15").balanceAfterMinor));
    // ...but its balance before is after the extra, and the level payment repays the same principal.
    expect(april.balanceBeforeMinor).toBe(repaymentOn(plain, "2024-03-15").balanceAfterMinor - 20_000_00);
    expect(april.principalMovementMinor).toBe(repaymentOn(plain, "2024-04-15").principalMovementMinor);
    // 15 May: the first period opening after the extra; 20,000 × 0.45% = 90.00 less interest.
    const may = repaymentOn(between, "2024-05-15");
    expect(may.interestMinor).toBe(monthInterest(april.balanceAfterMinor));
    expect(repaymentOn(plain, "2024-05-15").interestMinor - may.interestMinor).toBe(90_00);
  });

  it("matches the same extra paid on the next due date from that period on", () => {
    const onDueDate = run([extra("2024-04-15")]);
    for (const date of ["2024-05-15", "2024-06-15", "2024-07-15"]) {
      expect(repaymentOn(between, date)).toMatchObject({ interestMinor: repaymentOn(onDueDate, date).interestMinor, balanceAfterMinor: repaymentOn(onDueDate, date).balanceAfterMinor });
    }
  });

  it("applies extras before the first due date and after the last one in the window", () => {
    const events = run([extra("2024-01-20", 1_000_00), extra("2024-07-20", 1_000_00)]);
    expect(repaymentOn(events, "2024-02-15").interestMinor).toBe(repaymentOn(plain, "2024-02-15").interestMinor);
    expect(events.filter((e) => e.type === "extra-repayment").map((e) => e.date)).toEqual(["2024-01-20", "2024-07-20"]);
  });

  it("still refuses a draw between due dates", () => {
    const result = simulatePeriodic({ model: MODEL, anchor, events: [{ kind: "draw", date: "2024-03-20", amountMinor: 1_000_00, ref: { source: "actual", id: "d" } }], to: "2024-07-31" });
    expect(result.ok ? null : result.blocked[0].code).toBe("irregular-event");
  });
});

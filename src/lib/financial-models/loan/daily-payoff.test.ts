import { simulateDaily, simulateDailyV2 } from "./daily-engine";
import type { FutureAssumption, LedgerEvent, LoanModelSnapshot, SimulationResult } from "./model";

const OPEN = "2024-01-01";

function model(overrides: Partial<LoanModelSnapshot> = {}, profile: Partial<LoanModelSnapshot["profile"]> = {}): LoanModelSnapshot {
  return {
    debtId: "payoff",
    revision: 1,
    currency: { code: "USD", minorDigits: 2 },
    behaviorClass: "term-loan",
    lenderPattern: "embedded-interest",
    terms: {
      openingDate: OPEN,
      openingPrincipalMinor: 10_000,
      maturityDate: "2024-06-01",
      contractualTermMonths: 5,
      amortizationTermMonths: 5,
      contractualPaymentMinor: 3_000,
      creditLimitMinor: null,
      firstPaymentDate: "2024-02-01",
      firstInterestChargeDate: null,
    },
    profile: {
      amortization: "level-payment",
      rateQuote: "nominal-simple-periodic",
      dayCount: "actual-365-fixed",
      accrual: "daily-simple",
      chargeFrequency: "at-repayment",
      chargeDay: null,
      capitalization: "at-charge",
      repaymentFrequency: "monthly",
      repaymentDerivation: "contractual-fixed",
      recast: "never",
      rateEffectiveTiming: "on-accrual-effective-date",
      repaymentEffectiveTiming: "transaction-date",
      rounding: {
        paymentRounding: "half-up",
        interestPostingRounding: "half-up",
        intermediateScale: { mode: "full" },
        intermediateRounding: "half-even",
        balancePrecision: "round-each-posting",
      },
      eventOrder: { timing: "start-of-day" },
      finalPayment: "true-up-to-zero",
      shortMonth: "clamp-to-last-calendar-day",
      negativeAmortizationAllowed: false,
      interestOnlyRepayment: "charged-interest-outstanding",
      presetId: null,
      ...profile,
    },
    rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0" }],
    phases: [],
    offsets: [],
    components: [],
    paymentRecasts: [],
    assumptions: [],
    revolving: null,
    ...overrides,
  };
}

function run(m: LoanModelSnapshot, to = "2024-06-01"): Extract<SimulationResult, { ok: true }> {
  const result = simulateDaily({ model: m, anchor: { date: OPEN, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: [], to });
  if (!result.ok) throw new Error(result.blocked.map((b) => b.message).join("; "));
  return result;
}

const recurring = (from = "2024-01-10", amountMinor = 6_000, until = "2024-05-10"): FutureAssumption => ({
  kind: "extra-repayment",
  date: from,
  amountMinor,
  recurrence: { frequency: "monthly", until },
});

describe("assumed extra repayments after payoff (loan-daily@5)", () => {
  it("caps the payoff occurrence, emits no later zero-value events, and keeps requested/applied diagnostics", () => {
    const result = run(model({ assumptions: [recurring()] }));
    const extras = result.events.filter((e) => e.type === "extra-repayment");
    expect(extras.map((e) => [e.date, -e.cashMovementMinor, e.balanceAfterMinor])).toEqual([
      ["2024-01-10", 6_000, 4_000],
      ["2024-02-10", 1_000, 0],
    ]);
    expect(extras[1].diagnostics).toMatchObject({ requestedAmountMinor: 6_000, appliedAmountMinor: 1_000, cappedAtOutstanding: true });
    expect(result.events.filter((e) => e.type === "extra-repayment" && e.date > "2024-02-10")).toEqual([]);
    expect(result.closing).toMatchObject({ principalMinor: 0, paidOff: true });
  });

  it("uses the same up-to rule for a one-off assumed extra", () => {
    const result = run(model({ assumptions: [{ kind: "extra-repayment", date: "2024-01-10", amountMinor: 25_000 }] }), "2024-01-10");
    expect(result.events).toContainEqual(expect.objectContaining({ type: "extra-repayment", cashMovementMinor: -10_000, balanceAfterMinor: 0, diagnostics: expect.objectContaining({ requestedAmountMinor: 25_000, appliedAmountMinor: 10_000 }) }));
  });

  it("does not call principal-zero paid off while accrued interest remains", () => {
    const interestModel = model({
      rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.365" }],
      assumptions: [{ kind: "extra-repayment", date: "2024-01-10", amountMinor: 10_000 }],
    });
    const interim = run(interestModel, "2024-01-10");
    expect(interim.closing).toMatchObject({ principalMinor: 0, accruedInterestMinor: 80, paidOff: false });
    const settled = run(interestModel, "2024-02-01");
    expect(settled.events.at(-1)).toMatchObject({ type: "final-payment", interestMinor: 80, cashMovementMinor: -80, balanceAfterMinor: 0 });
    expect(settled.closing).toMatchObject({ principalMinor: 0, accruedInterestMinor: 0, paidOff: true });
  });

  it("keeps expanded recurrences available when a later draw reopens debt", () => {
    const result = run(model({ assumptions: [
      { kind: "extra-repayment", date: "2024-01-10", amountMinor: 20_000 },
      recurring("2024-02-10", 6_000, "2024-04-10"),
      { kind: "draw", date: "2024-03-05", amountMinor: 5_000 },
    ] }));
    expect(result.events.filter((e) => e.type === "extra-repayment").map((e) => [e.date, -e.cashMovementMinor])).toEqual([
      ["2024-01-10", 10_000],
      ["2024-03-10", 5_000],
    ]);
    expect(result.events.find((e) => e.type === "draw")).toMatchObject({ date: "2024-03-05", balanceAfterMinor: 5_000 });
  });

  it("keeps expanded recurrences available when a later capitalized fee reopens debt", () => {
    const result = run(model({ assumptions: [
      { kind: "extra-repayment", date: "2024-01-10", amountMinor: 20_000 },
      recurring("2024-02-10", 6_000, "2024-04-10"),
      { kind: "fee", date: "2024-03-05", amountMinor: 4_000, treatment: "capitalized" },
    ] }));
    expect(result.events.find((e) => e.type === "fee")).toMatchObject({ date: "2024-03-05", principalMovementMinor: 4_000, balanceAfterMinor: 4_000 });
    expect(result.events.filter((e) => e.type === "extra-repayment").map((e) => [e.date, -e.cashMovementMinor])).toEqual([
      ["2024-01-10", 10_000],
      ["2024-03-10", 4_000],
    ]);
  });

  it("leaves a residual available to assumed extras but emits nothing after a contractual balloon", () => {
    const terms = { ...model().terms, maturityDate: "2024-02-01", contractualTermMonths: 1, amortizationTermMonths: 12 };
    const assumption = recurring("2024-03-01", 10_000, "2024-04-01");
    const residual = run(model({ terms, assumptions: [assumption] }, { finalPayment: "keep-level-payment-with-residual" }), "2024-04-01");
    expect(residual.events.find((e) => e.type === "residual")).toMatchObject({ balanceAfterMinor: 7_000 });
    expect(residual.events.find((e) => e.type === "extra-repayment")).toMatchObject({ date: "2024-03-01", cashMovementMinor: -7_000, balanceAfterMinor: 0 });

    const balloon = run(model({ terms, assumptions: [assumption] }, { finalPayment: "contractual-balloon" }), "2024-04-01");
    expect(balloon.events.find((e) => e.type === "balloon")).toMatchObject({ cashMovementMinor: -7_000, balanceAfterMinor: 0 });
    expect(balloon.events.filter((e) => e.type === "extra-repayment")).toEqual([]);
  });

  it("does not silently cap observed cash or revolving-facility assumptions", () => {
    const observed: LedgerEvent = { kind: "extra-repayment", date: "2024-01-10", amountMinor: 20_000, ref: { source: "actual", id: "cash" } };
    const observedResult = simulateDaily({ model: model(), anchor: { date: OPEN, principalMinor: 10_000, accruedInterestMinor: 0, source: "opening" }, events: [observed], to: "2024-01-10" });
    expect(observedResult.ok ? null : observedResult.blocked[0]).toMatchObject({ code: "credit-balance", classification: "review" });

    const revolving = model({
      behaviorClass: "revolving-credit",
      terms: { ...model().terms, creditLimitMinor: 50_000 },
      assumptions: [{ kind: "extra-repayment", date: "2024-01-10", amountMinor: 20_000 }],
      revolving: { paymentModel: "fixed-scheduled", percentOfBalanceBps: null, minimumFloorMinor: null },
    }, { amortization: "revolving" });
    const revolvingResult = simulateDaily({ model: revolving, anchor: { date: OPEN, principalMinor: 10_000, accruedInterestMinor: 0, source: "opening" }, events: [], to: "2024-01-10" });
    expect(revolvingResult.ok ? null : revolvingResult.blocked[0]).toMatchObject({ code: "credit-balance", classification: "review" });
  });

  it("keeps loan-daily@2 callable with its previous overpayment result", () => {
    const old = simulateDailyV2({ model: model({ assumptions: [{ kind: "extra-repayment", date: "2024-01-10", amountMinor: 20_000 }] }), anchor: { date: OPEN, principalMinor: 10_000, accruedInterestMinor: 0, source: "opening" }, events: [], to: "2024-01-10" });
    expect(old.ok ? null : old.blocked[0]).toMatchObject({ code: "credit-balance", classification: "review" });
    expect(old.versions).toMatchObject({ engine: "loan-daily@2", repayment: "repayment@1", recast: "recast@1" });
  });
});

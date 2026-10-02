import { projectDebt } from "./projection";
import { simulateDaily, simulateDailyAtVersion } from "./daily-engine";
import type { FutureAssumption, LedgerEvent, LoanModelSnapshot, SimulationRequest } from "./model";
import { eligibleOffset, fundScheduledRepayment } from "./offsets";
import { fromMinor, sub, toMinor } from "../money/kernel";
import { interestBase } from "./accrual";

const OPEN = "2024-01-01";

function model(assumptions: FutureAssumption[], offsets: LoanModelSnapshot["offsets"] = [{ id: "o1", accountId: "offset-1", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10_000, basis: "total", capMinor: null }]): LoanModelSnapshot {
  return {
    debtId: "offset-events",
    revision: 1,
    currency: { code: "USD", minorDigits: 2 },
    behaviorClass: "term-loan",
    lenderPattern: "embedded-interest",
    terms: { openingDate: OPEN, openingPrincipalMinor: 100_000, maturityDate: null, contractualTermMonths: 12, amortizationTermMonths: 12, contractualPaymentMinor: 10_000, creditLimitMinor: null, firstPaymentDate: "2024-02-01", firstInterestChargeDate: null },
    profile: {
      amortization: "level-payment", rateQuote: "nominal-simple-periodic", dayCount: "actual-365-fixed",
      accrual: "daily-simple", chargeFrequency: "at-repayment", chargeDay: null, capitalization: "at-charge",
      repaymentFrequency: "monthly", repaymentDerivation: "contractual-fixed", recast: "never",
      rateEffectiveTiming: "on-accrual-effective-date", repaymentEffectiveTiming: "transaction-date",
      rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" },
      eventOrder: { timing: "start-of-day" }, finalPayment: "true-up-to-zero", shortMonth: "clamp-to-last-calendar-day",
      negativeAmortizationAllowed: false, interestOnlyRepayment: "charged-interest-outstanding", presetId: null,
    },
    rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.365" }],
    phases: [], offsets, components: [], paymentRecasts: [], assumptions, revolving: null,
  };
}

function request(m: LoanModelSnapshot, to = "2024-04-30", events: LedgerEvent[] = [], anchorDate = OPEN): SimulationRequest {
  return { model: m, anchor: { date: anchorDate, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "test" }, events, to, options: { generateScheduledRepayments: false } };
}

describe("offset deposits and withdrawals (loan-daily@6)", () => {
  it("applies one-off and recurring deltas without emitting amortization events", () => {
    const m = model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 1_000 },
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 500, recurrence: { frequency: "monthly", until: "2024-03-10" } },
      { kind: "offset-withdrawal", date: "2024-02-15", accountId: "offset-1", amountMinor: 700, recurrence: { frequency: "monthly", until: "2024-03-15" } },
    ]);
    const result = simulateDaily(request(m));
    if (!result.ok) throw new Error(result.blocked[0].message);
    expect(result.offsetStates.map((point) => [point.date, point.balanceMinor, point.totalBalanceMinor])).toEqual([
      ["2024-01-01", 1_000, 1_000],
      ["2024-01-10", 1_500, 1_500],
      ["2024-02-10", 2_000, 2_000],
      ["2024-02-15", 1_300, 1_300],
      ["2024-03-10", 1_800, 1_800],
      ["2024-03-15", 1_100, 1_100],
    ]);
    expect(result.events.some((event) => event.type === "repayment" || event.type === "extra-repayment" || event.type === "draw")).toBe(false);
  });

  it("uses observed snapshot precedence, then aggregated deposits, then withdrawals independent of input order", () => {
    const assumptions: FutureAssumption[] = [
      { kind: "offset-balance", date: "2024-01-10", accountId: "offset-1", balanceMinor: 1_000 },
      { kind: "offset-withdrawal", date: "2024-01-10", accountId: "offset-1", amountMinor: 400 },
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 200 },
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 300 },
    ];
    const observed: LedgerEvent = { kind: "offset-balance", date: "2024-01-10", accountId: "offset-1", balanceMinor: 2_000, clearedBalanceMinor: 2_000 };
    const first = simulateDaily(request(model(assumptions), "2024-01-10", [observed]));
    const second = simulateDaily(request(model([...assumptions].reverse()), "2024-01-10", [observed]));
    if (!first.ok || !second.ok) throw new Error("unexpected block");
    expect(first.offsetStates.at(-1)).toMatchObject({ balanceMinor: 2_100, totalBalanceMinor: 2_100 });
    expect(second.offsetStates).toEqual(first.offsetStates);
  });

  it("keeps the complete offset-change step on the configured side of daily accrual", () => {
    const assumptions: FutureAssumption[] = [
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 0 },
      { kind: "offset-deposit", date: "2024-01-02", accountId: "offset-1", amountMinor: 10_000 },
    ];
    const beforeModel = model(assumptions);
    const afterModel = model(assumptions);
    afterModel.profile = { ...afterModel.profile, eventOrder: { timing: "end-of-day" } };
    const before = simulateDaily(request(beforeModel, "2024-01-02"));
    const after = simulateDaily(request(afterModel, "2024-01-02"));
    if (!before.ok || !after.ok) throw new Error("unexpected block");
    expect(before.closing.accruedInterestMinor).toBe(90);
    expect(after.closing.accruedInterestMinor).toBe(100);
  });

  it("Reviews an insufficient withdrawal with requested and available amounts", () => {
    const result = simulateDaily(request(model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 1_000 },
      { kind: "offset-withdrawal", date: "2024-01-10", accountId: "offset-1", amountMinor: 1_001 },
    ]), "2024-01-10"));
    expect(result.ok ? null : result.blocked[0]).toMatchObject({
      code: "offset-withdrawal-exceeds-balance",
      classification: "review",
      diagnostics: { accountId: "offset-1", requestedAmountMinor: 1_001, availableAmountMinor: 1_000 },
    });
  });

  it("replays recurring pre-anchor state and keeps later occurrences material", () => {
    const result = simulateDaily(request(model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 100 },
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 100, recurrence: { frequency: "monthly", until: "2024-03-10" } },
      { kind: "offset-withdrawal", date: "2024-02-20", accountId: "offset-1", amountMinor: 250 },
    ]), "2024-03-10", [], "2024-02-15"));
    if (!result.ok) throw new Error(result.blocked[0].message);
    expect(result.offsetStates.map((point) => [point.date, point.balanceMinor])).toEqual([
      ["2024-01-01", 100], ["2024-01-10", 200], ["2024-02-10", 300], ["2024-02-15", 300], ["2024-02-20", 50], ["2024-03-10", 150],
    ]);
  });

  it("emits authoritative state when an existing balance becomes eligible and when its link expires", () => {
    const offsets = [{ id: "o1", accountId: "offset-1", effectiveFrom: "2024-02-01", effectiveTo: "2024-03-01", percentageBps: 10_000, basis: "total" as const, capMinor: null }];
    const result = simulateDaily(request(model([
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 500 },
    ], offsets), "2024-03-01"));
    if (!result.ok) throw new Error(result.blocked[0].message);
    expect(result.offsetStates.map((point) => [point.date, point.balanceMinor, point.totalBalanceMinor])).toEqual([
      ["2024-01-01", 0, 0],
      ["2024-01-10", 500, 0],
      ["2024-02-01", 500, 500],
      ["2024-03-01", 500, 0],
    ]);
  });

  it("does not settle principal merely because the loan is fully offset", () => {
    const result = simulateDaily(request(model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 100_000 },
    ]), "2024-01-31"));
    if (!result.ok) throw new Error(result.blocked[0].message);
    expect(result.closing.principalMinor).toBe(100_000);
    expect(result.closing.accruedInterestMinor).toBe(0);
    expect(result.events).toEqual([]);
  });

  it("Reviews conflicting snapshots at the same authority instead of using row order", () => {
    const result = simulateDaily(request(model([
      { kind: "offset-balance", date: "2024-01-10", accountId: "offset-1", balanceMinor: 1_000 },
      { kind: "offset-balance", date: "2024-01-10", accountId: "offset-1", balanceMinor: 1_001 },
    ]), "2024-01-10"));
    expect(result.ok ? null : result.blocked[0]).toMatchObject({
      code: "conflicting-offset-snapshot",
      classification: "review",
      date: "2024-01-10",
      diagnostics: { accountId: "offset-1", snapshotCount: 2 },
    });
  });

  it("reports a final same-day total across multiple offset accounts", () => {
    const offsets = [
      { id: "o1", accountId: "offset-1", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10_000, basis: "total" as const, capMinor: null },
      { id: "o2", accountId: "offset-2", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10_000, basis: "cleared" as const, capMinor: null },
    ];
    const result = simulateDaily(request(model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 1_000 },
      { kind: "offset-balance", date: OPEN, accountId: "offset-2", balanceMinor: 2_000 },
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 500 },
      { kind: "offset-withdrawal", date: "2024-01-10", accountId: "offset-2", amountMinor: 750 },
    ], offsets), "2024-01-10"));
    if (!result.ok) throw new Error(result.blocked[0].message);
    expect(result.offsetStates.filter((point) => point.date === "2024-01-10")).toEqual([
      expect.objectContaining({ accountId: "offset-1", balanceMinor: 1_500, totalBalanceMinor: 2_750 }),
      expect.objectContaining({ accountId: "offset-2", balanceMinor: 1_250, totalBalanceMinor: 2_750 }),
    ]);
  });

  it("keeps state points out of schedule events and exposes them through projection@2", () => {
    const m = model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 1_000 },
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 500 },
    ]);
    const projection = projectDebt({ model: m, anchor: { date: OPEN, principalMinor: 100_000, accruedInterestMinor: 0, source: "test" }, events: [], from: OPEN, to: "2024-01-10" });
    if (!projection.ok) throw new Error(projection.blocked[0].message);
    expect(projection.schemaVersion).toBe(2);
    expect(projection.offsetStates.at(-1)).toMatchObject({ date: "2024-01-10", totalBalanceMinor: 1_500 });
    expect(projection.events.some((event) => event.date === "2024-01-10")).toBe(false);
  });

  it("carries the last authoritative offset state to a projection window that starts later", () => {
    const m = model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 1_000 },
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 500 },
    ]);
    const projection = projectDebt({ model: m, anchor: { date: OPEN, principalMinor: 100_000, accruedInterestMinor: 0, source: "test" }, events: [], from: "2024-02-20", to: "2024-02-28" });
    if (!projection.ok) throw new Error(projection.blocked[0].message);
    expect(projection.offsetStates[0]).toMatchObject({ date: "2024-02-20", balanceMinor: 1_500, totalBalanceMinor: 1_500 });
  });

  it("keeps loan-daily@4 callable and rejects new event kinds instead of ignoring them", () => {
    const result = simulateDailyAtVersion("loan-daily@4", request(model([
      { kind: "offset-deposit", date: "2024-01-10", accountId: "offset-1", amountMinor: 500 },
    ]), "2024-01-10"));
    expect(result.ok ? null : result.blocked[0]).toMatchObject({ code: "unsupported-profile" });
    expect(result.versions).toMatchObject({ engine: "loan-daily@4", "event-order": "event-order@1" });
    expect(result.versions).not.toHaveProperty("offsets");
  });
});

describe("offset-funded scheduled repayments (loan-daily@6)", () => {
  const fundedModel = (balanceMinor: number, patch: Partial<LoanModelSnapshot> = {}) => {
    const base = model([{ kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor }]);
    return {
      ...base,
      offsets: base.offsets.map((link) => ({ ...link, fundScheduledRepayments: true })),
      ...patch,
    };
  };
  const scheduledRequest = (m: LoanModelSnapshot, to = "2024-02-01"): SimulationRequest => ({
    model: m,
    anchor: { date: OPEN, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "test" },
    events: [],
    to,
  });

  it.each([
    [20_000, 10_000, 0],
    [4_000, 4_000, 6_000],
    [0, 0, 10_000],
  ])("funds a regular payment from a full, partial or zero balance", (balance, fromOffset, otherFunds) => {
    const result = simulateDaily(scheduledRequest(fundedModel(balance)));
    if (!result.ok) throw new Error(result.blocked[0].message);
    const payment = result.events.find((event) => event.type === "repayment")!;
    expect(payment.cashMovementMinor).toBe(-10_000);
    expect(payment.diagnostics).toMatchObject({
      repaymentFundingMode: "simulated-offset",
      scheduledDebtPaymentMinor: 10_000,
      additionalCashPaidMinor: 0,
      totalCashPaymentMinor: 10_000,
      offsetFundedMinor: fromOffset,
      otherFundsMinor: otherFunds,
    });
    expect(Number(payment.diagnostics.offsetFundedMinor) + Number(payment.diagnostics.otherFundsMinor)).toBe(-payment.cashMovementMinor);
    expect(result.offsetStates.at(-1)).toMatchObject({ balanceMinor: balance - fromOffset });
  });

  it("funds the final true-up without changing its amount", () => {
    const m = fundedModel(2_000, {
      terms: { ...fundedModel(2_000).terms, openingPrincipalMinor: 5_000 },
    });
    const result = simulateDaily(scheduledRequest(m));
    if (!result.ok) throw new Error(result.blocked[0].message);
    const payment = result.events.find((event) => event.type === "final-payment")!;
    expect(payment.interestMinor).toBe(90);
    expect(payment.cashMovementMinor).toBe(-5_090);
    expect(payment.diagnostics).toMatchObject({ offsetFundedMinor: 2_000, otherFundsMinor: 3_090 });
    expect(result.closing.principalMinor).toBe(0);
  });

  it("keeps additional cash-paid fees in Other funds exactly once", () => {
    const m = fundedModel(20_000, {
      components: [{ economicKind: "fee", label: "Service fee", destination: "category", categoryId: "fees", amountRule: "fixed", fixedAmountMinor: 1_000, treatment: "cash-paid", order: 1 }],
    });
    const result = simulateDaily(scheduledRequest(m));
    if (!result.ok) throw new Error(result.blocked[0].message);
    const payment = result.events.find((event) => event.type === "repayment")!;
    expect(payment.cashMovementMinor).toBe(-11_000);
    expect(payment.feesMinor).toBe(1_000);
    expect(payment.diagnostics).toMatchObject({
      scheduledDebtPaymentMinor: 10_000,
      additionalCashPaidMinor: 1_000,
      totalCashPaymentMinor: 11_000,
      offsetFundedMinor: 10_000,
      otherFundsMinor: 1_000,
    });
  });

  it("funds the ordinary scheduled part but not a separate contractual balloon", () => {
    const base = fundedModel(50_000);
    const m = {
      ...base,
      terms: { ...base.terms, contractualTermMonths: 1, amortizationTermMonths: 12 },
      profile: { ...base.profile, finalPayment: "contractual-balloon" as const },
    };
    const result = simulateDaily(scheduledRequest(m));
    if (!result.ok) throw new Error(result.blocked[0].message);
    const payment = result.events.find((event) => event.type === "final-payment")!;
    const balloon = result.events.find((event) => event.type === "balloon")!;
    expect(payment.diagnostics.offsetFundedMinor).toBe(10_000);
    expect(balloon.cashMovementMinor).toBeLessThan(0);
    expect(balloon.diagnostics).not.toHaveProperty("offsetFundedMinor");
    expect(result.offsetStates.at(-1)).toMatchObject({ balanceMinor: 40_000 });
  });

  it("does not fund an observed repayment", () => {
    const m = fundedModel(20_000);
    const result = simulateDaily({
      ...scheduledRequest(m),
      events: [{ kind: "repayment", date: "2024-01-15", amountMinor: 5_000, ref: { source: "actual", id: "observed" } }],
      options: { generateScheduledRepayments: false },
    });
    if (!result.ok) throw new Error(result.blocked[0].message);
    expect(result.events[0].diagnostics).not.toHaveProperty("offsetFundedMinor");
    expect(result.offsetStates.at(-1)).toMatchObject({ balanceMinor: 20_000 });
  });

  it("uses only offset state already applied at the scheduled-repayment step", () => {
    const assumptions: FutureAssumption[] = [
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 0 },
      { kind: "offset-deposit", date: "2024-02-01", accountId: "offset-1", amountMinor: 10_000 },
    ];
    const base = model(assumptions);
    base.offsets = base.offsets.map((link) => ({ ...link, fundScheduledRepayments: true }));
    const scheduledFirst = simulateDaily(scheduledRequest(base));
    const offsetFirstModel = { ...base, profile: { ...base.profile, eventOrder: { scheduledRepayments: "after-accrual" as const, otherPayments: "before-accrual" as const, offsets: "before-accrual" as const } } };
    const offsetFirst = simulateDaily(scheduledRequest(offsetFirstModel));
    if (!scheduledFirst.ok || !offsetFirst.ok) throw new Error("unexpected block");
    expect(scheduledFirst.events.find((event) => event.type === "repayment")!.diagnostics.offsetFundedMinor).toBe(0);
    expect(offsetFirst.events.find((event) => event.type === "repayment")!.diagnostics.offsetFundedMinor).toBe(10_000);
  });

  it("rejects overlapping funding sources and old engine versions", () => {
    const m = fundedModel(20_000);
    m.offsets.push({ ...m.offsets[0], id: "o2", accountId: "offset-2" });
    const conflict = simulateDaily(scheduledRequest(m));
    expect(conflict.ok ? null : conflict.blocked[0]).toMatchObject({ code: "conflicting-offset-funding-source", classification: "blocked" });

    const old = simulateDailyAtVersion("loan-daily@5", scheduledRequest(fundedModel(20_000)));
    expect(old.ok ? null : old.blocked[0]).toMatchObject({ code: "unsupported-profile" });
    expect(old.versions).toMatchObject({ engine: "loan-daily@5", "event-order": "event-order@2", offsets: "offsets@2" });
  });

  it("draws only the selected account while every linked account still affects interest", () => {
    const assumptions: FutureAssumption[] = [
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 20_000 },
      { kind: "offset-balance", date: OPEN, accountId: "offset-2", balanceMinor: 30_000 },
    ];
    const m = model(assumptions, [
      { id: "o1", accountId: "offset-1", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10_000, basis: "total", capMinor: null, fundScheduledRepayments: true },
      { id: "o2", accountId: "offset-2", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10_000, basis: "total", capMinor: null, fundScheduledRepayments: false },
    ]);
    const result = simulateDaily(scheduledRequest(m));
    if (!result.ok) throw new Error(result.blocked[0].message);
    expect(result.events.find((event) => event.type === "repayment")?.diagnostics).toMatchObject({
      repaymentFundingAccountId: "offset-1",
      offsetFundedMinor: 10_000,
    });
    expect(result.offsetStates.filter((point) => point.date === "2024-02-01")).toEqual([
      expect.objectContaining({ accountId: "offset-1", balanceMinor: 10_000, totalBalanceMinor: 40_000 }),
    ]);
    expect(result.offsetStates.findLast((point) => point.accountId === "offset-2")).toMatchObject({ balanceMinor: 30_000 });
  });

  it("switches between non-overlapping effective-dated funding sources", () => {
    const m = model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 20_000 },
      { kind: "offset-balance", date: OPEN, accountId: "offset-2", balanceMinor: 20_000 },
    ], [
      { id: "o1", accountId: "offset-1", effectiveFrom: OPEN, effectiveTo: "2024-02-15", percentageBps: 10_000, basis: "total", capMinor: null, fundScheduledRepayments: true },
      { id: "o2", accountId: "offset-2", effectiveFrom: "2024-02-15", effectiveTo: null, percentageBps: 10_000, basis: "total", capMinor: null, fundScheduledRepayments: true },
    ]);
    const result = simulateDaily(scheduledRequest(m, "2024-03-01"));
    if (!result.ok) throw new Error(result.blocked[0].message);
    expect(result.events.filter((event) => event.type === "repayment").map((event) => event.diagnostics.repaymentFundingAccountId)).toEqual([
      "offset-1",
      "offset-2",
    ]);
  });

  it("keeps loan-daily@5 callable and financially identical when the new setting is off", () => {
    const m = model([
      { kind: "offset-balance", date: OPEN, accountId: "offset-1", balanceMinor: 20_000 },
      { kind: "offset-deposit", date: "2024-01-15", accountId: "offset-1", amountMinor: 2_000 },
    ]);
    const current = simulateDaily(scheduledRequest(m, "2024-03-01"));
    const historical = simulateDailyAtVersion("loan-daily@5", scheduledRequest(m, "2024-03-01"));
    if (!current.ok || !historical.ok) throw new Error("unexpected block");
    const financial = (events: typeof current.events) => events.map((event) => ({
      ...event,
      diagnostics: Object.fromEntries(Object.entries(event.diagnostics).filter(([key]) => key !== "eventOrder")),
    }));
    expect(financial(current.events)).toEqual(financial(historical.events));
    expect(current.offsetStates).toEqual(historical.offsetStates);
    expect(current.closing).toEqual(historical.closing);
  });

  it("recomputes partial and capped eligibility instead of assuming funding is neutral", () => {
    const assertBaseChange = (percentageBps: number, capMinor: number | null, expectedBefore: number, expectedAfter: number) => {
      const links = [{ id: "o", accountId: "offset-1", effectiveFrom: OPEN, effectiveTo: null, percentageBps, basis: "total" as const, capMinor, fundScheduledRepayments: true }];
      const balances = new Map([["offset-1", { balanceMinor: 500_000, clearedBalanceMinor: 500_000 }]]);
      const before = interestBase("daily-simple", fromMinor(1_000_000, 2), eligibleOffset(links, balances, OPEN, 2), fromMinor(0, 2));
      const funded = fundScheduledRepayment(OPEN, 100_000, balances, links);
      expect(funded.ok).toBe(true);
      const after = interestBase("daily-simple", sub(fromMinor(1_000_000, 2), fromMinor(100_000, 2)), eligibleOffset(links, balances, OPEN, 2), fromMinor(0, 2));
      expect(toMinor(before, 2, "down")).toBe(expectedBefore);
      expect(toMinor(after, 2, "down")).toBe(expectedAfter);
    };
    assertBaseChange(5_000, null, 750_000, 700_000);
    assertBaseChange(10_000, 200_000, 800_000, 700_000);
  });

  it("never draws more than the lesser cleared and total balance", () => {
    const links = [{ id: "o", accountId: "offset-1", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10_000, basis: "total" as const, capMinor: null, fundScheduledRepayments: true }];
    const balances = new Map([["offset-1", { balanceMinor: 10_000, clearedBalanceMinor: 3_000 }]]);
    const funded = fundScheduledRepayment(OPEN, 5_000, balances, links);
    expect(funded).toMatchObject({ ok: true, offsetFundedMinor: 3_000 });
    expect(balances.get("offset-1")).toEqual({ balanceMinor: 7_000, clearedBalanceMinor: 0 });
  });
});

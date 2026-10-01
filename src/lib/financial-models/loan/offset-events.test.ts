import { projectDebt } from "./projection";
import { simulateDaily, simulateDailyAtVersion } from "./daily-engine";
import type { FutureAssumption, LedgerEvent, LoanModelSnapshot, SimulationRequest } from "./model";

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

describe("offset deposits and withdrawals (loan-daily@5)", () => {
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

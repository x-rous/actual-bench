import { evaluateStrategyEligibility, type ActualCapabilities } from "./eligibility";
import type { LoanModelSnapshot } from "./model";
import { projectDebt, simulate } from "./projection";
import { toReceivableEvents } from "./receivable";
import { isSupportedRevolvingModel, revolvingPayment, revolvingState } from "./revolving";
import { AU_PROFILE } from "./__fixtures__/profiles";

const OPEN = "2024-01-01";
const ALL: ActualCapabilities = { formulaRules: true, splitActions: true, transferPayees: true, ruleReadback: true };

function monthlyModel(o: Partial<LoanModelSnapshot> = {}, profile: Partial<LoanModelSnapshot["profile"]> = {}): LoanModelSnapshot {
  return {
    debtId: "d", revision: 3, currency: { code: "USD", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
    terms: { openingDate: OPEN, openingPrincipalMinor: 2500000, maturityDate: null, contractualTermMonths: 60, amortizationTermMonths: 60, contractualPaymentMinor: 120000, creditLimitMinor: null, firstPaymentDate: "2024-02-01", firstInterestChargeDate: null },
    profile: { ...AU_PROFILE, accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null, repaymentFrequency: "monthly", repaymentDerivation: "contractual-fixed", ...profile },
    rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.096" }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
    ...o,
  };
}
const anchor = (m: LoanModelSnapshot) => ({ date: OPEN, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" });

describe("strategy eligibility (T063)", () => {
  it("recommends the formula rule for a plain monthly level-payment loan when Actual can do it", () => {
    const e = evaluateStrategyEligibility(monthlyModel({}, { repaymentDerivation: "annuity-at-payment-frequency" }), ALL);
    expect(e.recommended).toBe("actual-formula-rule");
  });

  it("falls back to bench-periodic, saying why, when Actual lacks a capability", () => {
    const e = evaluateStrategyEligibility(monthlyModel({}, { repaymentDerivation: "annuity-at-payment-frequency" }), { ...ALL, ruleReadback: false });
    expect(e.recommended).toBe("bench-periodic");
    expect(e.options[0].reasons).toContain("The connected Actual cannot read a rule back to verify it.");
  });

  it.each([
    ["offsets", monthlyModel({ offsets: [{ id: "o", accountId: "a", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10000, basis: "total", capMinor: null }] }), /Offset/],
    ["daily accrual with fortnightly repayments and monthly charging", monthlyModel({}, { ...AU_PROFILE }), /accrues daily/],
    ["irregular extra repayments", monthlyModel({ assumptions: [{ kind: "extra-repayment", date: "2024-03-10", amountMinor: 1000 }] }), /between payment dates/],
  ])("rejects the formula rule for %s, with a reason", (_n, model, reason) => {
    const e = evaluateStrategyEligibility(model, ALL);
    expect(e.options[0].eligible).toBe(false);
    expect(e.options[0].reasons.join(" ")).toMatch(reason);
    expect(e.recommended).not.toBe("actual-formula-rule");
  });

  it("recommends bench-daily for the Australian daily profile", () => {
    expect(evaluateStrategyEligibility(monthlyModel({}, { ...AU_PROFILE }), ALL).recommended).toBe("bench-daily");
  });
});

describe("receivables (T066)", () => {
  it("a 1,200 payment on 25,000 at 9.6% returns 1,000 principal and 200 interest income", () => {
    const m = monthlyModel({ behaviorClass: "receivable-loan" });
    const r = simulate({ model: m, anchor: anchor(m), events: [], to: "2024-02-01" });
    if (!r.ok) throw new Error(r.blocked[0].message);
    const [first] = toReceivableEvents(r.events).filter((e) => e.type === "repayment");
    expect(first).toMatchObject({ cashReceivedMinor: 120000, principalReturnMinor: 100000, interestIncomeMinor: 20000, receivableBeforeMinor: 2500000, receivableAfterMinor: 2400000 });
  });
});

describe("revolving facilities (T065)", () => {
  const base = { balanceMinor: 1000000, lastChargeMinor: 5321, contractualPaymentMinor: 20000, minorDigits: 2, mode: "half-up" as const };

  it("derives the payment from the payment model only", () => {
    expect(revolvingPayment({ paymentModel: "percent-of-balance", percentOfBalanceBps: 200, minimumFloorMinor: 2500 }, base)).toEqual({ ok: true, minor: 20000 });
    expect(revolvingPayment({ paymentModel: "percent-of-balance", percentOfBalanceBps: 200, minimumFloorMinor: 2500 }, { ...base, balanceMinor: 50000 })).toEqual({ ok: true, minor: 2500 });
    expect(revolvingPayment({ paymentModel: "percent-of-balance", percentOfBalanceBps: 200, minimumFloorMinor: 2500 }, { ...base, balanceMinor: 1000 })).toEqual({ ok: true, minor: 1000 });
    expect(revolvingPayment({ paymentModel: "interest-only", percentOfBalanceBps: null, minimumFloorMinor: null }, base)).toEqual({ ok: true, minor: 5321 });
    expect(revolvingPayment({ paymentModel: "fixed-scheduled", percentOfBalanceBps: null, minimumFloorMinor: null }, base)).toEqual({ ok: true, minor: 20000 });
  });

  it("labels an issuer formula unsupported rather than approximating it", () => {
    expect(isSupportedRevolvingModel("issuer-minimum-formula")).toBe(false);
    expect(revolvingPayment({ paymentModel: "issuer-minimum-formula" as never, percentOfBalanceBps: null, minimumFloorMinor: null }, base)).toMatchObject({ ok: false });
  });

  it("tracks limit, drawn and available credit, and implies no amortization or final payment", () => {
    const m = monthlyModel(
      { behaviorClass: "revolving-credit", revolving: { paymentModel: "percent-of-balance", percentOfBalanceBps: 300, minimumFloorMinor: 2500 }, terms: { ...monthlyModel().terms, creditLimitMinor: 5000000, contractualTermMonths: 12 } },
      { ...AU_PROFILE, chargeDay: 1, repaymentFrequency: "monthly", repaymentDerivation: "contractual-fixed" }
    );
    const r = simulate({ model: { ...m, terms: { ...m.terms, firstInterestChargeDate: "2024-02-01" } }, anchor: anchor(m), events: [{ kind: "draw", date: "2024-03-10", amountMinor: 1000000, ref: { source: "actual", id: "d1" } }], to: "2025-06-30" });
    if (!r.ok) throw new Error(r.blocked[0].message);
    expect(r.events.some((e) => e.type === "final-payment" || e.type === "balloon")).toBe(false);
    expect(r.closing.paidOff).toBe(false);
    expect(revolvingState(m, 3500000)).toEqual({ limitMinor: 5000000, drawnMinor: 3500000, availableMinor: 1500000 });
    const draw = r.events.find((e) => e.type === "draw");
    expect(draw).toMatchObject({ principalMovementMinor: 1000000, cashMovementMinor: 1000000 });
  });
});

describe("projection (T067)", () => {
  const m = monthlyModel({}, { ...AU_PROFILE, repaymentDerivation: "contractual-fixed", chargeDay: 1, repaymentFrequency: "fortnightly" });
  const model = { ...m, terms: { ...m.terms, firstInterestChargeDate: "2024-02-01", firstPaymentDate: "2024-01-15", contractualPaymentMinor: 60000 } };
  const input = { model, anchor: anchor(model), events: [], from: "2024-03-01", to: "2024-12-31" };

  it("returns versioned events with every FR-111 field and no ledger operations", () => {
    const p = projectDebt(input);
    if (!p.ok) throw new Error(p.blocked[0].message);
    expect(p.schemaVersion).toBe(1);
    const e = p.events[0];
    expect(Object.keys(e).sort()).toEqual(
      ["balanceAfterMinor", "balanceBeforeMinor", "cashMovementMinor", "categoryAllocations", "certainty", "date", "debtAccountId", "diagnostics", "engineVersions", "eventType", "feesMinor", "interestMinor", "modelRevision", "principalMovementMinor", "sourceAccountId"].sort()
    );
    expect(e.modelRevision).toBe(3);
    expect(e.engineVersions.engine).toBe("loan-daily@3");
    expect(p.events.every((x) => x.date >= "2024-03-01")).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/operations|transactionId|writeActual/);
  });

  it("an interest charge moves no cash", () => {
    const p = projectDebt(input);
    expect(p.ok && p.events.filter((e) => e.eventType === "interest-charge").every((e) => e.cashMovementMinor === 0 && e.interestMinor > 0)).toBe(true);
  });

  it("overrides change only this projection and are never written back", () => {
    const before = JSON.stringify(input);
    const base = projectDebt(input);
    const lump = projectDebt({ ...input, overrides: { assumptions: [{ kind: "extra-repayment", date: "2024-06-10", amountMinor: 1000000 }] } });
    expect(JSON.stringify(input)).toBe(before);
    const closing = (p: ReturnType<typeof projectDebt>) => (p.ok ? p.events.at(-1)!.balanceAfterMinor : NaN);
    expect(closing(base) - closing(lump)).toBeGreaterThan(1000000); // the lump sum, plus the interest it saves
    expect(lump.ok && lump.events.find((e) => e.eventType === "extra-repayment")?.certainty).toBe("assumed");
  });

  it("is deterministic, rolls months into years, and marks a baseline from an older anchor stale", () => {
    expect(projectDebt(input)).toEqual(projectDebt(input));
    const y = projectDebt({ ...input, resolution: "yearly", baselineAnchorDate: "2023-12-01" });
    if (!y.ok) throw new Error("blocked");
    expect(y.stale).toBe(true);
    expect(y.yearly?.[0].interestMinor).toBe(y.monthly.reduce((s, m) => s + m.interestMinor, 0));
    expect(projectDebt({ ...input, baselineAnchorDate: OPEN }).ok && (projectDebt({ ...input, baselineAnchorDate: OPEN }) as { stale: boolean }).stale).toBe(false);
  });

  it("passes a block through instead of projecting", () => {
    const p = projectDebt({ ...input, model: { ...model, rates: [{ accrualEffectiveFrom: "2024-06-01", annualRateDecimal: "0.05" }] } });
    expect(p.ok ? null : p.blocked[0].code).toBe("rate-gap");
  });
});

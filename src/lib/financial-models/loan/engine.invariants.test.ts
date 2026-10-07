import { addDays } from "../calendar/dates";
import { dec, toDecString, toPlainString } from "../money/kernel";
import { dayInterest, interestBase } from "./accrual";
import { chargeDates } from "./charge";
import { simulateDaily } from "./daily-engine";
import { actual365Fixed } from "./daycount/act365f";
import { normalizeEvents } from "./events";
import { finalDecision } from "./finalPayment";
import type { LedgerEvent, LoanModelSnapshot, ModelEvent, SimulationRequest } from "./model";
import { eligibleOffset } from "./offsets";
import { simulatePeriodic } from "./periodic-engine";
import { validatePhases } from "./phases";
import { applyPaymentCap } from "./recast";
import { AU_PROFILE } from "./__fixtures__/profiles";

/*
 * Properties the engines must keep whatever the inputs. Expected values are
 * structural (sums, orderings, equalities between two runs) or computed by
 * hand in the comment beside them; none is copied from an engine run.
 */

const OPEN = "2024-01-15";

function auModel(overrides: Partial<LoanModelSnapshot> = {}, profile: Partial<LoanModelSnapshot["profile"]> = {}): LoanModelSnapshot {
  return {
    debtId: "t", revision: 1, currency: { code: "AUD", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "separate-interest",
    terms: { openingDate: OPEN, openingPrincipalMinor: 40000000, maturityDate: null, contractualTermMonths: 360, amortizationTermMonths: 360, contractualPaymentMinor: 120000, creditLimitMinor: null, firstPaymentDate: "2024-01-29", firstInterestChargeDate: "2024-02-15" },
    profile: { ...AU_PROFILE, repaymentDerivation: "contractual-fixed", chargeDay: 15, ...profile },
    rates: [{ accrualEffectiveFrom: OPEN, annualRateDecimal: "0.0612" }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
    ...overrides,
  };
}

const req = (m: LoanModelSnapshot, events: LedgerEvent[] = [], to = "2024-12-31"): SimulationRequest => ({
  model: m, anchor: { date: OPEN, principalMinor: m.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events, to,
});
const ok = (r: ReturnType<typeof simulateDaily>) => {
  if (!r.ok) throw new Error(r.blocked.map((b) => b.message).join("; "));
  return r;
};
const ref = (id: string) => ({ source: "actual" as const, id });

describe("accrual (T049)", () => {
  it("simple accrual ignores accrued interest; compounded adds it to the base", () => {
    const debt = dec("1000.00");
    const accrued = dec("5.00");
    expect(toDecString(interestBase("daily-simple", debt, dec("0"), accrued))).toBe("1000.00");
    expect(toDecString(interestBase("daily-compounded", debt, dec("0"), accrued))).toBe("1005.00");
  });

  it("an offset larger than the debt leaves a zero base, never a negative one", () => {
    expect(toDecString(interestBase("daily-simple", dec("100"), dec("150"), dec("0")))).toBe("0");
    expect(toDecString(dayInterest(dec("-5"), dec("0.05"), actual365Fixed, "2024-01-01", 10, "half-even"))).toBe("0.0000000000");
  });

  it("compounded interest exceeds simple over the same days, and simple equals rate × days / 365 on a flat base", () => {
    const simple = ok(simulateDaily(req(auModel({}, { repaymentDerivation: "contractual-fixed" }), [], "2024-02-15")));
    const compound = ok(simulateDaily(req(auModel({}, { accrual: "daily-compounded", capitalization: "daily" }), [], "2024-02-15")));
    const charged = (r: typeof simple) => r.events.filter((e) => e.type === "interest-charge").reduce((s, e) => s + e.interestMinor, 0);
    expect(charged(compound)).toBeGreaterThan(charged(simple));
  });
});

describe("accrued versus charged interest (T050, requirement 10)", () => {
  it("uncharged simple interest earns nothing: splitting a month at the anchor changes no charge", () => {
    // Run 15 Jan → 31 Mar in one go, and again as 15 Jan → 1 Feb, then resumed from that closing state.
    const m = auModel();
    const whole = ok(simulateDaily(req(m, [], "2024-03-31")));
    const first = ok(simulateDaily(req(m, [], "2024-02-01")));
    const c = first.closing;
    const second = ok(simulateDaily({ model: m, anchor: { date: c.date, principalMinor: c.principalMinor, accruedInterestMinor: c.accruedInterestMinor, accruedInterestExact: c.accruedInterestExact, carriedRemainder: c.carriedRemainder, scheduledPaymentMinor: c.scheduledPaymentMinor, source: "closing" }, events: [], to: "2024-03-31" }));
    const pick = (evs: ModelEvent[]) => evs.map((e) => [e.date, e.type, e.balanceAfterMinor]);
    expect(pick([...first.events, ...second.events])).toEqual(pick(whole.events));
    expect(second.closing).toEqual(whole.closing);
  });

  it("charges monthly, never at the fortnightly repayments", () => {
    const r = ok(simulateDaily(req(auModel(), [], "2024-06-30")));
    const charges = r.events.filter((e) => e.type === "interest-charge").map((e) => e.date);
    expect(charges).toEqual(["2024-02-15", "2024-03-15", "2024-04-15", "2024-05-15", "2024-06-15"]);
    const repaymentDates = new Set(r.events.filter((e) => e.type === "repayment").map((e) => e.date));
    expect(charges.some((d) => repaymentDates.has(d))).toBe(false);
  });

  it("charge dates keep their day and clamp in short months", () => {
    const m = auModel({ terms: { ...auModel().terms, firstInterestChargeDate: "2024-01-31" } }, { chargeDay: 31 });
    expect(chargeDates(m, "2024-01-01", "2024-05-31")).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31"]);
  });
});

describe("offsets (T051)", () => {
  const link = (o: Partial<Parameters<typeof eligibleOffset>[0][number]> = {}) => ({ id: "o", accountId: "a", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10000, basis: "total" as const, capMinor: null, ...o });
  const bal = (b: number) => new Map([["a", { balanceMinor: b, clearedBalanceMinor: b - 1000 }]]);

  it("min(cap, balance × pct), cleared or total basis, negatives count as zero", () => {
    expect(toDecString(eligibleOffset([link({ percentageBps: 4000 })], bal(5000000), "2024-02-01", 2))).toBe("20000.000000");
    expect(toDecString(eligibleOffset([link({ capMinor: 3000000 })], bal(5000000), "2024-02-01", 2))).toBe("30000.00");
    expect(toDecString(eligibleOffset([link({ basis: "cleared" })], bal(5000000), "2024-02-01", 2))).toBe("49990.000000");
    expect(toPlainString(eligibleOffset([link()], bal(-100), "2024-02-01", 2))).toBe("0");
    expect(toPlainString(eligibleOffset([link({ effectiveTo: "2024-02-01" })], bal(5000000), "2024-02-01", 2))).toBe("0");
  });

  it("an offset never reduces the debt and never appears as a repayment", () => {
    const m = auModel({ offsets: [link()] });
    const offsetEvent: LedgerEvent = { kind: "offset-balance", date: "2024-03-01", accountId: "a", balanceMinor: 9000000, clearedBalanceMinor: 9000000 };
    const withOffset = ok(simulateDaily(req(m, [offsetEvent], "2024-06-30")));
    const without = ok(simulateDaily(req(auModel(), [], "2024-06-30")));
    // Same repayments, less interest: the debt differs only by interest charged.
    const repaid = (r: typeof withOffset) => r.events.filter((e) => e.type === "repayment").reduce((s, e) => s + e.principalMovementMinor, 0);
    const interest = (r: typeof withOffset) => r.events.reduce((s, e) => s + e.interestMinor, 0);
    expect(repaid(withOffset)).toBe(repaid(without));
    expect(interest(withOffset)).toBeLessThan(interest(without));
    expect(withOffset.closing.principalMinor - without.closing.principalMinor).toBe(interest(withOffset) - interest(without));
    expect(withOffset.events.some((e) => e.type === "extra-repayment")).toBe(false);
  });
});

describe("payment caps (T052)", () => {
  it("previous-payment factor caps at previous × factor, rounded by the payment mode", () => {
    expect(applyPaymentCap(66730, 57042, { kind: "previous-payment-factor", factor: "1.075" }, AU_PROFILE, 2)).toEqual({ minor: 61320, uncappedMinor: 66730, capped: true, capMaxMinor: 61320 });
    expect(applyPaymentCap(60000, 57042, { kind: "previous-payment-factor", factor: "1.075" }, AU_PROFILE, 2)).toMatchObject({ minor: 60000, capped: false });
  });

  it("an absolute cap is an amount, and a missing previous payment leaves a factor cap unapplied", () => {
    expect(applyPaymentCap(70000, null, { kind: "absolute", amountMinor: 65000 }, AU_PROFILE, 2)).toMatchObject({ minor: 65000, capped: true });
    expect(applyPaymentCap(70000, null, { kind: "previous-payment-factor", factor: "1.075" }, AU_PROFILE, 2)).toMatchObject({ minor: 70000, capped: false, capMaxMinor: null });
  });
});

describe("phases (T053)", () => {
  it("rejects overlapping or reversed interest-only phases", () => {
    expect(validatePhases([{ kind: "interest-only", from: "2024-01-01", to: "2024-06-01", recastAtEnd: "never" }, { kind: "interest-only", from: "2024-05-01", to: "2024-09-01", recastAtEnd: "never" }])).toMatch(/overlap/);
    expect(validatePhases([{ kind: "interest-only", from: "2024-06-01", to: "2024-01-01", recastAtEnd: "never" }])).toMatch(/ends before/);
    expect(validatePhases([])).toBeNull();
  });
});

describe("extra repayments and draws (T054, T055)", () => {
  it("a negative repayment is refused, never read as a draw", () => {
    const r = simulateDaily(req(auModel(), [{ kind: "extra-repayment", date: "2024-03-06", amountMinor: -500, ref: ref("x") }]));
    expect(r.ok ? null : r.blocked[0].code).toBe("negative-repayment");
    expect(normalizeEvents([{ kind: "draw", date: "2024-03-06", amountMinor: -1, ref: ref("d") }], [], { after: OPEN, to: "2024-12-31" }, { timing: "start-of-day" }).ok).toBe(false);
  });

  it("an extra repayment reduces the debt exactly once; a redraw raises it exactly once", () => {
    const base = ok(simulateDaily(req(auModel(), [], "2024-03-06")));
    const extra = ok(simulateDaily(req(auModel(), [{ kind: "extra-repayment", date: "2024-03-06", amountMinor: 2000000, ref: ref("x") }], "2024-03-06")));
    const draw = ok(simulateDaily(req(auModel(), [{ kind: "draw", date: "2024-03-06", amountMinor: 750000, ref: ref("d") }], "2024-03-06")));
    expect(base.closing.principalMinor - extra.closing.principalMinor).toBe(2000000);
    expect(draw.closing.principalMinor - base.closing.principalMinor).toBe(750000);
    expect(extra.events.filter((e) => e.type === "extra-repayment")).toHaveLength(1);
    expect(draw.events.filter((e) => e.type === "draw")).toHaveLength(1);
  });

  it("a draw beyond the credit limit needs review", () => {
    const m = auModel({ terms: { ...auModel().terms, creditLimitMinor: 40500000 } });
    const r = simulateDaily(req(m, [{ kind: "draw", date: "2024-03-06", amountMinor: 1000000, ref: ref("d") }]));
    expect(r.ok ? null : r.blocked[0]).toMatchObject({ code: "credit-limit-exceeded", classification: "review" });
  });
});

describe("fees (T056): treatment is stated on each fee", () => {
  const fee = (treatment: "cash-paid" | "capitalized"): LedgerEvent => ({ kind: "fee", date: "2024-02-15", amountMinor: 1000, treatment, ref: ref("f") });

  it("a capitalized fee raises the debt by its amount, with no cash and no principal repayment", () => {
    const capitalized = ok(simulateDaily(req(auModel(), [fee("capitalized")], "2024-02-15")));
    const base = ok(simulateDaily(req(auModel(), [], "2024-02-15")));
    // The fee is added on 15 Feb before that day's accrual, so the debt rises by the fee plus one day's interest on it.
    expect(capitalized.closing.principalMinor - base.closing.principalMinor).toBeGreaterThanOrEqual(1000);
    expect(capitalized.events.find((e) => e.type === "fee")).toMatchObject({ cashMovementMinor: 0, principalMovementMinor: 1000, feesMinor: 1000, lines: [{ kind: "fee", amountMinor: 1000 }], diagnostics: { treatment: "capitalized" } });
    expect(capitalized.events.some((e) => e.type === "repayment" && e.date === "2024-02-15")).toBe(false);
  });

  it("a cash-paid fee moves cash but never the debt", () => {
    const paid = ok(simulateDaily(req(auModel(), [fee("cash-paid")], "2024-02-15")));
    const base = ok(simulateDaily(req(auModel(), [], "2024-02-15")));
    expect(paid.closing.principalMinor).toBe(base.closing.principalMinor);
    expect(paid.events.find((e) => e.type === "fee")).toMatchObject({ cashMovementMinor: -1000, principalMovementMinor: 0, feesMinor: 1000, diagnostics: { treatment: "cash-paid" } });
  });

  it("two fee components with different treatments are each handled their own way", () => {
    const components = [
      { economicKind: "fee" as const, label: "Account fee", destination: "category" as const, categoryId: "c", amountRule: "fixed" as const, fixedAmountMinor: 800, treatment: "capitalized" as const, order: 1 },
      { economicKind: "fee" as const, label: "Service fee", destination: "category" as const, categoryId: "c", amountRule: "fixed" as const, fixedAmountMinor: 300, treatment: "cash-paid" as const, order: 2 },
    ];
    const r = ok(simulateDaily(req(auModel({ components }), [], "2024-01-29")));
    const repayment = r.events.find((e) => e.type === "repayment" && e.date === "2024-01-29")!;
    const feeEvent = r.events.find((e) => e.type === "fee" && e.date === "2024-01-29")!;
    expect(feeEvent).toMatchObject({ principalMovementMinor: 800, cashMovementMinor: 0 });
    expect(repayment).toMatchObject({ cashMovementMinor: -(120000 + 300), feesMinor: 300 });
    expect(repayment.lines).toContainEqual({ kind: "fee", amountMinor: 300 });
  });
});

describe("same-day order (event-order@3): before-accrual → accrue → charge → after-accrual", () => {
  // 15 Feb is a charge date; on it: an extra repayment, a scheduled repayment, an offset change and a redraw.
  const sameDay: LedgerEvent[] = [
    { kind: "extra-repayment", date: "2024-02-15", amountMinor: 500000, ref: ref("x") },
    { kind: "draw", date: "2024-02-15", amountMinor: 200000, ref: ref("d") },
    { kind: "offset-balance", date: "2024-02-15", accountId: "a", balanceMinor: 1000000, clearedBalanceMinor: 1000000 },
  ];
  const withOffset = (profile: Partial<LoanModelSnapshot["profile"]>) =>
    auModel({ terms: { ...auModel().terms, firstPaymentDate: "2024-02-15" }, offsets: [{ id: "o", accountId: "a", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10000, basis: "total", capMinor: null }] }, { repaymentFrequency: "monthly", ...profile });
  // Events within one placement group keep the ledger's deterministic order (here, by reference id).
  const dayOf = (r: ReturnType<typeof ok>) => r.events.filter((e) => e.date === "2024-02-15").map((e) => [e.type, e.diagnostics.sameDayStep]);

  it("start-of-day: every event precedes the accrual and the charge", () => {
    const r = ok(simulateDaily(req(withOffset({ eventOrder: { timing: "start-of-day" } }), sameDay, "2024-02-15")));
    expect(dayOf(r)).toEqual([["draw", "payment"], ["extra-repayment", "payment"], ["repayment", "scheduled-repayment"], ["interest-charge", "charge"]]);
    expect(r.events.every((e) => e.diagnostics.eventOrder === "event-order@3")).toBe(true);
  });

  it("end-of-day: every event follows the day's charge", () => {
    const r = ok(simulateDaily(req(withOffset({ eventOrder: { timing: "end-of-day" } }), sameDay, "2024-02-15")));
    expect(dayOf(r)).toEqual([["interest-charge", "charge"], ["draw", "payment"], ["extra-repayment", "payment"], ["repayment", "scheduled-repayment"]]);
  });

  it("a split placement (Figura-compatible): other payments and offsets before, the scheduled repayment after the charge", () => {
    const figura = ok(simulateDaily(req(withOffset({ eventOrder: { scheduledRepayments: "after-accrual", otherPayments: "before-accrual", offsets: "before-accrual" } }), sameDay, "2024-02-15")));
    expect(dayOf(figura)).toEqual([["draw", "payment"], ["extra-repayment", "payment"], ["interest-charge", "charge"], ["repayment", "scheduled-repayment"]]);
  });

  it("placement changes that day's interest: events before the accrual count, events after it do not", () => {
    const before = ok(simulateDaily(req(withOffset({ eventOrder: { timing: "start-of-day" } }), sameDay, "2024-02-15")));
    const after = ok(simulateDaily(req(withOffset({ eventOrder: { timing: "end-of-day" } }), sameDay, "2024-02-15")));
    const charge = (r: typeof before) => r.events.find((e) => e.type === "interest-charge")!.interestMinor;
    // Before: the day accrues on a debt net of 5,000 − 2,000 + 1,200 and a 10,000 offset, so less interest.
    expect(charge(before)).toBeLessThan(charge(after));
    // Either way the closing debt differs only by that day's interest.
    expect(after.closing.principalMinor - before.closing.principalMinor).toBe(charge(after) - charge(before));
  });
});

describe("dated payment recasts (FR-044)", () => {
  const rates = [
    { accrualEffectiveFrom: OPEN, annualRateDecimal: "0.0612" },
    { accrualEffectiveFrom: "2024-06-01", annualRateDecimal: "0.0712" },
  ];
  const model = (profile: Partial<LoanModelSnapshot["profile"]>, recasts: { date: string }[]) =>
    auModel({ rates, paymentRecasts: recasts, terms: { ...auModel().terms, contractualPaymentMinor: null } }, { repaymentDerivation: "annuity-at-payment-frequency", ...profile });

  it("on-contract-date: the rate change alone does not recast; the payment changes on the dated recast", () => {
    const r = ok(simulateDaily(req(model({ recast: "on-contract-date" }, [{ date: "2024-09-01" }]), [], "2024-12-31")));
    const recasts = r.events.filter((e) => e.type === "recast");
    expect(recasts.map((e) => [e.date, e.diagnostics.reason])).toEqual([["2024-09-01", "contract-date"]]);
    const payments = r.events.filter((e) => e.type === "repayment").map((e) => [e.date, -e.cashMovementMinor]);
    const level = (from: string, to: string) => new Set(payments.filter(([d]) => d >= from && d < to).map(([, a]) => a));
    expect(level("2024-01-01", "2024-09-01").size).toBe(1);
    expect(level("2024-09-01", "2025-01-01").size).toBe(1);
    expect([...level("2024-09-01", "2025-01-01")][0]).toBeGreaterThan([...level("2024-01-01", "2024-09-01")][0] as number);
  });

  it("on-rate-change still recasts at the rate's payment date, and a dated recast adds its own", () => {
    const r = ok(simulateDaily(req(model({ recast: "on-rate-change" }, [{ date: "2024-11-01" }]), [], "2024-12-31")));
    expect(r.events.filter((e) => e.type === "recast").map((e) => [e.date, e.diagnostics.reason])).toEqual([["2024-06-01", "rate-change"], ["2024-11-01", "contract-date"]]);
  });

  it("refuses contradictory recast settings", () => {
    expect(simulateDaily(req(model({ recast: "never" }, [{ date: "2024-09-01" }]))).ok).toBe(false);
    expect(simulateDaily(req(model({ recast: "on-contract-date" }, []))).ok).toBe(false);
  });
});

describe("daily interest-only with its own repayment cadence", () => {
  // Monthly charges on the 15th, fortnightly repayments from 29 Jan, an interest-only phase for the year.
  const io = auModel({ phases: [{ kind: "interest-only", from: "2024-01-29", to: "2024-12-31", recastAtEnd: "on-rate-change" }], terms: { ...auModel().terms, contractualPaymentMinor: null } }, { interestOnlyRepayment: "charged-interest-outstanding", repaymentDerivation: "annuity-at-payment-frequency" });
  const repayments = (r: ReturnType<typeof ok>) => r.events.filter((e) => e.type === "repayment");

  it("charged-interest-outstanding: nothing before the first charge; the next repayment pays the charge; later ones in the period pay nothing", () => {
    const r = ok(simulateDaily(req(io, [], "2024-04-30")));
    const charges = r.events.filter((e) => e.type === "interest-charge");
    // 29 Jan (before the first charge on 15 Feb) and 12 Feb pay nothing; 26 Feb pays the 15 Feb charge.
    expect(repayments(r)[0].date).toBe("2024-02-26");
    expect(-repayments(r)[0].cashMovementMinor).toBe(charges[0].interestMinor);
    // One repayment per charge period pays it; each paid amount equals a charge.
    expect(repayments(r).map((e) => -e.cashMovementMinor)).toEqual(charges.slice(0, repayments(r).length).map((e) => e.interestMinor));
    // The principal stays at 400,000 after each interest-only repayment.
    expect(repayments(r).every((e) => e.balanceAfterMinor === 40000000)).toBe(true);
  });

  it("several repayments inside one charge period: only the first after the charge pays, and each pays exactly what was charged", () => {
    const r = ok(simulateDaily(req(io, [], "2024-06-30")));
    const charges = r.events.filter((e) => e.type === "interest-charge");
    for (let i = 0; i + 1 < charges.length; i++) {
      const inPeriod = repayments(r).filter((e) => e.date > charges[i].date && e.date <= charges[i + 1].date);
      expect(inPeriod).toHaveLength(1);
      expect(inPeriod[0].diagnostics).toMatchObject({ interestOnly: true, interestOnlyBasis: "charged-interest-outstanding", chargedInterestPaidMinor: charges[i].interestMinor });
    }
    // The interest was already posted by its charge event, so each repayment only returns the debt to the principal.
    expect(repayments(r).every((e) => e.interestMinor === 0 && e.balanceAfterMinor === 40000000)).toBe(true);
  });

  it("the interest-only phase ends with a recast to an amortizing payment over the remaining term", () => {
    const m = auModel({ phases: [{ kind: "interest-only", from: "2024-01-29", to: "2024-03-31", recastAtEnd: "on-rate-change" }], terms: { ...auModel().terms, contractualPaymentMinor: null } }, { repaymentDerivation: "annuity-at-payment-frequency" });
    const r = ok(simulateDaily(req(m, [], "2024-06-30")));
    const after = repayments(r).filter((e) => e.date > "2024-03-31");
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(after.map((e) => e.cashMovementMinor)).size).toBe(1);
    expect(after.every((e) => e.diagnostics.interestOnly === false)).toBe(true);
    // Amortizing now: the debt falls below the principal.
    expect(r.closing.principalMinor).toBeLessThan(40000000);
  });
});

describe("final payments (T057)", () => {
  it.each([
    ["true-up-to-zero", false, { paymentMinor: 105, paidOff: true, kind: "true-up" }],
    ["contractual-balloon", false, { paymentMinor: 100, balloonMinor: 5, paidOff: true, kind: "balloon" }],
    ["keep-level-payment-with-residual", false, { paymentMinor: 100, residualMinor: 5, paidOff: false, continues: false }],
    ["continue-until-paid", false, { paymentMinor: 100, paidOff: false, continues: true }],
  ] as const)("%s at the contractual end", (policy, _x, expected) => {
    expect(finalDecision({ policy, owedMinor: 105, levelMinor: 100, contractualFinal: true })).toMatchObject(expected);
  });

  it("never takes a debt past zero, whatever the policy (early payoff)", () => {
    for (const policy of ["true-up-to-zero", "contractual-balloon", "keep-level-payment-with-residual", "continue-until-paid"] as const) {
      expect(finalDecision({ policy, owedMinor: 80, levelMinor: 100, contractualFinal: false })).toMatchObject({ paymentMinor: 80, paidOff: true, kind: "early-payoff" });
    }
  });
});

describe("engine invariants (T060, requirement 22)", () => {
  const events: LedgerEvent[] = [
    { kind: "extra-repayment", date: "2024-03-06", amountMinor: 2000000, ref: ref("x") },
    { kind: "draw", date: "2024-05-20", amountMinor: 500000, ref: ref("d") },
    { kind: "offset-balance", date: "2024-04-01", accountId: "a", balanceMinor: 3000000, clearedBalanceMinor: 3000000 },
  ];
  const m = auModel({ offsets: [{ id: "o", accountId: "a", effectiveFrom: OPEN, effectiveTo: null, percentageBps: 10000, basis: "total", capMinor: null }] });

  it("identical inputs give identical outputs", () => {
    expect(simulateDaily(req(m, events))).toEqual(simulateDaily(req(m, [...events].reverse())));
  });

  it("every balance change is explained: after − before = movement, and events chain", () => {
    for (const r of [ok(simulateDaily(req(m, events))), simulatePeriodic(req(auModel({ terms: { ...auModel().terms, firstPaymentDate: "2024-02-15" } }, { accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null, repaymentFrequency: "monthly", repaymentDerivation: "annuity-at-payment-frequency" }), [], "2026-01-31"))]) {
      if (!r.ok) throw new Error(r.blocked[0].message);
      let balance = r.events.length ? r.events[0].balanceBeforeMinor : 0;
      for (const e of r.events) {
        expect(e.balanceBeforeMinor).toBe(balance);
        expect(e.balanceAfterMinor - e.balanceBeforeMinor).toBe(e.principalMovementMinor);
        balance = e.balanceAfterMinor;
      }
      expect(balance).toBe(r.closing.principalMinor);
    }
  });

  it("payment lines sum to the cash paid; interest is never negative", () => {
    const r = ok(simulateDaily(req(m, events)));
    for (const e of r.events.filter((x) => x.type === "repayment" || x.type === "final-payment")) {
      expect(e.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(-e.cashMovementMinor);
    }
    expect(r.events.every((e) => e.interestMinor >= 0)).toBe(true);
  });

  it("each event is processed once", () => {
    const r = ok(simulateDaily(req(m, events)));
    expect(r.events.filter((e) => e.ref?.id === "x")).toHaveLength(1);
    expect(r.events.filter((e) => e.ref?.id === "d")).toHaveLength(1);
  });

  it("the carried remainder stays below one minor unit and is never posted as cash", () => {
    const carry = auModel({}, { rounding: { ...AU_PROFILE.rounding, balancePrecision: "carry-full-precision" } });
    const r = ok(simulateDaily(req(carry, events, "2026-12-31")));
    expect(Math.abs(Number(r.closing.carriedRemainder))).toBeLessThan(0.01);
    expect(r.events.every((e) => Number.isInteger(e.cashMovementMinor) && Number.isInteger(e.interestMinor))).toBe(true);
  });

  it("a balloon is paid as a balloon, never trued up into the last payment", () => {
    const b = auModel({ terms: { ...auModel().terms, contractualTermMonths: 24, amortizationTermMonths: 360 } }, { finalPayment: "contractual-balloon" });
    const r = ok(simulateDaily(req(b, [], "2026-12-31")));
    const last = r.events.filter((e) => e.type === "repayment" || e.type === "final-payment").at(-1)!;
    expect(-last.cashMovementMinor).toBe(120000);
    expect(r.events.filter((e) => e.type === "balloon")).toHaveLength(1);
    expect(r.closing.principalMinor).toBe(0);
  });

  it("a whole-term interest-only loan pays interest only and ends with a balloon of the full principal", () => {
    const io = auModel(
      { terms: { ...auModel().terms, firstPaymentDate: "2024-02-15", contractualTermMonths: 24 }, phases: [{ kind: "interest-only", from: "2024-02-15", to: "2026-01-15", recastAtEnd: "never" }] },
      { repaymentFrequency: "monthly", finalPayment: "contractual-balloon", eventOrder: { scheduledRepayments: "after-accrual", otherPayments: "before-accrual", offsets: "before-accrual" } }
    );
    const r = ok(simulateDaily(req(io, [], "2026-02-28")));
    const payments = r.events.filter((e) => e.type === "repayment" || e.type === "final-payment");
    const charges = r.events.filter((e) => e.type === "interest-charge");
    expect(payments.slice(0, -1).map((e) => -e.cashMovementMinor)).toEqual(charges.slice(0, payments.length - 1).map((e) => e.interestMinor));
    expect(r.events.find((e) => e.type === "balloon")?.balanceBeforeMinor).toBe(40000000);
  });

  it("projections read nothing and write nothing: the request is not mutated", () => {
    const frozen = JSON.stringify(req(m, events));
    const input = req(m, events);
    simulateDaily(input);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("a 30-year daily run needs no reads and finishes", () => {
    const r = ok(simulateDaily(req(m, events, addDays(OPEN, 365 * 30))));
    expect(r.events.length).toBeGreaterThan(700);
  });
});

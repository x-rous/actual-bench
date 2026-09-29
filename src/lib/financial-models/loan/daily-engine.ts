import { addDays, compareDates, type IsoDate } from "../calendar/dates";
import { generateSchedule } from "../calendar/schedule";
import { add, dec, fromMinor, sub, toDecString, toMinor, DEC_ZERO, type Dec } from "../money/kernel";
import { dayInterest, intermediateScale, interestBase } from "./accrual";
import { chargeDates } from "./charge";
import { eventRoundingScale, postCharge } from "./dailyPrecision";
import { dayCountOf, engineVersions, monthlySummaries, rateTable, validateModel, wholeMonthsBetween } from "./engineCommon";
import { dayStepOrder, normalizeEvents, type EngineEvent } from "./events";
import { cashComponents, feeCapitalizationPermitted } from "./fees";
import { amortizationMonths, contractualEnd, finalDecision } from "./finalPayment";
import type { BlockReason, ModelEvent, ModelEventType, SimulationRequest, SimulationResult } from "./model";
import { eligibleOffset, type OffsetBalances } from "./offsets";
import { interestOnlyPhaseOn } from "./phases";
import { annualRecastDates, applyPaymentCap, derivePayment, paymentCount, paymentEffectiveDate, recastPolicyFor } from "./recast";
import { revolvingPayment, revolvingState } from "./revolving";

/**
 * `bench-daily`: a real-calendar, event-driven simulation (FR-029, FR-047,
 * FR-051).
 *
 * Time is a sequence of calendar days, never payment numbers. Each day runs
 * the versioned same-day order (./events.ts `dayStepOrder`):
 *
 *   contract and rate changes, recasts → external cash (fees) → payments
 *   placed before the accrual → determine the interest base (debt net of
 *   offsets) → accrue → charge when due → payments placed after the accrual
 *
 * State keeps three things apart: the charged debt (principal plus charged
 * interest and capitalized fees, always whole minor units), interest accrued
 * but not yet charged, and the carried sub-minor remainder. Under
 * `daily-simple`, accrued interest earns nothing until it is charged.
 *
 * Events are loaded once and simulated locally: nothing here reads Actual.
 */

export const DAILY_ENGINE_VERSION = "loan-daily@1";

type Day = { date: IsoDate; events: EngineEvent[] };

export function simulateDaily(req: SimulationRequest): SimulationResult {
  const { model, anchor } = req;
  const versions = engineVersions("loan-daily", model);
  const fail = (reason: BlockReason): SimulationResult => ({ ok: false, blocked: [reason], versions });

  const invalid = validateModel(model);
  if (invalid) return fail(invalid);
  const { profile, currency, terms } = model;
  const digits = currency.minorDigits;
  if (profile.accrual === "per-period") {
    return fail({ code: "unsupported-profile", classification: "blocked", date: null, message: "bench-daily needs daily accrual; per-period loans use bench-periodic." });
  }
  const dc = dayCountOf(model);
  const firstDay = addDays(anchor.date, 1);
  if (compareDates(req.to, anchor.date) <= 0) return fail({ code: "inconsistent-profile", classification: "blocked", date: req.to, message: "The simulation must end after its anchor." });

  const normalized = normalizeEvents(req.events, req.options?.applyAssumptions === false ? [] : model.assumptions, { after: anchor.date, to: req.to }, profile.eventOrder);
  if (!normalized.ok) return fail({ code: "negative-repayment", classification: "blocked", date: normalized.date, message: normalized.message });

  const rates = rateTable(model.rates);
  const generate = req.options?.generateScheduledRepayments !== false;
  const end = contractualEnd(model);
  const amortMonths = amortizationMonths(model);

  // ── Scheduled repayment dates (real dates) ────────────────────────────────
  let scheduled: IsoDate[] = [];
  if (generate) {
    if (!terms.firstPaymentDate) return fail({ code: "missing-payment", classification: "blocked", date: null, message: "Scheduled repayments need a first payment date." });
    if (profile.repaymentFrequency === "custom-dated" || profile.repaymentFrequency === "semi-monthly") {
      return fail({ code: "unsupported-profile", classification: "blocked", date: null, message: `Generating ${profile.repaymentFrequency} repayments needs dates configuration version 1 cannot hold; supply them as events.` });
    }
    // Generated through the later of the run's end and the contract's, so the contract's last
    // payment is known even when the run stops earlier.
    const horizon = end && compareDates(end, req.to) > 0 ? end : req.to;
    scheduled = generateSchedule({ frequency: profile.repaymentFrequency, firstDate: terms.firstPaymentDate, shortMonthPolicy: profile.shortMonth }, { from: terms.firstPaymentDate, to: horizon });
  }
  const lastContractual = end && model.behaviorClass !== "revolving-credit" ? [...scheduled].reverse().find((d) => compareDates(d, end) <= 0) ?? null : null;
  scheduled = scheduled.filter((d) => compareDates(d, req.to) <= 0);
  const scheduledSet = new Set(scheduled.filter((d) => compareDates(d, anchor.date) > 0));
  const madeBeforeAnchor = scheduled.filter((d) => compareDates(d, anchor.date) <= 0).length;
  const totalPayments = amortMonths !== null ? paymentCount(profile.repaymentFrequency, amortMonths) : null;

  const charges = chargeDates(model, firstDay, req.to);
  const chargeSet = charges ? new Set(charges) : null;

  // ── Recast triggers ───────────────────────────────────────────────────────
  const recasts = new Map<IsoDate, string>();
  for (const period of rates.changes.slice(1)) {
    const date = paymentEffectiveDate(period);
    const policy = recastPolicyFor(period, profile);
    if (policy === "on-rate-change" && compareDates(date, anchor.date) > 0) recasts.set(date, "rate-change");
  }
  if (profile.recast === "annual" && terms.firstPaymentDate) for (const d of annualRecastDates(terms.firstPaymentDate, anchor.date, req.to)) recasts.set(d, "annual");
  for (const phase of model.phases) {
    const after = addDays(phase.to, 1);
    if (compareDates(after, anchor.date) > 0) recasts.set(after, "interest-only-phase-end");
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let debt: Dec = fromMinor(anchor.principalMinor, digits);
  let accrued: Dec = anchor.accruedInterestExact ? dec(anchor.accruedInterestExact) : fromMinor(anchor.accruedInterestMinor ?? 0, digits);
  let carry: Dec = anchor.carriedRemainder ? dec(anchor.carriedRemainder) : DEC_ZERO;
  let payment: number | null = anchor.scheduledPaymentMinor ?? null;
  let paymentsMade = madeBeforeAnchor;
  let paidOff = false;
  let stopScheduling = false;
  let lastChargeMinor = 0;
  const offsetBalances = new Map<string, { balanceMinor: number; clearedBalanceMinor: number }>();
  for (const e of normalized.events) {
    if (e.kind === "offset-balance" && compareDates(e.date, anchor.date) <= 0) offsetBalances.set(e.accountId!, { balanceMinor: e.amountMinor, clearedBalanceMinor: e.clearedBalanceMinor ?? e.amountMinor });
  }
  let periodRate: Dec | null = rates.rateOn(firstDay);
  const events: ModelEvent[] = [];
  const components = cashComponents(model.components);
  const scale = eventRoundingScale(profile, digits) ?? intermediateScale(profile, digits);
  const order = dayStepOrder(profile.eventOrder);
  const minor = (d: Dec) => toMinor(d, digits, "down");
  const revolving = model.behaviorClass === "revolving-credit" && model.revolving !== null;

  const emit = (e: Omit<ModelEvent, "diagnostics"> & { diagnostics?: ModelEvent["diagnostics"] }) => events.push({ diagnostics: {}, ...e });

  const remainingPayments = () => (totalPayments === null ? 0 : Math.max(totalPayments - paymentsMade, 1));
  const remainingMonths = (date: IsoDate) => (amortMonths === null ? 0 : Math.max(amortMonths - wholeMonthsBetween(terms.openingDate, date), 1));

  function derive(date: IsoDate, reason: string): BlockReason | null {
    const rate = rates.rateOn(date);
    if (!rate) return { code: "rate-gap", classification: "blocked", date, message: `No rate applies on ${date}.` };
    const previous = payment;
    const derived = derivePayment({ model, balanceMinor: minor(debt), annualRate: rate, remainingPayments: remainingPayments(), remainingMonths: remainingMonths(date), currentPaymentMinor: payment });
    if (!derived.ok) return { code: "missing-payment", classification: "blocked", date, message: derived.reason };
    const cap = reason === "rate-change" ? rates.changes.find((p) => paymentEffectiveDate(p) === date)?.paymentCap : null;
    const capped = applyPaymentCap(derived.minor, previous, cap, profile, digits);
    payment = capped.minor;
    if (previous !== null) {
      emit({
        date, type: "recast", certainty: "contractual", ref: null, cashMovementMinor: 0, principalMovementMinor: 0, interestMinor: 0, feesMinor: 0,
        balanceBeforeMinor: minor(debt), balanceAfterMinor: minor(debt), lines: [],
        diagnostics: { reason, previousPaymentMinor: previous, recalculatedPaymentMinor: capped.uncappedMinor, paymentMinor: capped.minor, capped: capped.capped, capMaxMinor: capped.capMaxMinor, annualRate: toDecString(rate), remainingPayments: remainingPayments() },
      });
    }
    return null;
  }

  /**
   * Charge everything accrued (at a charge date, with a repayment, or at
   * payoff). A standalone charge is its own event; one taken with a payment
   * is folded into that payment's event, so interest appears exactly once.
   */
  function charge(date: IsoDate, why: string, standalone: boolean): number {
    const posted = postCharge(accrued, carry, profile, digits);
    const before = minor(debt);
    debt = add(debt, fromMinor(posted.chargedMinor, digits));
    const accruedExact = toDecString(accrued);
    accrued = DEC_ZERO;
    carry = posted.carry;
    if (standalone) {
      emit({
        date, type: "interest-charge", certainty: "modelled", ref: null, cashMovementMinor: 0, principalMovementMinor: posted.chargedMinor, interestMinor: posted.chargedMinor, feesMinor: 0,
        balanceBeforeMinor: before, balanceAfterMinor: minor(debt), lines: [{ kind: "interest", amountMinor: posted.chargedMinor }],
        diagnostics: { reason: why, accruedExact, carriedRemainder: toDecString(posted.carry), droppedRemainder: toDecString(posted.dropped) },
      });
    }
    // Under `from-next-charge-period`, a new rate starts with the next charge period.
    periodRate = rates.rateOn(addDays(date, 1));
    lastChargeMinor = posted.chargedMinor;
    return posted.chargedMinor;
  }

  function scheduledRepayment(date: IsoDate): BlockReason | null {
    if (stopScheduling || paidOff) return null;
    const atRepaymentCharge = chargeSet === null;
    let interestWithPayment = 0;
    const balanceBeforeAll = minor(debt);
    if (revolving) return revolvingRepayment(date, balanceBeforeAll, atRepaymentCharge);
    const phase = interestOnlyPhaseOn(model.phases, date);
    // The level payment is derived on the balance before this payment's own interest is charged.
    if (!phase && payment === null) {
      const problem = derive(date, "initial");
      if (problem) return problem;
    }
    if (atRepaymentCharge) interestWithPayment = charge(date, "with-repayment", false);
    let level: number;
    if (phase) {
      // An interest-only payment pays the interest charged for its period. With a separate charge
      // cadence that is only well defined when the payment falls on the charge date, after the charge.
      const afterCharge = order.indexOf("scheduled-repayment") > order.indexOf("charge");
      if (!atRepaymentCharge && !(chargeSet?.has(date) && afterCharge)) {
        return { code: "unsupported-profile", classification: "blocked", date, message: "Interest-only repayments need interest charged with each repayment, or repayments on the charge date placed after the accrual." };
      }
      level = atRepaymentCharge ? interestWithPayment : lastChargeMinor;
    } else {
      level = payment!;
    }
    const cash = components.reduce((s, c) => s + c.amountMinor, 0);
    const contractualFinal = lastContractual !== null && date === lastContractual;
    // A payoff or true-up clears interest accrued since the last charge too.
    let owed = minor(debt);
    if (!atRepaymentCharge && (level >= owed || contractualFinal)) {
      interestWithPayment += charge(date, "payoff", false);
      owed = minor(debt);
    }
    if (atRepaymentCharge && level < interestWithPayment && !phase) {
      if (!profile.negativeAmortizationAllowed) {
        return { code: "negative-amortization", classification: "review", date, message: `The payment ${level} does not cover the interest ${interestWithPayment} and the profile does not permit negative amortization.` };
      }
    }
    const decision = finalDecision({ policy: profile.finalPayment, owedMinor: owed, levelMinor: level, contractualFinal });
    debt = sub(debt, fromMinor(decision.paymentMinor, digits));
    const interestPart = Math.min(interestWithPayment, decision.paymentMinor);
    const type: ModelEventType = decision.kind === "regular" || decision.kind === "continue" ? "repayment" : "final-payment";
    emit({
      date, type, certainty: "scheduled", ref: null,
      cashMovementMinor: -(decision.paymentMinor + cash),
      principalMovementMinor: minor(debt) - balanceBeforeAll,
      interestMinor: interestWithPayment, feesMinor: cash,
      balanceBeforeMinor: balanceBeforeAll, balanceAfterMinor: minor(debt),
      lines: [
        ...(decision.paymentMinor - interestPart > 0 ? [{ kind: "principal" as const, amountMinor: decision.paymentMinor - interestPart }] : []),
        ...(interestPart > 0 ? [{ kind: "interest" as const, amountMinor: interestPart }] : []),
        ...components.map((c) => ({ kind: c.kind, amountMinor: c.amountMinor })),
      ],
      diagnostics: {
        decision: decision.kind, interestOnly: phase !== null, levelPaymentMinor: level,
        negativeAmortizationMinor: interestWithPayment > decision.paymentMinor ? interestWithPayment - decision.paymentMinor : 0,
      },
    });
    if (interestWithPayment > decision.paymentMinor) {
      emit({ date, type: "negative-amortization", certainty: "modelled", ref: null, cashMovementMinor: 0, principalMovementMinor: 0, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: minor(debt), balanceAfterMinor: minor(debt), lines: [], diagnostics: { unpaidInterestCapitalizedMinor: interestWithPayment - decision.paymentMinor } });
    }
    paymentsMade++;
    if (decision.balloonMinor > 0) {
      const b = minor(debt);
      debt = DEC_ZERO;
      emit({ date, type: "balloon", certainty: "contractual", ref: null, cashMovementMinor: -b, principalMovementMinor: -b, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: b, balanceAfterMinor: 0, lines: [{ kind: "principal", amountMinor: b }], diagnostics: { policy: "contractual-balloon" } });
    }
    if (decision.residualMinor > 0) {
      emit({ date, type: "residual", certainty: "contractual", ref: null, cashMovementMinor: 0, principalMovementMinor: 0, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: minor(debt), balanceAfterMinor: minor(debt), lines: [], diagnostics: { policy: "keep-level-payment-with-residual", residualMinor: decision.residualMinor } });
    }
    if (decision.paidOff) paidOff = true;
    if (!decision.continues) stopScheduling = true;
    return null;
  }

  /** A revolving facility's payment, from its payment model only: no amortization, no final payment. */
  function revolvingRepayment(date: IsoDate, balanceBeforeAll: number, atRepaymentCharge: boolean): BlockReason | null {
    let interestWithPayment = 0;
    if (atRepaymentCharge) interestWithPayment = charge(date, "with-repayment", false);
    const p = revolvingPayment(model.revolving!, { balanceMinor: minor(debt), lastChargeMinor: atRepaymentCharge ? interestWithPayment : lastChargeMinor, contractualPaymentMinor: terms.contractualPaymentMinor, minorDigits: digits, mode: profile.rounding.paymentRounding });
    if (!p.ok) return { code: "unsupported-profile", classification: "blocked", date, message: p.reason };
    if (p.minor === 0 && interestWithPayment === 0) return null;
    debt = sub(debt, fromMinor(p.minor, digits));
    emit({
      date, type: "repayment", certainty: "scheduled", ref: null, cashMovementMinor: -p.minor, principalMovementMinor: minor(debt) - balanceBeforeAll,
      interestMinor: interestWithPayment, feesMinor: 0, balanceBeforeMinor: balanceBeforeAll, balanceAfterMinor: minor(debt),
      lines: [
        ...(p.minor - Math.min(interestWithPayment, p.minor) > 0 ? [{ kind: "principal" as const, amountMinor: p.minor - Math.min(interestWithPayment, p.minor) }] : []),
        ...(Math.min(interestWithPayment, p.minor) > 0 ? [{ kind: "interest" as const, amountMinor: Math.min(interestWithPayment, p.minor) }] : []),
      ],
      diagnostics: { paymentModel: model.revolving!.paymentModel, ...revolvingState(model, minor(debt)) },
    });
    paymentsMade++;
    return null;
  }

  function applyEvent(e: EngineEvent): BlockReason | null {
    const before = minor(debt);
    const base = { date: e.date, certainty: e.certainty === "observed" ? ("observed" as const) : ("assumed" as const), ref: e.ref, interestMinor: 0, feesMinor: 0 };
    switch (e.kind) {
      case "repayment":
      case "extra-repayment": {
        if (e.amountMinor > before) return { code: "credit-balance", classification: "review", date: e.date, message: `A repayment of ${e.amountMinor} exceeds the ${before} owed; the excess needs review.` };
        debt = sub(debt, fromMinor(e.amountMinor, digits));
        emit({ ...base, type: e.kind === "repayment" ? "repayment" : "extra-repayment", cashMovementMinor: -e.amountMinor, principalMovementMinor: -e.amountMinor, balanceBeforeMinor: before, balanceAfterMinor: minor(debt), lines: [{ kind: "principal", amountMinor: e.amountMinor }] });
        if (e.kind === "repayment") paymentsMade++;
        if (minor(debt) === 0) paidOff = true;
        return null;
      }
      case "draw": {
        const limit = model.terms.creditLimitMinor;
        if (limit !== null && before + e.amountMinor > limit) return { code: "credit-limit-exceeded", classification: "review", date: e.date, message: `A draw of ${e.amountMinor} would exceed the ${limit} credit limit.` };
        debt = add(debt, fromMinor(e.amountMinor, digits));
        paidOff = false;
        emit({ ...base, type: "draw", cashMovementMinor: e.amountMinor, principalMovementMinor: e.amountMinor, balanceBeforeMinor: before, balanceAfterMinor: minor(debt), lines: [{ kind: "draw", amountMinor: e.amountMinor }] });
        return null;
      }
      case "fee": {
        if (e.capitalized) {
          if (!feeCapitalizationPermitted(profile)) return { code: "fee-capitalization-not-permitted", classification: "review", date: e.date, message: "A capitalized fee was given but the contract does not permit capitalizing fees." };
          debt = add(debt, fromMinor(e.amountMinor, digits));
          emit({ ...base, type: "fee", feesMinor: e.amountMinor, cashMovementMinor: 0, principalMovementMinor: e.amountMinor, balanceBeforeMinor: before, balanceAfterMinor: minor(debt), lines: [{ kind: "fee", amountMinor: e.amountMinor }], diagnostics: { capitalized: true } });
        } else {
          emit({ ...base, type: "fee", feesMinor: e.amountMinor, cashMovementMinor: -e.amountMinor, principalMovementMinor: 0, balanceBeforeMinor: before, balanceAfterMinor: before, lines: [{ kind: "fee", amountMinor: e.amountMinor }], diagnostics: { capitalized: false } });
        }
        return null;
      }
      case "offset-balance":
        offsetBalances.set(e.accountId!, { balanceMinor: e.amountMinor, clearedBalanceMinor: e.clearedBalanceMinor ?? e.amountMinor });
        return null;
      case "payment-change":
        payment = e.amountMinor;
        return null;
      case "lender-interest-charge":
        // A lender's observed charge is evidence for reconciliation (P1.5), not a model input.
        return null;
    }
  }

  // Group events by day once.
  const byDay = new Map<IsoDate, EngineEvent[]>();
  for (const e of normalized.events) {
    if (compareDates(e.date, anchor.date) <= 0) continue;
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  }

  const openingMinor = minor(debt);
  for (let date = firstDay; compareDates(date, req.to) <= 0; date = addDays(date, 1)) {
    const day: Day = { date, events: byDay.get(date) ?? [] };
    for (const step of order) {
      let problem: BlockReason | null = null;
      switch (step) {
        case "contract-change": {
          if (rates.changes.some((p) => p.accrualEffectiveFrom === date)) {
            const rate = rates.rateOn(date)!;
            emit({ date, type: "rate-change", certainty: "contractual", ref: null, cashMovementMinor: 0, principalMovementMinor: 0, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: minor(debt), balanceAfterMinor: minor(debt), lines: [], diagnostics: { annualRate: toDecString(rate), timing: profile.rateEffectiveTiming } });
          }
          for (const e of day.events.filter((x) => x.kind === "payment-change")) problem ??= applyEvent(e);
          const recast = recasts.get(date);
          if (!problem && recast && !paidOff && payment !== null) problem = derive(date, recast);
          break;
        }
        case "external-cash":
          for (const e of day.events.filter((x) => x.kind === "fee")) problem ??= applyEvent(e);
          break;
        case "payment":
          for (const e of day.events.filter((x) => x.kind === "extra-repayment" || x.kind === "draw" || x.kind === "repayment")) problem ??= applyEvent(e);
          break;
        case "scheduled-repayment":
          if (scheduledSet.has(date)) problem = scheduledRepayment(date);
          break;
        case "offset-change":
          for (const e of day.events.filter((x) => x.kind === "offset-balance")) problem ??= applyEvent(e);
          break;
        case "determine-balance":
          break;
        case "accrue": {
          const rate = profile.rateEffectiveTiming === "from-next-charge-period" ? periodRate : rates.rateOn(date);
          if (!rate) return fail({ code: "rate-gap", classification: "blocked", date, message: `No rate applies on ${date}.` });
          const offset = eligibleOffset(model.offsets, offsetBalances as OffsetBalances, date, digits);
          const baseAmount = interestBase(profile.accrual, debt, offset, accrued);
          accrued = add(accrued, dayInterest(baseAmount, rate, dc, date, scale, profile.rounding.intermediateRounding));
          break;
        }
        case "charge":
          if (chargeSet?.has(date)) charge(date, "charge-date", true);
          break;
        case "close":
          break;
      }
      if (problem) return fail(problem);
    }
  }

  return {
    ok: true,
    events,
    periods: monthlySummaries(events, openingMinor),
    closing: {
      date: req.to,
      principalMinor: minor(debt),
      accruedInterestMinor: toMinor(accrued, digits, "down"),
      accruedInterestExact: toDecString(accrued),
      carriedRemainder: toDecString(carry),
      scheduledPaymentMinor: payment,
      paidOff,
    },
    versions,
  };
}

import { addDays, addMonths, compareDates, type IsoDate } from "../calendar/dates";
import { adjustBusinessDay, adjustSchedule, isActiveConvention } from "../calendar/businessDays";
import { generateSchedule } from "../calendar/schedule";
import { add, dec, decInt, div, fromMinor, max, min, sub, toDecString, toMinor, toPlainString, DEC_ZERO, WORKING_SCALE, type Dec } from "../money/kernel";
import { dayInterest, intermediateScale, interestBase } from "./accrual";
import { chargeDates } from "./charge";
import { eventRoundingScale, postCharge } from "./dailyPrecision";
import { dayCountOf, engineVersions, monthlySummaries, rateTable, validateModel, wholeMonthsBetween } from "./engineCommon";
import { dayStepOrder, EVENT_ORDER_VERSION, EVENT_ORDER_VERSION_V1, EVENT_ORDER_VERSION_V2, isOffsetStateEventKind, normalizeEvents, type EngineEvent } from "./events";
import { capitalizedComponents, cashComponents } from "./fees";
import { amortizationMonths, contractualEnd, finalDecision } from "./finalPayment";
import type { BlockReason, ModelEvent, ModelEventType, SimulationRequest, SimulationResult } from "./model";
import { applyOffsetTransitions, eligibleOffset, fundScheduledRepayment, OFFSETS_VERSION, OFFSETS_VERSION_V1, OFFSETS_VERSION_V2, OFFSETS_VERSION_V3, offsetFundingConflict, offsetStatePoints, totalOffsetBalanceMinor, type OffsetBalances } from "./offsets";
import { interestOnlyPhaseOn } from "./phases";
import { annualRecastDates, applyPaymentCap, derivePayment, derivePaymentV1, paymentCount, paymentEffectiveDate, recastPolicyFor } from "./recast";
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

export const DAILY_ENGINE_VERSION_V2 = "loan-daily@2";
export const DAILY_ENGINE_VERSION_V3 = "loan-daily@3";
export const DAILY_ENGINE_VERSION_V4 = "loan-daily@4";
export const DAILY_ENGINE_VERSION_V5 = "loan-daily@5";
export const DAILY_ENGINE_VERSION_V6 = "loan-daily@6";
export const DAILY_ENGINE_VERSION = "loan-daily@7";

type Day = { date: IsoDate; events: EngineEvent[] };

type DailyEngineBehavior = {
  engineVersion: "loan-daily@2" | "loan-daily@3" | "loan-daily@4" | "loan-daily@5" | "loan-daily@6" | "loan-daily@7";
  repaymentVersion: "repayment@1" | "repayment@2";
  recastVersion: "recast@1" | "recast@2";
  eventOrderVersion: "event-order@1" | "event-order@2" | "event-order@3";
  offsetsVersion: "offsets@1" | "offsets@2" | "offsets@3" | "offsets@4";
  datedCashflow: boolean;
  capAssumedExtras: boolean;
  completePayoffState: boolean;
  contractualTermCountsPayments: boolean;
  offsetDeltas: boolean;
  offsetFunding: boolean;
  offsetFundingStart: boolean;
};

const DAILY_V2: DailyEngineBehavior = {
  engineVersion: "loan-daily@2",
  repaymentVersion: "repayment@1",
  recastVersion: "recast@1",
  eventOrderVersion: EVENT_ORDER_VERSION_V1,
  offsetsVersion: OFFSETS_VERSION_V1,
  datedCashflow: false,
  capAssumedExtras: false,
  completePayoffState: false,
  contractualTermCountsPayments: false,
  offsetDeltas: false,
  offsetFunding: false,
  offsetFundingStart: false,
};

const DAILY_V3: DailyEngineBehavior = {
  ...DAILY_V2,
  engineVersion: "loan-daily@3",
  repaymentVersion: "repayment@2",
  recastVersion: "recast@2",
  datedCashflow: true,
  capAssumedExtras: true,
  completePayoffState: true,
  contractualTermCountsPayments: false,
};

const DAILY_V4: DailyEngineBehavior = {
  ...DAILY_V3,
  engineVersion: DAILY_ENGINE_VERSION_V4,
  contractualTermCountsPayments: true,
};

const DAILY_V5: DailyEngineBehavior = {
  ...DAILY_V4,
  engineVersion: DAILY_ENGINE_VERSION_V5,
  eventOrderVersion: EVENT_ORDER_VERSION_V2,
  offsetsVersion: OFFSETS_VERSION_V2,
  offsetDeltas: true,
};

const DAILY_V6: DailyEngineBehavior = {
  ...DAILY_V5,
  engineVersion: DAILY_ENGINE_VERSION_V6,
  eventOrderVersion: EVENT_ORDER_VERSION,
  offsetsVersion: OFFSETS_VERSION_V3,
  offsetFunding: true,
};

const DAILY_V7: DailyEngineBehavior = {
  ...DAILY_V6,
  engineVersion: DAILY_ENGINE_VERSION,
  offsetsVersion: OFFSETS_VERSION,
  offsetFundingStart: true,
};

export function simulateDaily(req: SimulationRequest): SimulationResult {
  return simulateDailyImpl(req, DAILY_V7);
}

/** Historical loan-daily@2, kept callable for stored-result reproduction. */
export function simulateDailyV2(req: SimulationRequest): SimulationResult {
  return simulateDailyImpl(req, DAILY_V2);
}

/** Historical loan-daily@3, before contractual terms counted from the first due date. */
export function simulateDailyV3(req: SimulationRequest): SimulationResult {
  return simulateDailyImpl(req, DAILY_V3);
}

/** Historical loan-daily@4, before explicit offset deltas and projection state points. */
export function simulateDailyV4(req: SimulationRequest): SimulationResult {
  return simulateDailyImpl(req, DAILY_V4);
}

/** Historical loan-daily@5, before scheduled repayments could draw from offset cash. */
export function simulateDailyV5(req: SimulationRequest): SimulationResult {
  return simulateDailyImpl(req, DAILY_V5);
}

/** Historical loan-daily@6, before an offset funding source could start independently. */
export function simulateDailyV6(req: SimulationRequest): SimulationResult {
  return simulateDailyImpl(req, DAILY_V6);
}

/** Resolve an exact daily-engine version; unknown versions never fall forward. */
export function simulateDailyAtVersion(version: string, req: SimulationRequest): SimulationResult {
  if (version === DAILY_ENGINE_VERSION_V2) return simulateDailyV2(req);
  if (version === DAILY_ENGINE_VERSION_V3) return simulateDailyV3(req);
  if (version === DAILY_ENGINE_VERSION_V4) return simulateDailyV4(req);
  if (version === DAILY_ENGINE_VERSION_V5) return simulateDailyV5(req);
  if (version === DAILY_ENGINE_VERSION_V6) return simulateDailyV6(req);
  if (version === DAILY_ENGINE_VERSION) return simulateDaily(req);
  throw new RangeError(`Unsupported daily engine version: ${version}`);
}

function simulateDailyImpl(req: SimulationRequest, behavior: DailyEngineBehavior): SimulationResult {
  const { model, anchor } = req;
  const versions = engineVersions("loan-daily", model, {
    engine: behavior.engineVersion,
    repayment: behavior.repaymentVersion,
    recast: behavior.recastVersion,
    eventOrder: behavior.eventOrderVersion,
    offsets: behavior.offsetDeltas ? behavior.offsetsVersion : null,
  });
  const fail = (reason: BlockReason): SimulationResult => ({ ok: false, blocked: [reason], versions });

  const invalid = validateModel(model);
  if (invalid) return fail(invalid);
  const { profile, currency, terms } = model;
  const digits = currency.minorDigits;
  if (profile.accrual === "per-period") {
    return fail({ code: "unsupported-profile", classification: "blocked", date: null, message: "bench-daily needs daily accrual; per-period loans use bench-periodic." });
  }
  const hasOffsetFunding = model.offsets.some((link) => link.fundScheduledRepayments === true);
  const hasOffsetFundingStart = model.offsets.some((link) => link.fundScheduledRepaymentsFrom !== null && link.fundScheduledRepaymentsFrom !== undefined);
  if (hasOffsetFundingStart && !behavior.offsetFundingStart) {
    return fail({ code: "unsupported-profile", classification: "blocked", date: null, message: `${behavior.engineVersion} does not support an offset repayment-funding start date.` });
  }
  if (hasOffsetFunding && !behavior.offsetFunding) {
    return fail({ code: "unsupported-profile", classification: "blocked", date: null, message: `${behavior.engineVersion} does not support offset-funded scheduled repayments.` });
  }
  if (hasOffsetFunding && model.behaviorClass !== "term-loan") {
    return fail({ code: "unsupported-profile", classification: "blocked", date: null, message: "Offset-funded scheduled repayments are supported only for daily-accrual term loans." });
  }
  const fundingConflict = behavior.offsetFunding ? offsetFundingConflict(model.offsets) : null;
  if (fundingConflict) {
    return fail({
      code: "conflicting-offset-funding-source",
      classification: "blocked",
      date: fundingConflict.date,
      message: "Offset funding-source effective dates overlap; only one source may be active on a date.",
      diagnostics: { firstFundingLinkId: fundingConflict.firstId, secondFundingLinkId: fundingConflict.secondId },
    });
  }
  const dc = dayCountOf(model);
  const firstDay = addDays(anchor.date, 1);
  if (compareDates(req.to, anchor.date) <= 0) return fail({ code: "inconsistent-profile", classification: "blocked", date: req.to, message: "The simulation must end after its anchor." });

  const assumptions = req.options?.applyAssumptions === false ? [] : model.assumptions;
  if (!behavior.offsetDeltas && [...req.events, ...assumptions].some((event) => event.kind === "offset-deposit" || event.kind === "offset-withdrawal")) {
    return fail({ code: "unsupported-profile", classification: "blocked", date: null, message: `${behavior.engineVersion} does not support offset deposits or withdrawals.` });
  }
  const normalized = normalizeEvents(req.events, assumptions, { after: anchor.date, to: req.to }, profile.eventOrder);
  if (!normalized.ok) return fail({ code: "negative-repayment", classification: "blocked", date: normalized.date, message: normalized.message });

  const rates = rateTable(model.rates);
  const generate = req.options?.generateScheduledRepayments !== false;
  const end = contractualEnd(model);
  const amortMonths = amortizationMonths(model);

  // ── Scheduled repayment dates (real dates) ────────────────────────────────
  let allScheduled: IsoDate[] = [];
  let derivationSchedule: IsoDate[] = [];
  if (generate) {
    if (!terms.firstPaymentDate) return fail({ code: "missing-payment", classification: "blocked", date: null, message: "Scheduled repayments need a first payment date." });
    if (profile.repaymentFrequency === "custom-dated" || profile.repaymentFrequency === "semi-monthly") {
      return fail({ code: "unsupported-profile", classification: "blocked", date: null, message: `Generating ${profile.repaymentFrequency} repayments needs dates configuration version 1 cannot hold; supply them as events.` });
    }
    // Generate the whole amortization basis even when this projection ends earlier. Dated payment
    // derivation needs every remaining cash-flow date, not only dates visible in this run.
    const amortizationHorizon = amortMonths ? addMonths(terms.firstPaymentDate, amortMonths + 12) : req.to;
    const horizon = [req.to, end, amortizationHorizon]
      .filter((d): d is IsoDate => d !== null)
      .reduce((latest, d) => compareDates(d, latest) > 0 ? d : latest, req.to);
    allScheduled = generateSchedule({ frequency: profile.repaymentFrequency, firstDate: terms.firstPaymentDate, shortMonthPolicy: profile.shortMonth }, { from: terms.firstPaymentDate, to: horizon });
    const count = amortMonths !== null ? paymentCount(profile.repaymentFrequency, amortMonths) : null;
    derivationSchedule = count === null ? allScheduled : allScheduled.slice(0, count);
  }
  const contractualPayments = terms.contractualTermMonths !== null
    ? paymentCount(profile.repaymentFrequency, terms.contractualTermMonths)
    : null;
  const termHasUnambiguousPeriodCount = profile.repaymentFrequency === "monthly"
    || profile.repaymentFrequency === "quarterly"
    || profile.repaymentFrequency === "annual";
  const lastContractualUnadjusted = model.behaviorClass === "revolving-credit"
    ? null
    : behavior.contractualTermCountsPayments && termHasUnambiguousPeriodCount && terms.maturityDate === null && contractualPayments !== null
      ? allScheduled[contractualPayments - 1] ?? null
      : end
        ? [...allScheduled].reverse().find((d) => compareDates(d, end) <= 0) ?? null
        : null;
  // Business-day adjustment (config v3) moves each contractual date; the payment count and the
  // contractual final payment are decided on the contractual dates first, so a maturity date that
  // rolls past the end date still carries the final payment.
  let lastContractual = lastContractualUnadjusted;
  if (isActiveConvention(model.businessDays)) {
    const holidays = new Set(model.businessDays.holidays);
    const adjust = (d: IsoDate) => adjustBusinessDay(d, model.businessDays!, holidays);
    allScheduled = adjustSchedule(allScheduled, model.businessDays);
    derivationSchedule = adjustSchedule(derivationSchedule, model.businessDays);
    lastContractual = lastContractualUnadjusted === null ? null : adjust(lastContractualUnadjusted);
  }
  const scheduled = allScheduled.filter((d) => compareDates(d, req.to) <= 0);
  const scheduledSet = new Set(scheduled.filter((d) => compareDates(d, anchor.date) > 0));
  const madeBeforeAnchor = allScheduled.filter((d) => compareDates(d, anchor.date) <= 0).length;
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
  // Dated contractual recasts apply on their own date, whatever the rate changes do.
  for (const r of model.paymentRecasts) if (compareDates(r.date, anchor.date) > 0) recasts.set(r.date, "contract-date");

  // ── State ─────────────────────────────────────────────────────────────────
  let debt: Dec = fromMinor(anchor.principalMinor, digits);
  let accrued: Dec = anchor.accruedInterestExact ? dec(anchor.accruedInterestExact) : fromMinor(anchor.accruedInterestMinor ?? 0, digits);
  let carry: Dec = anchor.carriedRemainder ? dec(anchor.carriedRemainder) : DEC_ZERO;
  let payment: number | null = anchor.scheduledPaymentMinor ?? null;
  let paymentsMade = madeBeforeAnchor;
  let paidOff = false;
  let stopScheduling = false;
  let lastChargeMinor = 0;
  /** Interest charged since the last scheduled repayment (what an interest-only repayment owes). */
  let chargedSinceRepayment = 0;
  let currentStep = "";
  const offsetBalances = new Map<string, { balanceMinor: number; clearedBalanceMinor: number }>();
  const offsetStates = [] as NonNullable<Extract<SimulationResult, { ok: true }>["offsetStates"]>;
  if (behavior.offsetDeltas) {
    const preAnchorOffsetDays = new Map<IsoDate, EngineEvent[]>();
    for (const event of normalized.events) {
      if (!isOffsetStateEventKind(event.kind) || compareDates(event.date, anchor.date) > 0) continue;
      preAnchorOffsetDays.set(event.date, [...(preAnchorOffsetDays.get(event.date) ?? []), event]);
    }
    for (const link of model.offsets) {
      for (const date of [link.effectiveFrom, link.effectiveTo]) {
        if (date !== null && compareDates(date, anchor.date) <= 0 && !preAnchorOffsetDays.has(date)) preAnchorOffsetDays.set(date, []);
      }
    }
    for (const [date, dayEvents] of [...preAnchorOffsetDays].sort(([a], [b]) => compareDates(a, b))) {
      const transition = applyOffsetTransitions(date, dayEvents, offsetBalances, model.offsets);
      if (!transition.ok) return fail(transition.reason);
      const boundaryAccounts = model.offsets.filter((link) => link.effectiveFrom === date || link.effectiveTo === date).map((link) => link.accountId);
      offsetStates.push(...offsetStatePoints(date, [...transition.points.map((point) => point.accountId), ...boundaryAccounts], offsetBalances, model.offsets));
    }
    if (model.offsets.length && offsetStates.at(-1)?.date !== anchor.date) {
      offsetStates.push(...offsetStatePoints(anchor.date, model.offsets.map((link) => link.accountId), offsetBalances, model.offsets));
    }
  } else {
    for (const event of normalized.events) {
      if (event.kind === "offset-balance" && compareDates(event.date, anchor.date) <= 0) {
        offsetBalances.set(event.accountId!, { balanceMinor: event.amountMinor, clearedBalanceMinor: event.clearedBalanceMinor ?? event.amountMinor });
      }
    }
  }
  let periodRate: Dec | null = rates.rateOn(firstDay);
  const events: ModelEvent[] = [];
  const components = cashComponents(model.components);
  const capitalized = capitalizedComponents(model.components);
  const scale = eventRoundingScale(profile, digits) ?? intermediateScale(profile, digits);
  const order = dayStepOrder(profile.eventOrder);
  const scheduledAfterAccrual = order.indexOf("scheduled-repayment") > order.indexOf("accrue");
  const minor = (d: Dec) => toMinor(d, digits, "down");
  const revolving = model.behaviorClass === "revolving-credit" && model.revolving !== null;

  // Every event records the same-day step it ran in, under the versioned order.
  const emit = (e: Omit<ModelEvent, "diagnostics"> & { diagnostics?: ModelEvent["diagnostics"] }) =>
    events.push({ ...e, diagnostics: { sameDayStep: currentStep, eventOrder: behavior.eventOrderVersion, ...e.diagnostics } });

  const remainingPayments = () => (totalPayments === null ? 0 : Math.max(totalPayments - paymentsMade, 1));
  const remainingMonths = (date: IsoDate) => (amortMonths === null ? 0 : Math.max(amortMonths - wholeMonthsBetween(terms.openingDate, date), 1));

  function datedAccrualFractions(date: IsoDate): { ok: true; fractions: Dec[] } | { ok: false; date: IsoDate } {
    const remainingDates = derivationSchedule.filter((d) => compareDates(d, date) >= 0);
    if (remainingDates.length === 0) return { ok: true, fractions: [] };
    const fractions: Dec[] = [];
    let previousPayment: IsoDate | null = null;
    for (let i = 0; i < remainingDates.length; i++) {
      const paymentDate = remainingDates[i];
      const firstAccrualDate = previousPayment === null
        ? date
        : scheduledAfterAccrual ? addDays(previousPayment, 1) : previousPayment;
      const lastAccrualDate = scheduledAfterAccrual ? paymentDate : addDays(paymentDate, -1);
      let fraction = DEC_ZERO;
      const lockedRate = profile.rateEffectiveTiming === "from-next-charge-period"
        ? (previousPayment === null ? periodRate : rates.rateOn(firstAccrualDate))
        : null;
      for (let day = firstAccrualDate; compareDates(day, lastAccrualDate) <= 0; day = addDays(day, 1)) {
        const rate = lockedRate ?? rates.rateOn(day);
        if (!rate) return { ok: false, date: day };
        fraction = add(fraction, div(rate, decInt(dc.dailyDenominator(day)), WORKING_SCALE + 10, "half-even"));
      }
      fractions.push(fraction);
      previousPayment = paymentDate;
    }
    return { ok: true, fractions };
  }

  function derive(date: IsoDate, reason: string): BlockReason | null {
    const rate = rates.rateOn(date);
    if (!rate) return { code: "rate-gap", classification: "blocked", date, message: `No rate applies on ${date}.` };
    const previous = payment;
    let datedFractions: readonly Dec[] | undefined;
    if (profile.repaymentDerivation === "dated-cashflow-annuity") {
      if (!behavior.datedCashflow) return { code: "unsupported-profile", classification: "blocked", date, message: `${behavior.repaymentVersion} does not support dated-cashflow-annuity.` };
      if (model.offsets.length > 0 || model.phases.length > 0) {
        return { code: "unsupported-profile", classification: "blocked", date, message: "Dated cash-flow annuity derivation does not approximate offsets or interest-only phases." };
      }
      const dated = datedAccrualFractions(date);
      if (!dated.ok) return { code: "rate-gap", classification: "blocked", date: dated.date, message: `No rate applies on ${dated.date}.` };
      datedFractions = dated.fractions;
    }
    const deriveForVersion = behavior.recastVersion === "recast@1" ? derivePaymentV1 : derivePayment;
    const derived = deriveForVersion({
      model,
      balanceMinor: minor(debt),
      annualRate: rate,
      remainingPayments: remainingPayments(),
      remainingMonths: remainingMonths(date),
      currentPaymentMinor: payment,
      datedAccrualFractions: datedFractions,
      openingAccrued: add(accrued, carry),
    });
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

  // A dated annuity is derived from the anchor's closing state before any projection-day accrual
  // or posting occurs. That keeps payment derivation separate from the engine's intermediate and
  // posting rounding; the ordinary engine then produces every scheduled row from the rounded level.
  if (payment === null && profile.repaymentDerivation === "dated-cashflow-annuity") {
    const problem = derive(firstDay, "initial");
    if (problem) return fail(problem);
  }

  /**
   * Charge everything accrued (at a charge date, with a repayment, or at
   * payoff). A standalone charge is its own event; one taken with a payment
   * is folded into that payment's event, so interest appears exactly once.
   */
  /**
   * Distinct annual rates the accrual used since the last charge, in order (O2): the rates behind a
   * charge. Reported as `interestRatesDecimal`, exact decimals joined by ";" (diagnostics are scalar).
   */
  let ratesSinceCharge: string[] = [];
  /** Rates behind the interest folded into the current repayment. */
  let repaymentRates: string[] = [];
  const noteRate = (list: string[], rate: string) => (list.at(-1) === rate ? list : [...list, rate]);

  function charge(date: IsoDate, why: string, standalone: boolean): number {
    const chargedRates = ratesSinceCharge;
    ratesSinceCharge = [];
    if (!standalone) for (const r of chargedRates) repaymentRates = noteRate(repaymentRates, r);
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
        diagnostics: { reason: why, accruedExact, carriedRemainder: toDecString(posted.carry), droppedRemainder: toDecString(posted.dropped), interestRatesDecimal: chargedRates.join(";") },
      });
    }
    // Under `from-next-charge-period`, a new rate starts with the next charge period.
    periodRate = rates.rateOn(addDays(date, 1));
    lastChargeMinor = posted.chargedMinor;
    if (standalone) chargedSinceRepayment += posted.chargedMinor;
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
    repaymentRates = [];
    if (atRepaymentCharge) interestWithPayment = charge(date, "with-repayment", false);
    let level: number;
    let ioCharged = 0;
    if (phase) {
      // An interest-only repayment pays interest, sized from the charged state by the profile's
      // `interestOnlyRepayment` convention; the repayment cadence need not match the charges.
      if (atRepaymentCharge) {
        level = interestWithPayment;
      } else {
        ioCharged = chargedSinceRepayment;
        level = ioCharged;
      }
      if (level === 0) {
        // Nothing is owed yet (no interest charged since the last repayment).
        paymentsMade++;
        chargedSinceRepayment = 0;
        return null;
      }
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
    const totalCashPaymentMinor = decision.paymentMinor + cash;
    const funding = behavior.offsetFunding
      ? fundScheduledRepayment(date, decision.paymentMinor, offsetBalances, model.offsets)
      : { ok: true as const, configured: false, accountId: null, offsetFundedMinor: 0, points: [] };
    if (!funding.ok) return funding.reason;
    offsetStates.push(...funding.points);
    debt = sub(debt, fromMinor(decision.paymentMinor, digits));
    const interestPart = Math.min(interestWithPayment, decision.paymentMinor);
    const type: ModelEventType = decision.kind === "regular" || decision.kind === "continue" ? "repayment" : "final-payment";
    emit({
      date, type, certainty: "scheduled", ref: null,
      cashMovementMinor: -totalCashPaymentMinor,
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
        ...(interestWithPayment > 0 ? { interestRatesDecimal: repaymentRates.join(";") } : {}),
        ...(phase ? { interestOnlyBasis: atRepaymentCharge ? "charged-with-repayment" : profile.interestOnlyRepayment, chargedInterestPaidMinor: atRepaymentCharge ? interestWithPayment : ioCharged } : {}),
        negativeAmortizationMinor: interestWithPayment > decision.paymentMinor ? interestWithPayment - decision.paymentMinor : 0,
        ...(behavior.completePayoffState && decision.paidOff && carry.int !== BigInt(0)
          ? { settledCarriedRemainder: toDecString(carry) }
          : {}),
        ...(funding.configured
          ? {
              repaymentFundingMode: "simulated-offset",
              repaymentFundingAccountId: funding.accountId,
              scheduledDebtPaymentMinor: decision.paymentMinor,
              additionalCashPaidMinor: cash,
              totalCashPaymentMinor,
              offsetFundedMinor: funding.offsetFundedMinor,
              otherFundsMinor: totalCashPaymentMinor - funding.offsetFundedMinor,
            }
          : {}),
      },
    });
    chargedSinceRepayment = 0;
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
    if (decision.paidOff) {
      paidOff = true;
      if (behavior.completePayoffState) carry = DEC_ZERO;
    }
    if (!decision.continues) stopScheduling = true;
    return null;
  }

  /** A revolving facility's payment, from its payment model only: no amortization, no final payment. */
  function revolvingRepayment(date: IsoDate, balanceBeforeAll: number, atRepaymentCharge: boolean): BlockReason | null {
    let interestWithPayment = 0;
    repaymentRates = [];
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
      diagnostics: { paymentModel: model.revolving!.paymentModel, ...revolvingState(model, minor(debt)), ...(interestWithPayment > 0 ? { interestRatesDecimal: repaymentRates.join(";") } : {}) },
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
        const capAssumed = behavior.capAssumedExtras && e.kind === "extra-repayment" && e.certainty === "assumed" && !revolving;
        if (!capAssumed && e.amountMinor > before) return { code: "credit-balance", classification: "review", date: e.date, message: `A repayment of ${e.amountMinor} exceeds the ${before} owed; the excess needs review.`, diagnostics: { requestedAmountMinor: e.amountMinor, owedMinor: before } };
        const applied = capAssumed ? Math.min(e.amountMinor, before) : e.amountMinor;
        if (applied === 0) return null;
        debt = sub(debt, fromMinor(applied, digits));
        emit({
          ...base,
          type: e.kind === "repayment" ? "repayment" : "extra-repayment",
          cashMovementMinor: -applied,
          principalMovementMinor: -applied,
          balanceBeforeMinor: before,
          balanceAfterMinor: minor(debt),
          lines: [{ kind: "principal", amountMinor: applied }],
          ...(applied < e.amountMinor ? { diagnostics: { requestedAmountMinor: e.amountMinor, appliedAmountMinor: applied, cappedAtOutstanding: true } } : {}),
        });
        if (e.kind === "repayment") paymentsMade++;
        if (minor(debt) === 0) {
          paidOff = behavior.completePayoffState
            ? accrued.int === BigInt(0) && carry.int === BigInt(0)
            : true;
          if (paidOff) stopScheduling = true;
        }
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
        // The fee's own treatment decides: capitalized adds to the debt with no cash; cash-paid moves cash only.
        if (e.capitalized) {
          debt = add(debt, fromMinor(e.amountMinor, digits));
          paidOff = false;
          emit({ ...base, type: "fee", feesMinor: e.amountMinor, cashMovementMinor: 0, principalMovementMinor: e.amountMinor, balanceBeforeMinor: before, balanceAfterMinor: minor(debt), lines: [{ kind: "fee", amountMinor: e.amountMinor }], diagnostics: { treatment: "capitalized" } });
        } else {
          emit({ ...base, type: "fee", feesMinor: e.amountMinor, cashMovementMinor: -e.amountMinor, principalMovementMinor: 0, balanceBeforeMinor: before, balanceAfterMinor: before, lines: [{ kind: "fee", amountMinor: e.amountMinor }], diagnostics: { treatment: "cash-paid" } });
        }
        return null;
      }
      case "offset-balance":
        offsetBalances.set(e.accountId!, { balanceMinor: e.amountMinor, clearedBalanceMinor: e.clearedBalanceMinor ?? e.amountMinor });
        return null;
      case "offset-deposit":
      case "offset-withdrawal":
        return {
          code: "unsupported-profile",
          classification: "blocked",
          date: e.date,
          message: "Offset deposits and withdrawals must be applied by the versioned offset transition step.",
        };
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
  const hasOffsets = model.offsets.length > 0;
  /** Event types that carry the day's rate and offset diagnostics (O2, O4). */
  const DIAGNOSED: readonly ModelEventType[] = ["repayment", "final-payment", "interest-charge"];
  for (let date = firstDay; compareDates(date, req.to) <= 0; date = addDays(date, 1)) {
    const day: Day = { date, events: byDay.get(date) ?? [] };
    const firstEventOfDay = events.length;
    let dayDiagnostics: Record<string, string | number> | null = null;
    for (const step of order) {
      let problem: BlockReason | null = null;
      currentStep = step;
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
          // Recurring capitalized fee components are added to the debt on each scheduled repayment date.
          if (scheduledSet.has(date) && !paidOff && !stopScheduling) {
            for (const fee of capitalized) {
              const before = minor(debt);
              debt = add(debt, fromMinor(fee.amountMinor, digits));
              emit({ date, type: "fee", certainty: "contractual", ref: null, cashMovementMinor: 0, principalMovementMinor: fee.amountMinor, interestMinor: 0, feesMinor: fee.amountMinor, balanceBeforeMinor: before, balanceAfterMinor: minor(debt), lines: [{ kind: "fee", amountMinor: fee.amountMinor }], diagnostics: { treatment: "capitalized", label: fee.label } });
            }
          }
          break;
        case "payment":
          for (const e of day.events.filter((x) => x.kind === "extra-repayment" || x.kind === "draw" || x.kind === "repayment")) problem ??= applyEvent(e);
          break;
        case "scheduled-repayment":
          if (scheduledSet.has(date)) problem = scheduledRepayment(date);
          break;
        case "offset-change":
          if (behavior.offsetDeltas) {
            const transition = applyOffsetTransitions(date, day.events, offsetBalances, model.offsets);
            if (!transition.ok) problem = transition.reason;
            else {
              const boundaryAccounts = model.offsets.filter((link) => link.effectiveFrom === date || link.effectiveTo === date).map((link) => link.accountId);
              offsetStates.push(...offsetStatePoints(date, [...transition.points.map((point) => point.accountId), ...boundaryAccounts], offsetBalances, model.offsets));
            }
          } else {
            for (const event of day.events.filter((candidate) => candidate.kind === "offset-balance")) problem ??= applyEvent(event);
          }
          break;
        case "determine-balance":
          break;
        case "accrue": {
          const rate = profile.rateEffectiveTiming === "from-next-charge-period" ? periodRate : rates.rateOn(date);
          if (!rate) return fail({ code: "rate-gap", classification: "blocked", date, message: `No rate applies on ${date}.` });
          const offset = eligibleOffset(model.offsets, offsetBalances as OffsetBalances, date, digits);
          const baseAmount = interestBase(profile.accrual, debt, offset, accrued);
          // Explanatory values from this very step (O2, O4); display only, never fed back into interest.
          // The engine applies an offset to the debt only (accrued interest, when compounding, is added
          // after), so the applied offset is capped at the debt and the interest-bearing amount is the
          // base the accrual just used.
          dayDiagnostics = { effectiveAnnualRateDecimal: toPlainString(rate) };
          ratesSinceCharge = noteRate(ratesSinceCharge, toPlainString(rate));
          if (hasOffsets) {
            const applied = min(max(offset, DEC_ZERO), max(debt, DEC_ZERO));
            dayDiagnostics.offsetBalanceMinor = totalOffsetBalanceMinor(model.offsets, offsetBalances, date);
            dayDiagnostics.offsetAppliedMinor = toMinor(applied, digits, "down");
            dayDiagnostics.interestBearingMinor = toMinor(max(baseAmount, DEC_ZERO), digits, "down");
          }
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
    // Events emitted before the accrue step on this date get the step's values too.
    if (dayDiagnostics) {
      for (let i = firstEventOfDay; i < events.length; i++) {
        if (DIAGNOSED.includes(events[i].type)) events[i] = { ...events[i], diagnostics: { ...events[i].diagnostics, ...dayDiagnostics } };
      }
    }
  }

  return {
    ok: true,
    events,
    offsetStates,
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

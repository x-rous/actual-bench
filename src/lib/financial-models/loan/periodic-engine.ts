import { addDays, addMonths, compareDates, type IsoDate } from "../calendar/dates";
import { generateSchedule } from "../calendar/schedule";
import { add, dec, decInt, div, fromMinor, round, sub, toDecString, toMinor, DEC_ZERO, WORKING_SCALE, type Dec } from "../money/kernel";
import { allocate } from "./allocation";
import { engineVersions, monthlySummaries, rateTable, repaymentScheduleSpec, validateModel, wholeMonthsBetween } from "./engineCommon";
import { normalizeEvents, type EngineEvent } from "./events";
import { cashComponents, feeCapitalizationPermitted } from "./fees";
import { amortizationMonths, contractualEnd, finalDecision } from "./finalPayment";
import type { BlockReason, ModelEvent, SimulationRequest, SimulationResult } from "./model";
import { interestOnlyPhaseOn } from "./phases";
import { periodicRate, periodInterestAt } from "./rates";
import { annualRecastDates, applyPaymentCap, derivePayment, paymentCount, paymentEffectiveDate, paymentsPerYear, recastPolicyFor } from "./recast";

/**
 * `bench-periodic`: deterministic period-by-period amortization (FR-028).
 *
 * A period runs from one scheduled payment date to the next. Its interest is
 * the balance times the periodic rate of the quote (`nominal-simple-periodic`
 * at 12 a year is r/12 whatever the month's length); the day count is not
 * used. Loans whose interest depends on days (daily accrual, Actual/360
 * months, offsets, events between payment dates) belong to `bench-daily`.
 * Rather than approximate them, this engine refuses with a reason:
 *
 * - a first period that is not one full period (irregular first period);
 * - a rate change inside a period when rates take effect on their accrual date;
 * - offsets; events dated between payment dates.
 *
 * Each payment's interest is charged with the payment (embedded interest), and
 * the payment is allocated with principal as the residual.
 */

export const PERIODIC_ENGINE_VERSION = "loan-periodic@1";

function periodBefore(date: IsoDate, frequency: string): IsoDate {
  switch (frequency) {
    case "weekly":
      return addDays(date, -7);
    case "fortnightly":
      return addDays(date, -14);
    case "quarterly":
      return addMonths(date, -3);
    case "annual":
      return addMonths(date, -12);
    default:
      return addMonths(date, -1);
  }
}

export function simulatePeriodic(req: SimulationRequest): SimulationResult {
  const { model, anchor } = req;
  const versions = engineVersions("loan-periodic", model);
  const fail = (reason: BlockReason): SimulationResult => ({ ok: false, blocked: [reason], versions });

  const invalid = validateModel(model);
  if (invalid) return fail(invalid);
  const { profile, currency, terms } = model;
  const digits = currency.minorDigits;
  const block = (code: BlockReason["code"], message: string, date: IsoDate | null = null) => fail({ code, classification: "blocked", date, message });

  if (profile.accrual !== "per-period") return block("unsupported-profile", "bench-periodic needs per-period accrual; daily accrual uses bench-daily.");
  if (model.offsets.length > 0) return block("offsets-need-daily-engine", "Offsets change interest day by day; use bench-daily.");
  if (!terms.firstPaymentDate) return block("missing-payment", "Scheduled repayments need a first payment date.");
  const ppy = paymentsPerYear(profile.repaymentFrequency);
  if (ppy === null || profile.repaymentFrequency === "semi-monthly") {
    return block("unsupported-profile", `bench-periodic needs a regular frequency it can generate; ${profile.repaymentFrequency} is not one in configuration version 1.`);
  }

  const end = contractualEnd(model);
  const horizon = end && compareDates(end, req.to) > 0 ? end : req.to;
  const spec = repaymentScheduleSpec(profile.repaymentFrequency, terms.firstPaymentDate, profile.shortMonth)!;
  const all = generateSchedule(spec, { from: terms.firstPaymentDate, to: horizon });
  const lastContractual = end ? [...all].reverse().find((d) => compareDates(d, end) <= 0) ?? null : null;
  const origination = periodBefore(terms.firstPaymentDate, profile.repaymentFrequency);
  if (anchor.date !== origination && !all.includes(anchor.date)) {
    return block("irregular-first-period", `The anchor ${anchor.date} is not a payment date or the start of the first period (${origination}); an irregular first period needs bench-daily.`, anchor.date);
  }
  const dates = all.filter((d) => compareDates(d, anchor.date) > 0 && compareDates(d, req.to) <= 0);

  const normalized = normalizeEvents(req.events, req.options?.applyAssumptions === false ? [] : model.assumptions, { after: anchor.date, to: req.to }, profile.eventOrder);
  if (!normalized.ok) return block("negative-repayment", normalized.message, normalized.date);
  const dateSet = new Set(dates);
  const byDate = new Map<IsoDate, EngineEvent[]>();
  for (const e of normalized.events) {
    if (compareDates(e.date, anchor.date) <= 0) continue;
    if (e.kind === "lender-interest-charge") continue; // evidence for reconciliation, not an input
    if (e.kind === "offset-balance") return block("offsets-need-daily-engine", "Offset balances change interest day by day; use bench-daily.", e.date);
    if (!dateSet.has(e.date)) return block("irregular-event", `A ${e.kind} on ${e.date} falls between payment dates; use bench-daily.`, e.date);
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }

  const rates = rateTable(model.rates);
  if (profile.rateEffectiveTiming === "on-accrual-effective-date") {
    const periodStarts = [anchor.date, ...dates];
    for (const change of rates.changes) {
      const inside = dates.find((d, i) => compareDates(change.accrualEffectiveFrom, periodStarts[i]) > 0 && compareDates(change.accrualEffectiveFrom, d) < 0);
      if (inside) return block("mid-period-rate-change", `A rate takes effect on ${change.accrualEffectiveFrom}, inside a payment period; use bench-daily or rates effective from the next period.`, change.accrualEffectiveFrom);
    }
  }

  const amortMonths = amortizationMonths(model);
  const totalPayments = amortMonths !== null ? paymentCount(profile.repaymentFrequency, amortMonths) : null;
  let paymentsMade = all.filter((d) => compareDates(d, anchor.date) <= 0).length;
  const components = cashComponents(model.components);
  const componentCash = components.reduce((s, c) => s + c.amountMinor, 0);

  let balance = anchor.principalMinor;
  let carry: Dec = anchor.carriedRemainder ? dec(anchor.carriedRemainder) : DEC_ZERO;
  let payment: number | null = anchor.scheduledPaymentMinor ?? null;
  let stopped = false;
  let paidOff = false;
  const events: ModelEvent[] = [];
  const emit = (e: Omit<ModelEvent, "diagnostics"> & { diagnostics?: ModelEvent["diagnostics"] }) => events.push({ diagnostics: {}, ...e });
  const constantInstallment =
    profile.amortization === "constant-principal" && totalPayments
      ? toMinor(div(decInt(terms.openingPrincipalMinor), decInt(totalPayments), WORKING_SCALE, "half-even"), 0, profile.rounding.paymentRounding)
      : null;

  let periodStart = anchor.date;
  for (const date of dates) {
    if (stopped) break;
    const rate = rates.rateOn(periodStart);
    if (!rate) return fail({ code: "rate-gap", classification: "blocked", date: periodStart, message: `No rate applies on ${periodStart}.` });
    const r = periodicRate(profile.rateQuote, rate, ppy);

    // Payment changes due by this payment: lender-provided amounts, rate-change and annual recasts, end of interest-only.
    for (const e of byDate.get(date) ?? []) if (e.kind === "payment-change") payment = e.amountMinor;
    const recastReasons: string[] = [];
    for (const change of rates.changes.slice(1)) {
      const effective = paymentEffectiveDate(change);
      if (compareDates(effective, periodStart) > 0 && compareDates(effective, date) <= 0 && recastPolicyFor(change, profile) === "on-rate-change") recastReasons.push("rate-change");
    }
    if (profile.recast === "annual" && annualRecastDates(terms.firstPaymentDate, periodStart, date).length > 0) recastReasons.push("annual");
    if (model.phases.some((p) => compareDates(p.to, periodStart) >= 0 && compareDates(p.to, date) < 0)) recastReasons.push("interest-only-phase-end");

    const inPhase = interestOnlyPhaseOn(model.phases, date) !== null;
    if (!inPhase && (payment === null || recastReasons.length > 0) && profile.amortization !== "constant-principal") {
      const previous = payment;
      const derived = derivePayment({
        model, balanceMinor: balance, annualRate: rate,
        remainingPayments: totalPayments === null ? 0 : Math.max(totalPayments - paymentsMade, 1),
        remainingMonths: amortMonths === null ? 0 : Math.max(amortMonths - wholeMonthsBetween(terms.openingDate, periodStart), 1),
        currentPaymentMinor: payment,
      });
      if (!derived.ok) return block("missing-payment", derived.reason, date);
      const cap = recastReasons.includes("rate-change") ? rates.changes.find((c) => compareDates(paymentEffectiveDate(c), periodStart) > 0 && compareDates(paymentEffectiveDate(c), date) <= 0)?.paymentCap : null;
      const capped = applyPaymentCap(derived.minor, previous, cap, profile, digits);
      payment = capped.minor;
      if (previous !== null) {
        emit({
          date, type: "recast", certainty: "contractual", ref: null, cashMovementMinor: 0, principalMovementMinor: 0, interestMinor: 0, feesMinor: 0,
          balanceBeforeMinor: balance, balanceAfterMinor: balance, lines: [],
          diagnostics: { reasons: recastReasons.join(","), previousPaymentMinor: previous, recalculatedPaymentMinor: capped.uncappedMinor, paymentMinor: capped.minor, capped: capped.capped, capMaxMinor: capped.capMaxMinor, annualRate: toDecString(rate) },
        });
      }
    }

    // Interest for the period, rounded at posting; carried remainder only under carry-full-precision.
    // Formed exactly where the quote allows (periodInterestAt), so no pre-rounded rate leaks in.
    const exact = add(periodInterestAt(profile.rateQuote, rate, ppy, fromMinor(balance, digits), WORKING_SCALE, "half-even"), carry);
    const posted = round(exact, digits, profile.rounding.interestPostingRounding);
    const interest = toMinor(posted, digits, "down");
    carry = profile.rounding.balancePrecision === "carry-full-precision" ? sub(exact, posted) : DEC_ZERO;

    const level = inPhase ? interest : profile.amortization === "constant-principal" ? (constantInstallment ?? 0) + interest : payment!;
    const contractualFinal = date === lastContractual;
    const owed = balance + interest;
    const decision = finalDecision({ policy: profile.finalPayment, owedMinor: owed, levelMinor: level, contractualFinal });
    const alloc = allocate({
      paymentMinor: decision.paymentMinor + componentCash,
      interestMinor: interest,
      components: components.map((c) => ({ kind: c.kind, amountMinor: c.amountMinor })),
      outstandingPrincipalMinor: balance,
      negativeAmortizationAllowed: profile.negativeAmortizationAllowed,
    });
    if (!alloc.ok) {
      return fail({ code: alloc.reason === "negative-amortization" ? "negative-amortization" : "credit-balance", classification: alloc.classification, date, message: `Payment on ${date}: ${alloc.reason}.` });
    }
    const before = balance;
    balance = balance - alloc.principalMinor + alloc.capitalizedInterestMinor;
    emit({
      date,
      type: decision.kind === "regular" || decision.kind === "continue" ? "repayment" : "final-payment",
      certainty: "scheduled",
      ref: null,
      cashMovementMinor: -(decision.paymentMinor + componentCash),
      principalMovementMinor: balance - before,
      interestMinor: interest,
      feesMinor: componentCash,
      balanceBeforeMinor: before,
      balanceAfterMinor: balance,
      lines: alloc.lines,
      diagnostics: {
        periodStart, annualRate: toDecString(rate), periodicRate: toDecString(round(r, 12, "half-even")), interestExact: toDecString(exact),
        carriedRemainder: toDecString(carry), decision: decision.kind, interestOnly: inPhase,
        negativeAmortizationMinor: alloc.capitalizedInterestMinor,
      },
    });
    if (alloc.capitalizedInterestMinor > 0) {
      // A marker, not a movement: the repayment event above already carries the balance change.
      emit({ date, type: "negative-amortization", certainty: "modelled", ref: null, cashMovementMinor: 0, principalMovementMinor: 0, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: balance, balanceAfterMinor: balance, lines: [], diagnostics: { unpaidInterestCapitalizedMinor: alloc.capitalizedInterestMinor } });
    }
    paymentsMade++;
    if (decision.balloonMinor > 0) {
      emit({ date, type: "balloon", certainty: "contractual", ref: null, cashMovementMinor: -balance, principalMovementMinor: -balance, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: balance, balanceAfterMinor: 0, lines: [{ kind: "principal", amountMinor: balance }], diagnostics: { policy: "contractual-balloon" } });
      balance = 0;
    }
    if (decision.residualMinor > 0) {
      emit({ date, type: "residual", certainty: "contractual", ref: null, cashMovementMinor: 0, principalMovementMinor: 0, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: balance, balanceAfterMinor: balance, lines: [], diagnostics: { residualMinor: balance } });
    }
    if (decision.paidOff) paidOff = true;
    if (!decision.continues) stopped = true;

    // Observed or assumed events on this payment date, after the scheduled payment.
    for (const e of byDate.get(date) ?? []) {
      const b = balance;
      if (e.kind === "extra-repayment" || e.kind === "repayment") {
        if (e.amountMinor > balance) return fail({ code: "credit-balance", classification: "review", date, message: `An extra repayment of ${e.amountMinor} exceeds the ${balance} owed.` });
        balance -= e.amountMinor;
        emit({ date, type: "extra-repayment", certainty: e.certainty, ref: e.ref, cashMovementMinor: -e.amountMinor, principalMovementMinor: -e.amountMinor, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: b, balanceAfterMinor: balance, lines: [{ kind: "principal", amountMinor: e.amountMinor }], diagnostics: {} });
        if (balance === 0) { paidOff = true; stopped = true; }
      } else if (e.kind === "draw") {
        balance += e.amountMinor;
        emit({ date, type: "draw", certainty: e.certainty, ref: e.ref, cashMovementMinor: e.amountMinor, principalMovementMinor: e.amountMinor, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: b, balanceAfterMinor: balance, lines: [{ kind: "draw", amountMinor: e.amountMinor }], diagnostics: {} });
      } else if (e.kind === "fee") {
        if (e.capitalized && !feeCapitalizationPermitted(profile)) return fail({ code: "fee-capitalization-not-permitted", classification: "review", date, message: "A capitalized fee was given but the contract does not permit capitalizing fees." });
        if (e.capitalized) balance += e.amountMinor;
        emit({ date, type: "fee", certainty: e.certainty, ref: e.ref, cashMovementMinor: e.capitalized ? 0 : -e.amountMinor, principalMovementMinor: e.capitalized ? e.amountMinor : 0, interestMinor: 0, feesMinor: e.amountMinor, balanceBeforeMinor: b, balanceAfterMinor: balance, lines: [{ kind: "fee", amountMinor: e.amountMinor }], diagnostics: { capitalized: e.capitalized } });
      }
    }
    periodStart = date;
  }

  return {
    ok: true,
    events,
    periods: monthlySummaries(events, anchor.principalMinor),
    closing: { date: req.to, principalMinor: balance, accruedInterestMinor: 0, accruedInterestExact: "0", carriedRemainder: toDecString(carry), scheduledPaymentMinor: payment, paidOff },
    versions,
  };
}

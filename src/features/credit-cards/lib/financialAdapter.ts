import { simulate } from "@/lib/financial-models/loan/projection";
import { revolvingState } from "@/lib/financial-models/loan/revolving";
import type { LoanModelSnapshot, SimulationRequest } from "@/lib/financial-models/loan/model";
import { actualUnitsToMinor } from "@/lib/assets-debt/actual/ledgerPort";
import { minorAmountSchema } from "./models";
import { cycleDates } from "./cycles";
import { sumMinor } from "./statements";
import { addMonths } from "@/lib/financial-models/calendar/dates";

/** Live Actual signed balance (whole display units) → debt and credit in minor units. */
export function cardBalance(balanceWhole: number) {
  const signedBalanceMinor = actualUnitsToMinor(balanceWhole);
  return { signedBalanceMinor, debtMinor: Math.max(0, -signedBalanceMinor), creditMinor: Math.max(0, signedBalanceMinor) };
}

/** Existing Loans & Debt facility calculation; no second limit/debt engine. */
export function cardFacility(model: LoanModelSnapshot, signedBalanceMinor: number) {
  minorAmountSchema.parse(signedBalanceMinor);
  if (model.terms.creditLimitMinor !== null) minorAmountSchema.nonnegative().parse(model.terms.creditLimitMinor);
  return revolvingState(model, Math.max(0, -signedBalanceMinor));
}

/**
 * Explicit supported modelling request → the same engine as Loans & Debt.
 * Never infer issuer conventions from APR metadata or insert simulated interest into Actual.
 * Caller must provide a reviewed model/profile; no feature-local accrual/projection algorithm.
 */
export function calculateCardDebt(request: SimulationRequest) {
  if (request.model.behaviorClass !== "revolving-credit") throw new Error("Credit-card modelling requires a revolving facility model");
  if (request.model.currency.minorDigits !== 2) throw new Error("Actual amounts use integer hundredths");
  minorAmountSchema.nonnegative().parse(request.anchor.principalMinor);
  return simulate({ ...request, options: { ...request.options, generateScheduledRepayments: false, applyAssumptions: false } });
}

/** A user-selected simple-interest illustration, never an inferred bank convention. */
export function cardModel(card: import("./models").Card, date: string, principalMinor: number): LoanModelSnapshot {
  const currentClose = addMonths(date, 0, card.closingDay ?? 1);
  const firstInterestChargeDate = currentClose > date ? currentClose : addMonths(date, 1, card.closingDay ?? 1);
  return {
    debtId: card.id, revision: card.revision, currency: { code: "", minorDigits: 2 }, behaviorClass: "revolving-credit", lenderPattern: "separate-interest",
    terms: { openingDate: date, openingPrincipalMinor: principalMinor, maturityDate: null, contractualTermMonths: null, amortizationTermMonths: null, contractualPaymentMinor: null, creditLimitMinor: card.creditLimitMinor, firstPaymentDate: null, firstInterestChargeDate },
    profile: { amortization: "revolving", rateQuote: "nominal-simple-periodic", dayCount: card.interestModel === "daily-simple-360" ? "actual-360" : "actual-365-fixed", accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: card.closingDay ?? 1, capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "contractual-fixed", recast: "never", rateEffectiveTiming: "on-accrual-effective-date", repaymentEffectiveTiming: "transaction-date", rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" }, eventOrder: { timing: "end-of-day" }, finalPayment: "true-up-to-zero", shortMonth: "clamp-to-last-calendar-day", negativeAmortizationAllowed: false, interestOnlyRepayment: "charged-interest-outstanding", presetId: null },
    rates: [{ accrualEffectiveFrom: date, annualRateDecimal: `${Math.floor((card.purchaseAprBps ?? 0) / 10_000)}.${String((card.purchaseAprBps ?? 0) % 10_000).padStart(4, "0")}` }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [],
    revolving: { paymentModel: "percent-of-balance", percentOfBalanceBps: card.minimumPercentBps, minimumFloorMinor: card.minimumFloorMinor },
  };
}

/** Recompute every hypothetical due date from its own closing cycle, never a clamped first due date. */
export function projectedCycleDates(card: import("./models").Card, date: string, to: string) {
  const firstClose = cardModel(card, date, 0).terms.firstInterestChargeDate!;
  const cycles = [];
  for (let month = 0; month <= 360; month++) {
    const close = addMonths(firstClose, month, card.closingDay ?? 1);
    if (close > to) break;
    cycles.push(cycleDates(card, close));
  }
  return cycles;
}

/** Future minimum-rule illustration. The shared engine owns all accrual, rounding and payments. */
export function projectCardMinimums(card: import("./models").Card, date: string, principalMinor: number) {
  if (card.interestModel === "off" || card.purchaseAprBps === null || card.minimumPercentBps === null || card.closingDay === null || card.dueRule === null) return null;
  minorAmountSchema.nonnegative().parse(principalMinor);
  const horizon = addMonths(date, 360);
  const model = cardModel(card, date, principalMinor);
  // A limit does not cap interest owed; this scenario excludes new borrowing.
  model.terms.creditLimitMinor = null;
  model.profile.negativeAmortizationAllowed = true;
  const cycles = projectedCycleDates(card, date, horizon);
  const dueDates = [...new Set(cycles.map((cycle) => cycle.dueDate))].sort();
  const boundaries = [...new Set([...cycles.map((cycle) => cycle.closingDate), ...dueDates.filter((due) => due <= horizon), horizon])].sort();
  let anchor: SimulationRequest["anchor"] = { date, principalMinor, accruedInterestMinor: 0, source: "current-actual-balance" };
  let postedInterestMinor = 0;
  let interestAtPreviousPayment = 0;
  let insufficientInterestPayments = false;
  let payoffDate: string | null = principalMinor === 0 ? date : null;
  const balancePoints = [{ date, value: principalMinor, breakdown: [{ label: "Posted balance", value: principalMinor }, { label: "Accrued, not posted interest", value: 0 }, { label: "Repayments since previous observation", value: 0 }] }];
  const interestPoints = [{ date, value: 0, breakdown: [{ label: "Posted interest", value: 0 }, { label: "Accrued, not posted interest", value: 0 }] }];
  for (const end of boundaries) {
    if (payoffDate) break;
    const nextDue = dueDates.find((due) => due > anchor.date);
    model.terms.firstPaymentDate = nextDue ?? null;
    // Resume the exact engine closing state. One independently computed due date per segment
    // avoids the engine's monthly schedule inheriting February's clamped day.
    const result = simulate({ model, anchor, events: [], to: end, options: { generateScheduledRepayments: nextDue === end, applyAssumptions: false } });
    if (!result.ok) return { ok: false as const, message: result.blocked.map((entry) => entry.message).join(" ") };
    postedInterestMinor = sumMinor([postedInterestMinor, ...result.events.map((event) => event.interestMinor)]);
    const accruedMinor = result.closing.accruedInterestMinor;
    const totalInterestMinor = sumMinor([postedInterestMinor, accruedMinor]);
    const repayments = result.events.filter((event) => event.type === "repayment" || event.type === "final-payment");
    if (nextDue === end) {
      const paymentMinor = sumMinor(repayments.map((event) => -event.cashMovementMinor));
      if (paymentMinor < totalInterestMinor - interestAtPreviousPayment) insufficientInterestPayments = true;
      interestAtPreviousPayment = totalInterestMinor;
    }
    // A zero posted balance alone is insufficient: even sub-minor accrued amounts must
    // pass through the engine's posting/settlement policy before declaring payoff.
    const exactZero = (value: string | null | undefined) => value == null || /^[-+]?0(?:\.0+)?$/.test(value);
    if (result.closing.principalMinor === 0 && exactZero(result.closing.accruedInterestExact) && exactZero(result.closing.carriedRemainder)) payoffDate = end;
    balancePoints.push({ date: end, value: sumMinor([result.closing.principalMinor, accruedMinor]), breakdown: [{ label: "Posted balance", value: result.closing.principalMinor }, { label: "Accrued, not posted interest", value: accruedMinor }, { label: "Repayments since previous observation", value: sumMinor(repayments.map((event) => -event.cashMovementMinor)) }] });
    interestPoints.push({ date: end, value: totalInterestMinor, breakdown: [{ label: "Posted interest", value: postedInterestMinor }, { label: "Accrued, not posted interest", value: accruedMinor }] });
    anchor = { ...result.closing, source: "projection-continuation" };
  }
  return { ok: true as const, payoffDate, interestMinor: interestPoints.at(-1)!.value, postedInterestMinor, accruedInterestMinor: anchor.accruedInterestMinor ?? 0, insufficientInterestPayments, balancePoints, interestPoints };
}

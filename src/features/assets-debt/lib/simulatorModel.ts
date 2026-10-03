import type { DebtDetail, DebtSaveInput } from "@/lib/assets-debt/services/debtConfigService";
import { addDays, addMonths, compareDates, isIsoDate } from "@/lib/financial-models/calendar/dates";
import { generateSchedule } from "@/lib/financial-models/calendar/schedule";
import { debtConfigVersionFor, type DebtConfig } from "@/lib/financial-models/loan/configSchema";
import type { DebtPhase, FutureAssumption, LoanModelSnapshot, PaymentComponent } from "@/lib/financial-models/loan/model";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";
import { simulate } from "@/lib/financial-models/loan/projection";
import { repaymentScheduleSpec } from "@/lib/financial-models/loan/engineCommon";
import { paymentCount } from "@/lib/financial-models/loan/recast";
import type { PaymentLimit } from "@/lib/financial-models/loan/rates";
import { labelOf, CHARGE_FREQUENCY_OPTIONS, REPAYMENT_DERIVATION_OPTIONS } from "./vocabulary";

/**
 * The loan simulator's model (RD-084 P1.3b; contracts/simulator-ui.md).
 *
 * Two states, kept apart on purpose:
 *
 * - `SimulationState` holds only what changes the calculation. It is enough to
 *   build a complete `LoanModelSnapshot` and never holds an Actual account,
 *   category, lender pattern, strategy or posting setting. A simulated offset
 *   uses a placeholder account id.
 * - `TrackingState` holds the Actual-side choices, asked for only when the
 *   user sets up tracking.
 *
 * Everything here is pure: no Actual access, no persistence. A debt is only
 * written by an explicit save of `statesToSaveInput`.
 */

export type SimRate = {
  key: string;
  id?: string | null;
  accrualEffectiveFrom: string;
  /** Exact fraction ("0.0612"), or null while the input is incomplete. */
  annualRateDecimal: string | null;
  paymentRecalcPolicy: "never" | "on-rate-change" | "lender-provided" | null;
  paymentEffectiveFrom: string | null;
  rateCapDecimal: string | null;
  rateFloorDecimal: string | null;
  paymentCap: PaymentLimit | null;
  announcedAt: string | null;
  source: string | null;
  note: string | null;
};

/** The calculation side of a fee or other cost; its label, destination and category are tracking's. */
export type SimComponent = {
  key: string;
  economicKind: "fee" | "escrow" | "insurance" | "tax" | "other";
  amountRule: "fixed" | "lender-provided";
  fixedAmountMinor: number | null;
  treatment: "cash-paid" | "capitalized" | null;
};

export type SimOffset = {
  key: string;
  /** A stand-in id; Tracking setup maps it to an Actual account before any save. */
  placeholderAccountId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  percentageBps: number;
  basis: "total" | "cleared";
  capMinor: number | null;
  fundScheduledRepayments: boolean;
  fundScheduledRepaymentsFrom: string | null;
  useActualBalance: boolean;
};

export type SimAssumptionKind = "extra-repayment" | "draw" | "fee" | "payment-change" | "offset-balance" | "offset-deposit" | "offset-withdrawal";

export const isOffsetAssumptionKind = (kind: SimAssumptionKind): boolean =>
  kind === "offset-balance" || kind === "offset-deposit" || kind === "offset-withdrawal";

export type SimAssumption = {
  key: string;
  id?: string | null;
  kind: SimAssumptionKind;
  effectiveFrom: string;
  recurrence: { frequency: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual"; until: string } | null;
  /** Minor units: the amount, or for an offset balance change the offset balance from that date. */
  amountMinor: number;
  feeTreatment: "cash-paid" | "capitalized" | null;
  /** Offset state assumptions only: the simulated offset's placeholder id. */
  offsetAccountId: string | null;
  note: string | null;
};

export type SimulationState = {
  currency: string;
  minorDigits: number;
  shape: "term-loan" | "revolving-credit";
  principalMinor: number | null;
  /** Amortization term, the primary "Term" input. */
  termMonths: number | null;
  startDate: string;
  profile: CalculationProfile;
  /** Row 0 is the opening rate; its date follows `startDate`. */
  rates: SimRate[];
  interestOnly: boolean;
  phases: DebtPhase[];
  /** Balloon: a contract shorter than the amortization term. Null when off. */
  contractTermMonths: number | null;
  maturityDate: string | null;
  /** An explicit first repayment date; null derives it. */
  firstPaymentDate: string | null;
  firstInterestChargeDate: string | null;
  contractualPaymentMinor: number | null;
  creditLimitMinor: number | null;
  paymentRecasts: { date: string; note: string | null }[];
  components: SimComponent[];
  offsets: SimOffset[];
  assumptions: SimAssumption[];
  revolving: DebtConfig["revolving"];
};

/** Assumptions shown under Events; opening offset state is part of the offset itself. */
export function extraTransactions(sim: SimulationState): SimAssumption[] {
  return sim.assumptions.filter((assumption) => assumption.kind !== "offset-balance");
}

/** Identical calculation settings with optional Event assumptions removed; rate periods remain. */
export function withoutExtraTransactions(sim: SimulationState): SimulationState {
  const extras = new Set(extraTransactions(sim).map((assumption) => assumption.key));
  return extras.size ? { ...sim, assumptions: sim.assumptions.filter((assumption) => !extras.has(assumption.key)) } : sim;
}

export type TrackingComponent = {
  key: string;
  economicKind: string;
  label: string;
  destination: "transfer" | "category" | "income-category" | "tracking-only";
  categoryId: string | null;
};

export type TrackingState = {
  name: string;
  debtType: DebtSaveInput["debtType"];
  direction: "owed-by-me" | "owed-to-me";
  liabilityAccountId: string | null;
  paymentAccountId: string | null;
  signConvention: DebtSaveInput["signConvention"];
  /** Never defaulted: null until the user answers (owner decision). */
  lenderPattern: "embedded-interest" | "separate-interest" | null;
  /** Recommended from eligibility; the formula-rule strategy is not offered before P1.7. */
  executionStrategy: DebtSaveInput["executionStrategy"] | null;
  offsetAccountMap: Record<string, string>;
  /** Every payment component in order: principal and interest rows plus one per simulated cost. */
  components: TrackingComponent[];
  loanPaymentCategoryId: string | null;
  drawCategoryId: string | null;
  driftToleranceMinor: number | null;
  lenderChargeGraceDays: number;
  expectedObservationIntervalDays: number | null;
  status: "draft" | "active";
  changeSummary: string;
};

let seq = 0;
export const simKey = (prefix = "k") => `${prefix}-${++seq}`;

/** The sample-loan default: a conventional level payment with Actual/365 Fixed daily interest. */
export const SIMULATOR_DEFAULT_PROFILE: CalculationProfile = {
  amortization: "level-payment",
  rateQuote: "nominal-simple-periodic",
  dayCount: "actual-365-fixed",
  accrual: "daily-simple",
  chargeFrequency: "at-repayment",
  chargeDay: null,
  capitalization: "at-charge",
  repaymentFrequency: "monthly",
  repaymentDerivation: "annuity-at-payment-frequency",
  recast: "on-rate-change",
  rateEffectiveTiming: "on-accrual-effective-date",
  repaymentEffectiveTiming: "transaction-date",
  rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" },
  eventOrder: { timing: "end-of-day" },
  finalPayment: "true-up-to-zero",
  shortMonth: "clamp-to-last-calendar-day",
  negativeAmortizationAllowed: false,
  interestOnlyRepayment: "charged-interest-outstanding",
  presetId: null,
};

/** Minor digits for a currency from the platform's ISO 4217 data; 2 when unknown. Clamped to 0–4. */
export function minorDigitsFor(currency: string): number {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" ? Math.min(4, Math.max(0, digits)) : 2;
  } catch {
    return 2;
  }
}

export function openingRate(date: string): SimRate {
  return { key: simKey("rate"), id: null, accrualEffectiveFrom: date, annualRateDecimal: null, paymentRecalcPolicy: null, paymentEffectiveFrom: null, rateCapDecimal: null, rateFloorDecimal: null, paymentCap: null, announcedAt: null, source: null, note: null };
}

export function newSimulation(input: { currency: string; today: string; minorDigits?: number }): SimulationState {
  const minorDigits = input.minorDigits ?? minorDigitsFor(input.currency);
  const rate = openingRate(input.today);
  return {
    currency: input.currency,
    minorDigits,
    shape: "term-loan",
    principalMinor: 500_000 * 10 ** minorDigits,
    termMonths: 20 * 12,
    startDate: input.today,
    profile: structuredClone(SIMULATOR_DEFAULT_PROFILE),
    rates: [{ ...rate, annualRateDecimal: "0.054" }],
    interestOnly: false,
    phases: [],
    contractTermMonths: null,
    maturityDate: null,
    firstPaymentDate: null,
    firstInterestChargeDate: null,
    contractualPaymentMinor: null,
    creditLimitMinor: null,
    paymentRecasts: [],
    components: [],
    offsets: [],
    assumptions: [],
    revolving: null,
  };
}

export function newTracking(sim: SimulationState): TrackingState {
  return {
    name: "",
    debtType: sim.shape === "revolving-credit" ? "heloc" : "mortgage",
    direction: "owed-by-me",
    liabilityAccountId: null,
    paymentAccountId: null,
    signConvention: "negative-is-debt",
    lenderPattern: null,
    executionStrategy: null,
    offsetAccountMap: {},
    components: [
      { key: "principal", economicKind: "principal", label: "Principal", destination: "transfer", categoryId: null },
      { key: "interest", economicKind: "interest", label: "Interest", destination: "category", categoryId: null },
    ],
    loanPaymentCategoryId: null,
    drawCategoryId: null,
    driftToleranceMinor: null,
    lenderChargeGraceDays: 3,
    expectedObservationIntervalDays: null,
    status: "active",
    changeSummary: "",
  };
}

/** The first repayment one period after the start, unless the user set one. */
export function derivedFirstPaymentDate(sim: SimulationState): string {
  if (sim.firstPaymentDate) return sim.firstPaymentDate;
  switch (sim.profile.repaymentFrequency) {
    case "weekly":
      return addDays(sim.startDate, 7);
    case "fortnightly":
      return addDays(sim.startDate, 14);
    case "quarterly":
      return addMonths(sim.startDate, 3);
    case "annual":
      return addMonths(sim.startDate, 12);
    default:
      return addMonths(sim.startDate, 1);
  }
}

/** The five inputs (and anything else required by the chosen shape) that are still missing. */
export function missingInputs(sim: SimulationState): string[] {
  const missing: string[] = [];
  if (!sim.principalMinor || sim.principalMinor <= 0) missing.push(sim.shape === "revolving-credit" ? "drawn balance" : "loan amount");
  if (!sim.termMonths || sim.termMonths < 1) missing.push("term");
  if (!isIsoDate(sim.startDate)) missing.push("start date");
  if (sim.rates[0]?.annualRateDecimal == null) missing.push("interest rate");
  return missing;
}

export const SIMULATION_HORIZON_CAP_MONTHS = 50 * 12;

/** Start to the end of the contract; open-ended policies run on to a documented cap. */
export function projectionWindow(sim: SimulationState): { from: string; to: string } {
  const months = Math.max(sim.termMonths ?? 0, sim.contractTermMonths ?? 0, 1);
  const extra = sim.profile.finalPayment === "continue-until-paid" || sim.shape === "revolving-credit" ? SIMULATION_HORIZON_CAP_MONTHS - months : 1;
  const end = sim.maturityDate ?? inferredLastPaymentDate(sim, months) ?? addMonths(sim.startDate, months);
  return { from: sim.startDate, to: addMonths(end, Math.max(extra, 1)) };
}

/** Calendar-only guidance for the first repayment inside an offset's funding interval. */
export function firstEligibleFundingRepaymentDate(sim: SimulationState, offset: SimOffset): string | null {
  if (!offset.fundScheduledRepayments || !isIsoDate(sim.startDate) || !isIsoDate(offset.effectiveFrom)) return null;
  if (offset.fundScheduledRepaymentsFrom !== null && !isIsoDate(offset.fundScheduledRepaymentsFrom)) return null;
  if (offset.effectiveTo !== null && !isIsoDate(offset.effectiveTo)) return null;
  const first = derivedFirstPaymentDate(sim);
  const spec = repaymentScheduleSpec(sim.profile.repaymentFrequency, first, sim.profile.shortMonth);
  if (!spec) return null;
  const fundingFrom = offset.fundScheduledRepaymentsFrom !== null && compareDates(offset.fundScheduledRepaymentsFrom, offset.effectiveFrom) > 0
    ? offset.fundScheduledRepaymentsFrom
    : offset.effectiveFrom;
  const from = compareDates(first, fundingFrom) > 0 ? first : fundingFrom;
  const months = Math.max(sim.contractTermMonths ?? sim.termMonths ?? 1, 1);
  const contractualEnd = sim.maturityDate ?? inferredLastPaymentDate(sim, months) ?? addMonths(sim.startDate, months);
  const scheduleEnd = sim.profile.finalPayment === "continue-until-paid" ? projectionWindow(sim).to : contractualEnd;
  const to = offset.effectiveTo === null || compareDates(scheduleEnd, offset.effectiveTo) < 0 ? scheduleEnd : addDays(offset.effectiveTo, -1);
  if (compareDates(from, to) > 0) return null;
  return generateSchedule(spec, { from, to })[0] ?? null;
}

/** Last generated contractual date when a term is a count of payment periods. */
function inferredLastPaymentDate(sim: SimulationState, months: number): string | null {
  if (sim.profile.repaymentFrequency !== "monthly" && sim.profile.repaymentFrequency !== "quarterly" && sim.profile.repaymentFrequency !== "annual") return null;
  const first = derivedFirstPaymentDate(sim);
  const count = paymentCount(sim.profile.repaymentFrequency, months);
  const spec = repaymentScheduleSpec(sim.profile.repaymentFrequency, first, sim.profile.shortMonth);
  if (count === null || spec === null) return null;
  const horizon = addMonths(first, months + 12);
  const dates = generateSchedule(spec, { from: first, to: horizon });
  const last = dates[count - 1] ?? null;
  return last && compareDates(last, sim.startDate) > 0 ? last : null;
}

const componentLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

function modelComponents(sim: SimulationState): PaymentComponent[] {
  return sim.components.map((c, i) => ({
    economicKind: c.economicKind,
    label: componentLabel(c.economicKind),
    destination: "category",
    categoryId: null,
    amountRule: c.amountRule,
    fixedAmountMinor: c.fixedAmountMinor,
    treatment: c.economicKind === "fee" ? (c.treatment ?? "cash-paid") : null,
    order: i + 2,
  }));
}

function modelAssumptions(sim: SimulationState): FutureAssumption[] {
  return sim.assumptions.map((a): FutureAssumption => {
    const recurrence = a.recurrence ? { recurrence: a.recurrence } : {};
    switch (a.kind) {
      case "fee":
        return { kind: "fee", date: a.effectiveFrom, amountMinor: a.amountMinor, treatment: a.feeTreatment ?? "cash-paid", ...recurrence };
      case "draw":
        return { kind: "draw", date: a.effectiveFrom, amountMinor: a.amountMinor, ...recurrence };
      case "payment-change":
        return { kind: "payment-change", date: a.effectiveFrom, amountMinor: a.amountMinor };
      case "offset-balance":
        return { kind: "offset-balance", date: a.effectiveFrom, accountId: a.offsetAccountId ?? "", balanceMinor: a.amountMinor };
      case "offset-deposit":
      case "offset-withdrawal":
        return { kind: a.kind, date: a.effectiveFrom, accountId: a.offsetAccountId ?? "", amountMinor: a.amountMinor, ...recurrence };
      default:
        return { kind: "extra-repayment", date: a.effectiveFrom, amountMinor: a.amountMinor, ...recurrence };
    }
  });
}

export type ModelResult = { ok: true; model: LoanModelSnapshot } | { ok: false; missing: string[] };

/**
 * The engine model for the current simulation. Features that are switched off
 * contribute nothing: interest-only off means no phases; contract recast dates
 * count only under the matching recast policy; a charge day only when interest
 * is charged on its own cadence.
 */
export function simulationToModel(sim: SimulationState, identity: { debtId?: string; revision?: number } = {}): ModelResult {
  const missing = missingInputs(sim);
  if (missing.length) return { ok: false, missing };
  const profile: CalculationProfile = {
    ...sim.profile,
    amortization: sim.shape === "revolving-credit" ? "revolving" : sim.profile.amortization === "revolving" ? "level-payment" : sim.profile.amortization,
    chargeDay: sim.profile.chargeFrequency === "at-repayment" ? null : (sim.profile.chargeDay ?? 1),
    rounding: { ...sim.profile.rounding, intermediateScale: sim.profile.rounding.intermediateScale },
  };
  const rates = sim.rates
    .filter((r, i) => i === 0 || r.annualRateDecimal !== null)
    .map((r, i) => ({
      accrualEffectiveFrom: i === 0 ? sim.startDate : r.accrualEffectiveFrom,
      annualRateDecimal: r.annualRateDecimal!,
      announcedAt: r.announcedAt,
      paymentRecalcPolicy: r.paymentRecalcPolicy,
      paymentEffectiveFrom: r.paymentEffectiveFrom,
      rateCapDecimal: r.rateCapDecimal,
      rateFloorDecimal: r.rateFloorDecimal,
      paymentCap: r.paymentCap,
    }));
  return {
    ok: true,
    model: {
      debtId: identity.debtId ?? "simulation",
      revision: identity.revision ?? 0,
      currency: { code: sim.currency, minorDigits: sim.minorDigits },
      behaviorClass: sim.shape,
      lenderPattern: null,
      terms: {
        openingDate: sim.startDate,
        openingPrincipalMinor: sim.principalMinor!,
        maturityDate: sim.shape === "term-loan" ? sim.maturityDate : null,
        contractualTermMonths: sim.contractTermMonths ?? sim.termMonths,
        amortizationTermMonths: sim.termMonths,
        contractualPaymentMinor: needsContractualPayment(profile) ? sim.contractualPaymentMinor : null,
        creditLimitMinor: sim.shape === "revolving-credit" ? sim.creditLimitMinor : null,
        firstPaymentDate: derivedFirstPaymentDate(sim),
        firstInterestChargeDate: profile.chargeFrequency === "at-repayment" ? null : sim.firstInterestChargeDate,
      },
      profile,
      rates,
      phases: sim.interestOnly ? sim.phases : [],
      offsets: sim.offsets.map((o) => ({ id: o.key, accountId: o.placeholderAccountId, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo, percentageBps: o.percentageBps, basis: o.basis, capMinor: o.capMinor, fundScheduledRepayments: o.fundScheduledRepayments, fundScheduledRepaymentsFrom: o.fundScheduledRepaymentsFrom, useActualBalance: o.useActualBalance })),
      components: modelComponents(sim),
      paymentRecasts: profile.recast === "on-contract-date" ? sim.paymentRecasts.map((r) => ({ date: r.date })) : [],
      assumptions: modelAssumptions(sim),
      revolving: sim.shape === "revolving-credit" ? sim.revolving : null,
    },
  };
}

export function needsContractualPayment(profile: CalculationProfile): boolean {
  return profile.repaymentDerivation === "contractual-fixed" || profile.repaymentDerivation === "lender-provided";
}

// ── O1: features the period-by-period engine cannot represent ───────────────

const NEEDS_DAILY = new Set(["offsets-need-daily-engine", "irregular-event", "mid-period-rate-change", "irregular-first-period"]);

/**
 * Why this candidate simulation needs day-by-day interest, from the periodic
 * engine's own refusal (never a UI guess), or null when it does not.
 */
export function dailyEngineReason(candidate: SimulationState): string | null {
  if (candidate.profile.accrual !== "per-period") return null;
  const built = simulationToModel(candidate);
  if (!built.ok) return null;
  const { model } = built;
  const window = projectionWindow(candidate);
  const result = simulate({ model, anchor: { date: model.terms.openingDate, principalMinor: model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: [], to: window.to });
  if (result.ok) return null;
  const refusal = result.blocked.find((b) => NEEDS_DAILY.has(b.code));
  if (!refusal) return null;
  switch (refusal.code) {
    case "offsets-need-daily-engine":
      return "An offset changes the interest day by day, which a once-per-period calculation cannot follow.";
    case "mid-period-rate-change":
      return "The rate changes part-way through a repayment period, so interest has to be worked out day by day.";
    case "irregular-first-period":
      return "The first repayment period is irregular, so interest has to be worked out day by day.";
    default:
      return "A transaction falls between repayment dates, so interest has to be worked out day by day.";
  }
}

/**
 * The minimum change to calculate day by day: accrue daily at simple interest
 * and keep every other setting (charging still with each repayment).
 */
export function switchToDayByDay(sim: SimulationState): SimulationState {
  return { ...sim, profile: { ...sim.profile, accrual: "daily-simple", capitalization: "at-charge", presetId: null } };
}

// ── Summaries ───────────────────────────────────────────────────────────────

/** One line for the collapsed Calculation method control. */
export function summarizeProfile(profile: CalculationProfile): string {
  const parts: string[] = [];
  if (profile.accrual === "per-period") {
    parts.push("interest per repayment period");
  } else {
    parts.push(labelDayCount(profile.dayCount));
    parts.push(profile.accrual === "daily-compounded" ? "daily compounded interest" : "daily interest");
    parts.push(profile.chargeFrequency === "at-repayment" ? "charged with each repayment" : `charged ${labelOf(CHARGE_FREQUENCY_OPTIONS, profile.chargeFrequency).toLowerCase()}${profile.chargeDay ? ` on day ${profile.chargeDay}` : ""}`);
  }
  parts.push(profile.amortization === "constant-principal" ? "constant principal" : profile.amortization === "revolving" ? "revolving" : "level payment");
  if (profile.repaymentDerivation !== "annuity-at-payment-frequency") parts.push(labelOf(REPAYMENT_DERIVATION_OPTIONS, profile.repaymentDerivation).toLowerCase());
  return parts.join(" · ");
}

function labelDayCount(id: string): string {
  return { "actual-365-fixed": "Actual/365 Fixed", "actual-actual-calendar": "Actual/Actual", "actual-360": "Actual/360", "monthly-30-360-actual-day-allocation": "Monthly 30/360" }[id] ?? id;
}

// ── Saved debt ↔ states ─────────────────────────────────────────────────────

export function detailToStates(detail: DebtDetail): { simulation: SimulationState; tracking: TrackingState } | null {
  if (detail.blocked || !detail.config.ok) return null;
  const c = detail.config.config;
  const d = detail.debt;
  const offsetPlaceholder = new Map(detail.offsets.map((o) => [o.actualAccountId, `offset:${o.id}`]));
  const simComponents: SimComponent[] = [];
  const trackingComponents: TrackingComponent[] = [];
  c.components.forEach((comp, i) => {
    const key = comp.economicKind === "principal" || comp.economicKind === "interest" ? comp.economicKind : `component-${i}`;
    trackingComponents.push({ key, economicKind: comp.economicKind, label: comp.label, destination: comp.destination, categoryId: comp.categoryId });
    if (comp.economicKind !== "principal" && comp.economicKind !== "interest" && comp.economicKind !== "draw") {
      simComponents.push({ key, economicKind: comp.economicKind, amountRule: comp.amountRule === "calculated" ? "fixed" : comp.amountRule, fixedAmountMinor: comp.fixedAmountMinor, treatment: comp.treatment });
    }
  });
  const shape = d.behaviorClass === "revolving-credit" ? "revolving-credit" : "term-loan";
  const balloon = c.terms.contractualTermMonths !== null && c.terms.amortizationTermMonths !== null && c.terms.contractualTermMonths !== c.terms.amortizationTermMonths;
  const simulation: SimulationState = {
    currency: d.currency,
    minorDigits: d.currencyMinorDigits,
    shape,
    principalMinor: c.terms.openingPrincipalMinor,
    termMonths: c.terms.amortizationTermMonths ?? c.terms.contractualTermMonths,
    startDate: c.terms.openingDate,
    profile: c.profile as CalculationProfile,
    rates: detail.rates.map((r) => ({
      key: simKey("rate"),
      id: r.id,
      accrualEffectiveFrom: r.accrualEffectiveFrom,
      annualRateDecimal: r.annualRateDecimal,
      paymentRecalcPolicy: typeof r.paymentRecalcPolicy === "string" ? r.paymentRecalcPolicy : null,
      paymentEffectiveFrom: r.paymentEffectiveFrom,
      rateCapDecimal: r.rateCapDecimal,
      rateFloorDecimal: r.rateFloorDecimal,
      paymentCap: r.paymentCap && typeof r.paymentCap.kind === "string" ? (r.paymentCap as PaymentLimit) : null,
      announcedAt: r.announcedAt,
      source: r.source,
      note: r.note,
    })),
    interestOnly: c.phases.length > 0,
    phases: c.phases as DebtPhase[],
    contractTermMonths: balloon ? c.terms.contractualTermMonths : null,
    maturityDate: c.terms.maturityDate,
    firstPaymentDate: c.terms.firstPaymentDate,
    firstInterestChargeDate: c.terms.firstInterestChargeDate,
    contractualPaymentMinor: c.terms.contractualPaymentMinor,
    creditLimitMinor: c.terms.creditLimitMinor,
    paymentRecasts: c.paymentRecasts.map((r) => ({ date: r.date, note: r.note })),
    components: simComponents,
    offsets: detail.offsets.map((o) => ({ key: `offset:${o.id}`, placeholderAccountId: `offset:${o.id}`, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo, percentageBps: o.offsetPercentageBps, basis: o.balanceBasis === "cleared" ? "cleared" : "total", capMinor: o.capMinor, fundScheduledRepayments: o.fundScheduledRepayments === true, fundScheduledRepaymentsFrom: o.fundScheduledRepaymentsFrom ?? null, useActualBalance: o.useActualBalance === true })),
    assumptions: detail.assumptions.map((a) => ({
      key: simKey("assumption"),
      id: a.id,
      kind: a.assumptionKind as SimAssumptionKind,
      effectiveFrom: a.effectiveFrom,
      recurrence: a.recurrence && !("unknown" in a.recurrence) ? (a.recurrence as SimAssumption["recurrence"]) : null,
      amountMinor: a.amountMinor ?? 0,
      feeTreatment: (a.feeTreatment as SimAssumption["feeTreatment"]) ?? null,
      offsetAccountId: a.offsetAccountId ? (offsetPlaceholder.get(a.offsetAccountId) ?? a.offsetAccountId) : null,
      note: a.note,
    })),
    revolving: c.revolving,
  };
  const tracking: TrackingState = {
    name: d.name,
    debtType: typeof d.debtType === "string" ? d.debtType : "other",
    direction: d.behaviorClass === "receivable-loan" ? "owed-to-me" : "owed-by-me",
    liabilityAccountId: d.liabilityAccountId,
    paymentAccountId: d.paymentAccountId,
    signConvention: typeof d.signConvention === "string" ? d.signConvention : "negative-is-debt",
    lenderPattern: typeof d.lenderPattern === "string" ? d.lenderPattern : null,
    executionStrategy: typeof d.executionStrategy === "string" ? d.executionStrategy : null,
    offsetAccountMap: Object.fromEntries(detail.offsets.map((o) => [`offset:${o.id}`, o.actualAccountId])),
    components: trackingComponents,
    loanPaymentCategoryId: d.loanPaymentCategoryId,
    drawCategoryId: d.drawCategoryId,
    driftToleranceMinor: d.driftToleranceMinor,
    lenderChargeGraceDays: d.lenderChargeGraceDays,
    expectedObservationIntervalDays: d.expectedObservationIntervalDays,
    status: d.status === "draft" ? "draft" : "active",
    changeSummary: "",
  };
  return { simulation, tracking };
}

/**
 * Tracking components in order: the stored rows, plus a default row for any
 * simulated cost that tracking has not seen yet; rows for removed costs drop.
 */
export function reconcileTrackingComponents(sim: SimulationState, tracking: TrackingState): TrackingComponent[] {
  const simKeys = new Set(sim.components.map((c) => c.key));
  const kept = tracking.components.filter((t) => t.economicKind === "principal" || t.economicKind === "interest" || simKeys.has(t.key));
  const known = new Set(kept.map((t) => t.key));
  const added = sim.components.filter((c) => !known.has(c.key)).map((c): TrackingComponent => ({ key: c.key, economicKind: c.economicKind, label: componentLabel(c.economicKind), destination: "category", categoryId: null }));
  return [...kept, ...added];
}

export type SaveIssue = { field: string; message: string };

/**
 * The save request: calculation from the simulation, Actual choices from
 * tracking. Every simulated offset must be mapped to an Actual account (v38
 * stores an offset only with its account), and a concrete strategy is always
 * sent (the column is required).
 */
export function statesToSaveInput(sim: SimulationState, tracking: TrackingState, budgetSyncId: string, recommendedStrategy: "bench-periodic" | "bench-daily" | null): { ok: true; input: DebtSaveInput } | { ok: false; issues: SaveIssue[] } {
  const issues: SaveIssue[] = [];
  const built = simulationToModel(sim);
  if (!built.ok) return { ok: false, issues: built.missing.map((m) => ({ field: "simulation", message: `Enter the ${m}` })) };
  const { model } = built;
  if (!tracking.name.trim()) issues.push({ field: "name", message: "Give the loan a name" });
  for (const o of sim.offsets) if (!tracking.offsetAccountMap[o.placeholderAccountId]) issues.push({ field: `offset:${o.key}`, message: "Choose the Actual account this offset is" });
  const strategy = tracking.executionStrategy ?? recommendedStrategy;
  if (!strategy) issues.push({ field: "executionStrategy", message: "No Actual Bench calculation engine fits this loan yet" });
  const isTerm = sim.shape === "term-loan" && tracking.direction === "owed-by-me";
  if (tracking.status === "active" && isTerm && !tracking.lenderPattern) issues.push({ field: "lenderPattern", message: "Answer how your lender records interest" });
  if (issues.length) return { ok: false, issues };

  const mapAccount = (id: string | null) => (id ? (tracking.offsetAccountMap[id] ?? id) : null);
  const simComponents = new Map(sim.components.map((c) => [c.key, c]));
  const components = reconcileTrackingComponents(sim, tracking).map((t, order) => {
    const calc = simComponents.get(t.key);
    const principalOrInterest = t.economicKind === "principal" || t.economicKind === "interest";
    return {
      economicKind: t.economicKind,
      label: t.label,
      destination: t.destination,
      categoryId: t.categoryId,
      amountRule: principalOrInterest ? "calculated" : (calc?.amountRule ?? "fixed"),
      fixedAmountMinor: principalOrInterest ? null : (calc?.fixedAmountMinor ?? null),
      treatment: t.economicKind === "fee" ? (calc?.treatment ?? "cash-paid") : null,
      order,
    };
  });
  const behaviorClass: DebtSaveInput["behaviorClass"] = sim.shape === "revolving-credit" ? "revolving-credit" : tracking.direction === "owed-to-me" ? "receivable-loan" : "term-loan";
  const config = {
    format: "rd084.debt-config",
    version: debtConfigVersionFor(model.profile.repaymentDerivation),
    terms: model.terms,
    profile: model.profile,
    phases: model.phases,
    components,
    paymentRecasts: model.profile.recast === "on-contract-date" ? sim.paymentRecasts : [],
    revolving: model.revolving,
  };
  return {
    ok: true,
    input: {
      budgetSyncId,
      name: tracking.name.trim(),
      debtType: tracking.debtType,
      behaviorClass,
      currency: sim.currency,
      currencyMinorDigits: sim.minorDigits,
      liabilityAccountId: tracking.liabilityAccountId,
      paymentAccountId: tracking.paymentAccountId,
      signConvention: tracking.signConvention,
      lenderPattern: behaviorClass === "term-loan" ? tracking.lenderPattern : null,
      executionStrategy: strategy!,
      driftToleranceMinor: tracking.driftToleranceMinor,
      lenderChargeGraceDays: tracking.lenderChargeGraceDays,
      onboardingDate: null,
      loanPaymentCategoryId: tracking.loanPaymentCategoryId,
      drawCategoryId: tracking.drawCategoryId,
      expectedObservationIntervalDays: tracking.expectedObservationIntervalDays,
      status: tracking.status,
      config,
      rates: sim.rates
        .filter((r, i) => i === 0 || r.annualRateDecimal !== null)
        .map((r, i) => ({
          id: r.id ?? null,
          announcedAt: r.announcedAt,
          accrualEffectiveFrom: i === 0 ? sim.startDate : r.accrualEffectiveFrom,
          annualRateDecimal: r.annualRateDecimal!,
          paymentRecalcPolicy: r.paymentRecalcPolicy,
          paymentEffectiveFrom: r.paymentEffectiveFrom,
          rateCapDecimal: r.rateCapDecimal,
          rateFloorDecimal: r.rateFloorDecimal,
          paymentCap: r.paymentCap,
          source: r.source,
          note: r.note,
        })),
      offsets: sim.offsets.map((o) => ({ id: o.key.startsWith("offset:") ? o.key.slice("offset:".length) : null, actualAccountId: mapAccount(o.placeholderAccountId)!, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo, offsetPercentageBps: o.percentageBps, balanceBasis: o.basis, capMinor: o.capMinor, fundScheduledRepayments: o.fundScheduledRepayments, fundScheduledRepaymentsFrom: o.fundScheduledRepaymentsFrom, useActualBalance: o.useActualBalance })),
      assumptions: sim.assumptions.map((a) => ({ id: a.id ?? null, kind: a.kind, effectiveFrom: a.effectiveFrom, recurrence: a.recurrence, amountMinor: a.amountMinor, feeTreatment: a.kind === "fee" ? (a.feeTreatment ?? "cash-paid") : null, offsetAccountId: isOffsetAssumptionKind(a.kind) ? mapAccount(a.offsetAccountId) : null, note: a.note })),
      ...(tracking.changeSummary.trim() ? { changeSummary: tracking.changeSummary.trim() } : {}),
    },
  };
}

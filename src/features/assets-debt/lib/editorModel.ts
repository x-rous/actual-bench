import type { DebtDetail, DebtSaveInput } from "@/lib/assets-debt/services/debtConfigService";
import type { DebtConfigV1 } from "@/lib/financial-models/loan/configSchema";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";
import { fractionToPercent, minorToMajorText, parseFactor, parseMajorToMinor, percentToFraction } from "./money";
import { PROFILE_PRESETS } from "./vocabulary";

/**
 * The loan editor's state and its conversion to a save (RD-084 P1.3).
 *
 * Amounts and rates are held as the text a person typed, and converted
 * exactly on save (./money): the state never holds a float. Server validation
 * issues come back by field path and are shown next to the section they name.
 */

export type RateRow = {
  key: string;
  id: string | null;
  accrualEffectiveFrom: string;
  ratePercent: string;
  paymentRecalcPolicy: string;
  paymentEffectiveFrom: string;
  capKind: "" | "absolute" | "previous-payment-factor";
  capAmount: string;
  capFactor: string;
  rateCapPercent: string;
  rateFloorPercent: string;
  source: string;
  note: string;
};

export type OffsetRow = { key: string; id: string | null; actualAccountId: string; effectiveFrom: string; effectiveTo: string; percent: string; balanceBasis: "total" | "cleared"; cap: string };

export type ComponentRow = { key: string; economicKind: string; label: string; destination: string; categoryId: string; amountRule: string; fixedAmount: string; treatment: string };

export type PhaseRow = { key: string; from: string; to: string; recastAtEnd: string };

export type EditorState = {
  budgetSyncId: string;
  status: "draft" | "active";
  name: string;
  debtType: DebtSaveInput["debtType"];
  behaviorClass: DebtSaveInput["behaviorClass"];
  currency: string;
  currencyMinorDigits: number;
  liabilityAccountId: string;
  paymentAccountId: string;
  signConvention: DebtSaveInput["signConvention"];
  lenderPattern: string;
  executionStrategy: DebtSaveInput["executionStrategy"];
  lenderChargeGraceDays: string;
  driftTolerance: string;
  loanPaymentCategoryId: string;
  drawCategoryId: string;
  expectedObservationIntervalDays: string;
  terms: {
    openingDate: string;
    openingPrincipal: string;
    maturityDate: string;
    contractualTermMonths: string;
    amortizationTermMonths: string;
    contractualPayment: string;
    creditLimit: string;
    firstPaymentDate: string;
    firstInterestChargeDate: string;
  };
  profile: CalculationProfile;
  rates: RateRow[];
  phases: PhaseRow[];
  components: ComponentRow[];
  paymentRecasts: { key: string; date: string; note: string }[];
  offsets: OffsetRow[];
  revolving: DebtConfigV1["revolving"];
  /** Baseline assumptions are edited in the calculator; the editor keeps them unchanged. */
  assumptions: DebtSaveInput["assumptions"];
  changeSummary: string;
};

let keySeq = 0;
export const newKey = () => `row-${++keySeq}`;

export const DEFAULT_PROFILE: CalculationProfile = {
  amortization: "level-payment",
  rateQuote: "nominal-simple-periodic",
  dayCount: "actual-365-fixed",
  accrual: "per-period",
  chargeFrequency: "at-repayment",
  chargeDay: null,
  capitalization: "at-charge",
  repaymentFrequency: "monthly",
  repaymentDerivation: "annuity-at-payment-frequency",
  recast: "on-rate-change",
  rateEffectiveTiming: "on-accrual-effective-date",
  repaymentEffectiveTiming: "transaction-date",
  rounding: { paymentRounding: "half-up", interestPostingRounding: "half-up", intermediateScale: { mode: "full" }, intermediateRounding: "half-even", balancePrecision: "round-each-posting" },
  eventOrder: { timing: "start-of-day" },
  finalPayment: "true-up-to-zero",
  shortMonth: "clamp-to-last-calendar-day",
  negativeAmortizationAllowed: false,
  interestOnlyRepayment: "charged-interest-outstanding",
  presetId: null,
};

export function emptyRate(): RateRow {
  return { key: newKey(), id: null, accrualEffectiveFrom: "", ratePercent: "", paymentRecalcPolicy: "", paymentEffectiveFrom: "", capKind: "", capAmount: "", capFactor: "", rateCapPercent: "", rateFloorPercent: "", source: "", note: "" };
}

export function newDebtState(budgetSyncId: string): EditorState {
  return {
    budgetSyncId,
    status: "draft",
    name: "",
    debtType: "mortgage",
    behaviorClass: "term-loan",
    currency: "USD",
    currencyMinorDigits: 2,
    liabilityAccountId: "",
    paymentAccountId: "",
    signConvention: "negative-is-debt",
    lenderPattern: "separate-interest",
    executionStrategy: "bench-periodic",
    lenderChargeGraceDays: "3",
    driftTolerance: "",
    loanPaymentCategoryId: "",
    drawCategoryId: "",
    expectedObservationIntervalDays: "",
    terms: { openingDate: "", openingPrincipal: "", maturityDate: "", contractualTermMonths: "", amortizationTermMonths: "", contractualPayment: "", creditLimit: "", firstPaymentDate: "", firstInterestChargeDate: "" },
    profile: structuredClone(DEFAULT_PROFILE),
    rates: [emptyRate()],
    phases: [],
    components: [
      { key: newKey(), economicKind: "principal", label: "Principal", destination: "transfer", categoryId: "", amountRule: "calculated", fixedAmount: "", treatment: "" },
      { key: newKey(), economicKind: "interest", label: "Interest", destination: "category", categoryId: "", amountRule: "calculated", fixedAmount: "", treatment: "" },
    ],
    paymentRecasts: [],
    offsets: [],
    revolving: null,
    assumptions: [],
    changeSummary: "",
  };
}

const text = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function stateFromDetail(detail: DebtDetail): EditorState | null {
  if (!detail.config.ok) return null;
  const c = detail.config.config;
  const d = detail.debt;
  const digits = d.currencyMinorDigits;
  const known = <T,>(v: unknown, fallback: T): T => (typeof v === "string" ? (v as T) : fallback);
  return {
    budgetSyncId: d.budgetSyncId,
    status: d.status === "active" ? "active" : "draft",
    name: d.name,
    debtType: known(d.debtType, "other"),
    behaviorClass: known(d.behaviorClass, "term-loan"),
    currency: d.currency,
    currencyMinorDigits: digits,
    liabilityAccountId: d.liabilityAccountId ?? "",
    paymentAccountId: d.paymentAccountId ?? "",
    signConvention: known(d.signConvention, "negative-is-debt"),
    lenderPattern: d.lenderPattern === null ? "" : known(d.lenderPattern, ""),
    executionStrategy: known(d.executionStrategy, "bench-periodic"),
    lenderChargeGraceDays: String(d.lenderChargeGraceDays),
    driftTolerance: minorToMajorText(d.driftToleranceMinor, digits),
    loanPaymentCategoryId: d.loanPaymentCategoryId ?? "",
    drawCategoryId: d.drawCategoryId ?? "",
    expectedObservationIntervalDays: text(d.expectedObservationIntervalDays),
    terms: {
      openingDate: c.terms.openingDate,
      openingPrincipal: minorToMajorText(c.terms.openingPrincipalMinor, digits),
      maturityDate: c.terms.maturityDate ?? "",
      contractualTermMonths: text(c.terms.contractualTermMonths),
      amortizationTermMonths: text(c.terms.amortizationTermMonths),
      contractualPayment: minorToMajorText(c.terms.contractualPaymentMinor, digits),
      creditLimit: minorToMajorText(c.terms.creditLimitMinor, digits),
      firstPaymentDate: c.terms.firstPaymentDate ?? "",
      firstInterestChargeDate: c.terms.firstInterestChargeDate ?? "",
    },
    profile: c.profile as CalculationProfile,
    rates: detail.rates.map((r) => ({
      key: newKey(),
      id: r.id,
      accrualEffectiveFrom: r.accrualEffectiveFrom,
      ratePercent: fractionToPercent(r.annualRateDecimal),
      paymentRecalcPolicy: typeof r.paymentRecalcPolicy === "string" ? r.paymentRecalcPolicy : "",
      paymentEffectiveFrom: r.paymentEffectiveFrom ?? "",
      capKind: r.paymentCap?.kind === "absolute" || r.paymentCap?.kind === "previous-payment-factor" ? r.paymentCap.kind : "",
      capAmount: r.paymentCap?.kind === "absolute" ? minorToMajorText(r.paymentCap.amountMinor, digits) : "",
      capFactor: r.paymentCap?.kind === "previous-payment-factor" ? r.paymentCap.factor : "",
      rateCapPercent: fractionToPercent(r.rateCapDecimal),
      rateFloorPercent: fractionToPercent(r.rateFloorDecimal),
      source: r.source ?? "",
      note: r.note ?? "",
    })),
    phases: c.phases.map((p) => ({ key: newKey(), from: p.from, to: p.to, recastAtEnd: p.recastAtEnd })),
    components: c.components.map((x) => ({ key: newKey(), economicKind: x.economicKind, label: x.label, destination: x.destination, categoryId: x.categoryId ?? "", amountRule: x.amountRule, fixedAmount: minorToMajorText(x.fixedAmountMinor, digits), treatment: x.treatment ?? "" })),
    paymentRecasts: c.paymentRecasts.map((r) => ({ key: newKey(), date: r.date, note: r.note ?? "" })),
    offsets: detail.offsets.map((o) => ({
      key: newKey(),
      id: o.id,
      actualAccountId: o.actualAccountId,
      effectiveFrom: o.effectiveFrom,
      effectiveTo: o.effectiveTo ?? "",
      percent: fractionToPercent(bpsToFraction(o.offsetPercentageBps)),
      balanceBasis: o.balanceBasis === "cleared" ? "cleared" : "total",
      cap: minorToMajorText(o.capMinor, digits),
    })),
    revolving: c.revolving,
    assumptions: detail.assumptions.map((a) => ({
      id: a.id,
      kind: a.assumptionKind as DebtSaveInput["assumptions"][number]["kind"],
      effectiveFrom: a.effectiveFrom,
      recurrence: a.recurrence && !("unknown" in a.recurrence) ? a.recurrence : null,
      amountMinor: a.amountMinor ?? 0,
      feeTreatment: (a.feeTreatment as "cash-paid" | "capitalized" | null) ?? null,
      offsetAccountId: a.offsetAccountId,
      note: a.note,
    })),
    changeSummary: "",
  };
}

/** 10000 bps → "1" (100%), 2550 → "0.255", exactly. */
function bpsToFraction(bps: number): string {
  const digits = String(bps).padStart(5, "0");
  const frac = `${digits.slice(-4)}`.replace(/0+$/, "");
  const whole = digits.slice(0, -4).replace(/^0+(?=\d)/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** "100" (percent) → 10000 bps; at most two decimal places. */
function percentToBps(textValue: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(textValue.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

export type EditorIssue = { field: string; message: string };

/** Build the save request, or the client-side problems that stop it. */
export function toSaveInput(state: EditorState): { ok: true; input: DebtSaveInput } | { ok: false; issues: EditorIssue[] } {
  const issues: EditorIssue[] = [];
  const digits = state.currencyMinorDigits;
  const money = (value: string, field: string) => {
    const r = parseMajorToMinor(value, digits);
    if (!r.ok) issues.push({ field, message: r.message });
    return r.ok ? r.value : null;
  };
  const int = (value: string, field: string) => {
    if (value.trim() === "") return null;
    if (!/^\d+$/.test(value.trim())) {
      issues.push({ field, message: "Enter a whole number" });
      return null;
    }
    return Number(value);
  };
  const percent = (value: string, field: string) => {
    const r = percentToFraction(value);
    if (!r.ok) issues.push({ field, message: r.message });
    return r.ok ? r.value : null;
  };

  const terms = {
    openingDate: state.terms.openingDate,
    openingPrincipalMinor: money(state.terms.openingPrincipal, "config.terms.openingPrincipalMinor") ?? 0,
    maturityDate: state.terms.maturityDate || null,
    contractualTermMonths: int(state.terms.contractualTermMonths, "config.terms.contractualTermMonths"),
    amortizationTermMonths: int(state.terms.amortizationTermMonths, "config.terms.amortizationTermMonths"),
    contractualPaymentMinor: money(state.terms.contractualPayment, "config.terms.contractualPaymentMinor"),
    creditLimitMinor: money(state.terms.creditLimit, "config.terms.creditLimitMinor"),
    firstPaymentDate: state.terms.firstPaymentDate || null,
    firstInterestChargeDate: state.terms.firstInterestChargeDate || null,
  };
  if (!state.terms.openingDate) issues.push({ field: "config.terms.openingDate", message: "Enter the date the loan started" });

  const rates = state.rates.map((r, i) => {
    const f = (name: string) => `rates.${i}.${name}`;
    const annual = percent(r.ratePercent, f("annualRateDecimal"));
    if (annual === null && !issues.some((x) => x.field === f("annualRateDecimal"))) issues.push({ field: f("annualRateDecimal"), message: "Enter the annual rate" });
    let paymentCap: DebtSaveInput["rates"][number]["paymentCap"] = null;
    if (r.capKind === "absolute") {
      const amount = money(r.capAmount, f("paymentCap.amountMinor"));
      if (amount !== null) paymentCap = { kind: "absolute", amountMinor: amount };
    } else if (r.capKind === "previous-payment-factor") {
      const factor = parseFactor(r.capFactor);
      if (!factor.ok) issues.push({ field: f("paymentCap.factor"), message: factor.message });
      else if (factor.value !== null) paymentCap = { kind: "previous-payment-factor", factor: factor.value };
    }
    return {
      id: r.id,
      announcedAt: null,
      accrualEffectiveFrom: r.accrualEffectiveFrom,
      annualRateDecimal: annual ?? "0",
      paymentRecalcPolicy: r.paymentRecalcPolicy || null,
      paymentEffectiveFrom: r.paymentEffectiveFrom || null,
      rateCapDecimal: percent(r.rateCapPercent, f("rateCapDecimal")),
      rateFloorDecimal: percent(r.rateFloorPercent, f("rateFloorDecimal")),
      paymentCap,
      source: r.source || null,
      note: r.note || null,
    };
  });

  const offsets = state.offsets.map((o, i) => {
    const bps = percentToBps(o.percent);
    if (bps === null) issues.push({ field: `offsets.${i}.offsetPercentageBps`, message: "Enter a percentage such as 100" });
    return { id: o.id, actualAccountId: o.actualAccountId, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo || null, offsetPercentageBps: bps ?? 0, balanceBasis: o.balanceBasis, capMinor: money(o.cap, `offsets.${i}.capMinor`) };
  });

  const components = state.components.map((x, i) => ({
    economicKind: x.economicKind,
    label: x.label,
    destination: x.destination,
    categoryId: x.categoryId || null,
    amountRule: x.amountRule,
    fixedAmountMinor: x.amountRule === "fixed" ? money(x.fixedAmount, `config.components.${i}.fixedAmountMinor`) : null,
    treatment: x.economicKind === "fee" ? x.treatment || null : null,
    order: i,
  }));

  const config = {
    format: "rd084.debt-config",
    version: 1,
    terms,
    profile: state.profile,
    phases: state.phases.map((p) => ({ kind: "interest-only", from: p.from, to: p.to, recastAtEnd: p.recastAtEnd })),
    components,
    paymentRecasts: state.paymentRecasts.map((r) => ({ date: r.date, note: r.note || null })),
    revolving: state.revolving,
  };

  const input: DebtSaveInput = {
    budgetSyncId: state.budgetSyncId,
    name: state.name,
    debtType: state.debtType,
    behaviorClass: state.behaviorClass,
    currency: state.currency.trim().toUpperCase(),
    currencyMinorDigits: state.currencyMinorDigits,
    liabilityAccountId: state.liabilityAccountId || null,
    paymentAccountId: state.paymentAccountId || null,
    signConvention: state.signConvention,
    lenderPattern: state.behaviorClass === "term-loan" ? ((state.lenderPattern || null) as DebtSaveInput["lenderPattern"]) : null,
    executionStrategy: state.executionStrategy,
    driftToleranceMinor: money(state.driftTolerance, "driftToleranceMinor"),
    lenderChargeGraceDays: int(state.lenderChargeGraceDays, "lenderChargeGraceDays") ?? 0,
    onboardingDate: null,
    loanPaymentCategoryId: state.loanPaymentCategoryId || null,
    drawCategoryId: state.drawCategoryId || null,
    expectedObservationIntervalDays: int(state.expectedObservationIntervalDays, "expectedObservationIntervalDays"),
    status: state.status,
    config,
    rates,
    offsets,
    assumptions: state.assumptions,
    ...(state.changeSummary.trim() ? { changeSummary: state.changeSummary.trim() } : {}),
  };
  return issues.length ? { ok: false, issues } : { ok: true, input };
}

/** Apply a preset: it fills the profile's explicit fields, all of which stay editable. */
export function applyPreset(profile: CalculationProfile, presetId: string): CalculationProfile {
  const preset = PROFILE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return profile;
  return { ...profile, ...preset.profile, presetId: preset.id };
}

/** Which editor section a validation issue belongs to, for showing it in place. */
export function sectionOf(field: string): "basics" | "terms" | "profile" | "repayments" | "components" | "offsets" | "categories" | "other" {
  if (field.startsWith("config.terms")) return "terms";
  if (field.startsWith("config.profile") || field.startsWith("rates")) return "profile";
  if (field.startsWith("config.phases") || field.startsWith("config.paymentRecasts") || field.startsWith("config.revolving")) return "repayments";
  if (field.startsWith("config.components")) return "components";
  if (field.startsWith("offsets") || field.startsWith("assumptions")) return "offsets";
  if (/CategoryId|expectedObservationIntervalDays/.test(field)) return "categories";
  if (/^(name|debtType|behaviorClass|currency|currencyMinorDigits|liabilityAccountId|paymentAccountId|signConvention|lenderPattern|executionStrategy|driftToleranceMinor|lenderChargeGraceDays|status|accountDirectory)/.test(field)) return "basics";
  return "other";
}

import { z } from "zod";
import { isIsoDate, SHORT_MONTH_POLICIES } from "../calendar/dates";
import { SCHEDULE_FREQUENCIES } from "../calendar/schedule";
import { ROUNDING_MODES } from "../money/rounding";
import { isSelectableDayCount } from "./daycount/registry";
import { DAY_COUNT_IDS } from "./daycount/types";
import { EVENT_ORDER_PLACEMENT_KEYS, PLACEMENTS, SAME_DAY_TIMINGS } from "./events";
import {
  ACCRUAL_METHODS,
  AMORTIZATION_METHODS,
  BALANCE_PRECISIONS,
  CAPITALIZATIONS,
  CHARGE_FREQUENCIES,
  FEE_CAPITALIZATIONS,
  FINAL_PAYMENT_POLICIES,
  RATE_EFFECTIVE_TIMINGS,
  RECAST_POLICIES,
  REPAYMENT_EFFECTIVE_TIMINGS,
  checkProfileSupport,
  validateProfile,
  type CalculationProfile,
  type ProfileConflict,
} from "./profile";
import { RATE_QUOTES } from "./rates";
import { REPAYMENT_DERIVATIONS } from "./repayment";

/**
 * The versioned debt configuration JSON, `rd084.debt-config` (data-model
 * `debts.current_config_json`, schema-review A-2, research R-12).
 *
 * Parsing never throws on stored data. It returns one of:
 *
 * - `ok`: a config this build understands, with an internally consistent profile;
 * - `unsupported-config`: a newer format version, an identifier this build does
 *   not know, or a convention it knows but may not calculate with yet (not
 *   selectable). It Blocks only that debt ("configured by a newer version").
 * - `invalid-config`: structurally wrong (missing or mistyped fields);
 * - `inconsistent-profile`: well-formed but contradictory axes (./profile).
 *
 * Adding an identifier that this parser would reject is a new config
 * `version`, never a silent widening of version 1.
 */

export const DEBT_CONFIG_FORMAT = "rd084.debt-config";
export const DEBT_CONFIG_VERSION = 1;
export const SUPPORTED_DEBT_CONFIG_VERSIONS: readonly number[] = [1];

export const ECONOMIC_KINDS = ["principal", "interest", "fee", "escrow", "insurance", "tax", "draw", "other"] as const;
export const COMPONENT_DESTINATIONS = ["transfer", "category", "income-category", "tracking-only"] as const;
export const COMPONENT_AMOUNT_RULES = ["fixed", "calculated", "lender-provided"] as const;
export const REVOLVING_PAYMENT_MODELS = ["fixed-scheduled", "interest-only", "percent-of-balance"] as const;
export const PHASE_KINDS = ["interest-only"] as const;

const enumOf = <T extends string>(values: readonly T[]) => z.enum(values as [T, ...T[]]);
const isoDate = z.string().refine(isIsoDate, "must be an ISO date (YYYY-MM-DD)");
const minor = z.number().int().min(0);

const rounding = z.strictObject({
  paymentRounding: enumOf(ROUNDING_MODES),
  interestPostingRounding: enumOf(ROUNDING_MODES),
  intermediateScale: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("full") }),
    z.strictObject({ mode: z.literal("currency") }),
    z.strictObject({ mode: z.literal("fixed"), places: z.number().int() }),
  ]),
  intermediateRounding: enumOf(ROUNDING_MODES),
  balancePrecision: enumOf(BALANCE_PRECISIONS),
});

const placement = enumOf(PLACEMENTS);

const profile = z.strictObject({
  amortization: enumOf(AMORTIZATION_METHODS),
  rateQuote: enumOf(RATE_QUOTES),
  dayCount: enumOf(DAY_COUNT_IDS),
  accrual: enumOf(ACCRUAL_METHODS),
  chargeFrequency: enumOf(CHARGE_FREQUENCIES),
  chargeDay: z.number().int().nullable(),
  capitalization: enumOf(CAPITALIZATIONS),
  repaymentFrequency: enumOf(SCHEDULE_FREQUENCIES),
  repaymentDerivation: enumOf(REPAYMENT_DERIVATIONS),
  recast: enumOf(RECAST_POLICIES),
  rateEffectiveTiming: enumOf(RATE_EFFECTIVE_TIMINGS),
  repaymentEffectiveTiming: enumOf(REPAYMENT_EFFECTIVE_TIMINGS),
  rounding,
  eventOrder: z.union([
    z.strictObject({ timing: enumOf(SAME_DAY_TIMINGS) }),
    z.strictObject(Object.fromEntries(EVENT_ORDER_PLACEMENT_KEYS.map((k) => [k, placement])) as Record<(typeof EVENT_ORDER_PLACEMENT_KEYS)[number], typeof placement>),
  ]),
  finalPayment: enumOf(FINAL_PAYMENT_POLICIES),
  shortMonth: enumOf(SHORT_MONTH_POLICIES),
  negativeAmortizationAllowed: z.boolean(),
  feeCapitalization: enumOf(FEE_CAPITALIZATIONS),
  presetId: z.string().min(1).nullable(),
});

const terms = z.strictObject({
  openingDate: isoDate,
  openingPrincipalMinor: minor,
  maturityDate: isoDate.nullable(),
  contractualTermMonths: z.number().int().positive().nullable(),
  amortizationTermMonths: z.number().int().positive().nullable(),
  contractualPaymentMinor: minor.nullable(),
  creditLimitMinor: minor.nullable(),
  firstPaymentDate: isoDate.nullable(),
  firstInterestChargeDate: isoDate.nullable(),
});

const phase = z.strictObject({
  kind: enumOf(PHASE_KINDS),
  from: isoDate,
  to: isoDate,
  recastAtEnd: enumOf(RECAST_POLICIES),
});

const component = z.strictObject({
  economicKind: enumOf(ECONOMIC_KINDS),
  label: z.string().min(1),
  destination: enumOf(COMPONENT_DESTINATIONS),
  categoryId: z.string().min(1).nullable(),
  amountRule: enumOf(COMPONENT_AMOUNT_RULES),
  fixedAmountMinor: minor.nullable(),
  order: z.number().int().min(0),
});

const revolving = z.strictObject({
  paymentModel: enumOf(REVOLVING_PAYMENT_MODELS),
  percentOfBalanceBps: z.number().int().min(1).max(10_000).nullable(),
  minimumFloorMinor: minor.nullable(),
});

const debtConfigV1 = z.strictObject({
  format: z.literal(DEBT_CONFIG_FORMAT),
  version: z.literal(1),
  terms,
  profile,
  phases: z.array(phase),
  components: z.array(component),
  revolving: revolving.nullable(),
});

export type DebtConfigV1 = z.infer<typeof debtConfigV1>;

export type DebtConfigParse =
  | { ok: true; config: DebtConfigV1 }
  | { ok: false; code: "unsupported-config"; issues: string[] }
  | { ok: false; code: "invalid-config"; issues: string[] }
  | { ok: false; code: "inconsistent-profile"; issues: string[]; conflicts: ProfileConflict[] };

const where = (path: PropertyKey[]) => (path.length ? path.map(String).join(".") : "(root)");

/** Parse stored config JSON (a string or an already-parsed value). Never throws. */
export function parseDebtConfig(raw: unknown): DebtConfigParse {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, code: "invalid-config", issues: ["(root): not valid JSON"] };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, code: "invalid-config", issues: ["(root): expected an object"] };
  }
  const { format, version } = value as { format?: unknown; version?: unknown };
  if (format !== DEBT_CONFIG_FORMAT) {
    return { ok: false, code: "unsupported-config", issues: [`format: ${JSON.stringify(format)} is not ${DEBT_CONFIG_FORMAT}`] };
  }
  if (typeof version !== "number" || !SUPPORTED_DEBT_CONFIG_VERSIONS.includes(version)) {
    return { ok: false, code: "unsupported-config", issues: [`version: ${JSON.stringify(version)} is not supported by this build`] };
  }

  const parsed = debtConfigV1.safeParse(value);
  if (!parsed.success) {
    // An enum value this build does not know is an identifier from a newer
    // build, not a typo in structure: that is unsupported, not invalid.
    const unknownIds = parsed.error.issues.filter((i) => i.code === "invalid_value");
    if (unknownIds.length > 0) {
      return { ok: false, code: "unsupported-config", issues: unknownIds.map((i) => `${where(i.path)}: ${i.message}`) };
    }
    return { ok: false, code: "invalid-config", issues: parsed.error.issues.map((i) => `${where(i.path)}: ${i.message}`) };
  }

  const config = parsed.data;
  if (!isSelectableDayCount(config.profile.dayCount)) {
    return {
      ok: false,
      code: "unsupported-config",
      issues: [`profile.dayCount: ${config.profile.dayCount} is not available in this build`],
    };
  }

  const check = validateProfile(config.profile as CalculationProfile);
  if (!check.ok) {
    return {
      ok: false,
      code: "inconsistent-profile",
      issues: check.conflicts.map((c) => `${c.axes.join(" + ")}: ${c.message}`),
      conflicts: check.conflicts,
    };
  }
  const support = checkProfileSupport(config.profile as CalculationProfile);
  if (!support.ok) {
    return {
      ok: false,
      code: "unsupported-config",
      issues: support.conflicts.map((c) => `${c.axes.join(" + ")}: ${c.message}`),
    };
  }

  return { ok: true, config };
}

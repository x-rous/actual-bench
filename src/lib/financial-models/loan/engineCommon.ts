import { businessDayProblem, isActiveConvention } from "../calendar/businessDays";
import { compareDates, parseIsoDate, type IsoDate, type ShortMonthPolicy } from "../calendar/dates";
import type { ScheduleFrequency, ScheduleSpec } from "../calendar/schedule";
import { dec, max, min, type Dec } from "../money/kernel";
import { MONEY_KERNEL_VERSION } from "../money/kernel";
import { selectableDayCount } from "./daycount/registry";
import type { DayCountConvention } from "./daycount/types";
import type { BlockReason, LoanModelSnapshot, ModelEvent, PeriodSummary } from "./model";
import { validatePhases } from "./phases";
import { checkProfileSupport, validateProfile } from "./profile";
import { recastScheduleConflict } from "./configSchema";
import type { RatePeriod } from "./rates";
import { CURRENT_COMPONENT_VERSIONS, type ComponentVersion, type EngineVersions } from "./versions";

/** Shared by the periodic and daily engines. Pure. */

export function engineVersions(
  engine: "loan-periodic" | "loan-daily",
  model: LoanModelSnapshot,
  overrides: Partial<Record<"engine" | "repayment" | "recast" | "eventOrder", ComponentVersion>> & { offsets?: ComponentVersion | null } = {}
): EngineVersions {
  const dc = selectableDayCount(model.profile.dayCount);
  return {
    engine: overrides.engine ?? (engine === "loan-periodic" ? CURRENT_COMPONENT_VERSIONS["loan-periodic"] : CURRENT_COMPONENT_VERSIONS["loan-daily"]),
    "money-kernel": MONEY_KERNEL_VERSION,
    ...(dc ? { daycount: dc.version } : {}),
    "rate-quote": CURRENT_COMPONENT_VERSIONS["rate-quote"],
    "event-order": overrides.eventOrder ?? CURRENT_COMPONENT_VERSIONS["event-order"],
    ...(engine === "loan-daily" && overrides.offsets !== null ? { offsets: overrides.offsets ?? CURRENT_COMPONENT_VERSIONS.offsets } : {}),
    repayment: overrides.repayment ?? CURRENT_COMPONENT_VERSIONS.repayment,
    recast: overrides.recast ?? CURRENT_COMPONENT_VERSIONS.recast,
    allocation: CURRENT_COMPONENT_VERSIONS.allocation,
    "final-payment": CURRENT_COMPONENT_VERSIONS["final-payment"],
    ...(isActiveConvention(model.businessDays) ? { "business-days": CURRENT_COMPONENT_VERSIONS["business-days"] } : {}),
  };
}

/** Checks every engine runs before simulating; the first failure blocks. */
export function validateModel(model: LoanModelSnapshot): BlockReason | null {
  const invalid = validateProfile(model.profile);
  if (!invalid.ok) return { code: "inconsistent-profile", classification: "blocked", date: null, message: invalid.conflicts.map((c) => c.message).join(" ") };
  const unsupported = checkProfileSupport(model.profile);
  if (!unsupported.ok) return { code: "unsupported-profile", classification: "blocked", date: null, message: unsupported.conflicts.map((c) => c.message).join(" ") };
  if (!selectableDayCount(model.profile.dayCount)) {
    return { code: "unsupported-profile", classification: "blocked", date: null, message: `Day count ${model.profile.dayCount} is not available.` };
  }
  const phaseProblem = validatePhases(model.phases);
  if (phaseProblem) return { code: "inconsistent-profile", classification: "blocked", date: null, message: phaseProblem };
  const recast = recastScheduleConflict(model.profile.recast, model.paymentRecasts.length);
  if (recast) return { code: "inconsistent-profile", classification: "blocked", date: null, message: recast.message };
  if (isActiveConvention(model.businessDays)) {
    const problem = businessDayProblem(model.businessDays);
    if (problem) return { code: "inconsistent-profile", classification: "blocked", date: null, message: problem.message };
    if (model.profile.accrual === "per-period") return { code: "unsupported-profile", classification: "blocked", date: null, message: "Business-day adjustment of scheduled dates needs daily accrual." };
  }
  return null;
}

export function dayCountOf(model: LoanModelSnapshot): DayCountConvention {
  const dc = selectableDayCount(model.profile.dayCount);
  if (!dc) throw new Error("validateModel must run first");
  return dc;
}

/**
 * Effective-dated rate lookup, sorted once. `rateOn(date)` is the rate
 * accruing on `date` within its cap and floor, or null in a rate gap.
 */
export function rateTable(periods: readonly RatePeriod[]): { rateOn(date: IsoDate): Dec | null; changes: RatePeriod[] } {
  const sorted = [...periods].sort((a, b) => compareDates(a.accrualEffectiveFrom, b.accrualEffectiveFrom));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].accrualEffectiveFrom === sorted[i - 1].accrualEffectiveFrom) throw new RangeError(`Two rates take effect on ${sorted[i].accrualEffectiveFrom}`);
  }
  const effective = sorted.map((p) => {
    let rate = dec(p.annualRateDecimal);
    if (p.rateFloorDecimal) rate = max(rate, dec(p.rateFloorDecimal));
    if (p.rateCapDecimal) rate = min(rate, dec(p.rateCapDecimal));
    return rate;
  });
  return {
    changes: sorted,
    rateOn(date) {
      let found: Dec | null = null;
      for (let i = 0; i < sorted.length && compareDates(sorted[i].accrualEffectiveFrom, date) <= 0; i++) found = effective[i];
      return found;
    },
  };
}

/** Whole calendar months from `a` to `b` (floor): 31 Jan → 29 Feb is 0, → 29 Mar is 1... */
export function wholeMonthsBetween(a: IsoDate, b: IsoDate): number {
  const x = parseIsoDate(a);
  const y = parseIsoDate(b);
  return (y.year - x.year) * 12 + (y.month - x.month) - (y.day < x.day ? 1 : 0);
}

const REPAYMENT_TYPES = new Set(["repayment", "extra-repayment", "final-payment", "balloon"]);

/** Calendar-month summaries of simulated events (FR-112). */
export function monthlySummaries(events: readonly ModelEvent[], openingMinor: number): PeriodSummary[] {
  const out: PeriodSummary[] = [];
  let current: PeriodSummary | null = null;
  let balance = openingMinor;
  for (const e of events) {
    const period = e.date.slice(0, 7);
    if (!current || current.period !== period) {
      if (current) out.push(current);
      current = { period, from: `${period}-01`, to: e.date, openingMinor: balance, interestMinor: 0, feesMinor: 0, repaidMinor: 0, drawnMinor: 0, closingMinor: balance };
    }
    current.to = e.date;
    current.interestMinor += e.interestMinor;
    current.feesMinor += e.feesMinor;
    if (REPAYMENT_TYPES.has(e.type)) current.repaidMinor += -e.cashMovementMinor - (e.type === "fee" ? 0 : e.feesMinor);
    if (e.type === "draw") current.drawnMinor += e.principalMovementMinor;
    balance = e.balanceAfterMinor;
    current.closingMinor = balance;
  }
  if (current) out.push(current);
  return out;
}

/** A schedule spec for a generated repayment frequency, or null for one config v1 cannot generate. */
export function repaymentScheduleSpec(frequency: ScheduleFrequency, firstDate: IsoDate, policy: ShortMonthPolicy): ScheduleSpec | null {
  switch (frequency) {
    case "weekly":
    case "fortnightly":
      return { frequency, firstDate };
    case "monthly":
    case "quarterly":
    case "annual":
      return { frequency, firstDate, shortMonthPolicy: policy };
    default:
      return null;
  }
}

import type { IsoDate } from "../calendar/dates";
import type { RoundingMode } from "../money/rounding";
import { selectableDayCounts } from "./daycount/registry";
import type { DayCountId } from "./daycount/types";
import type { SameDayTiming } from "./events";
import type { SimulationRequest } from "./model";
import { simulate } from "./projection";

/**
 * The convention diagnostic (FR-093): when the model and a lender statement
 * disagree, which compatible convention would have matched?
 *
 * It re-runs the same request under alternative conventions and reports each
 * result and its difference from the observation, closest first, as evidence
 * for review. It returns no configuration and changes none: accepting a
 * different convention is a reviewed configuration change elsewhere.
 */

export const DIAGNOSTICS_VERSION = "diagnostics@1";

export type ConventionVariant = { dayCount: DayCountId; timing: SameDayTiming | "as-configured"; interestPostingRounding: RoundingMode };

export type ConventionCandidate = {
  variant: ConventionVariant;
  isCurrent: boolean;
  ok: boolean;
  principalMinor: number | null;
  differenceMinor: number | null;
};

export function diagnoseConventions(req: SimulationRequest, observed: { date: IsoDate; principalMinor: number }): ConventionCandidate[] {
  const { profile } = req.model;
  const daily = profile.accrual !== "per-period";
  const dayCounts: DayCountId[] = daily ? selectableDayCounts() : [profile.dayCount];
  const timings: ConventionVariant["timing"][] = daily ? ["as-configured", "start-of-day", "end-of-day"] : ["as-configured"];
  const roundings: RoundingMode[] = ["half-up", "half-even", "down"];

  const candidates: ConventionCandidate[] = [];
  const seen = new Set<string>();
  for (const dayCount of dayCounts) {
    for (const timing of timings) {
      for (const interestPostingRounding of roundings) {
        const variant: ConventionVariant = { dayCount, timing, interestPostingRounding };
        const eventOrder = timing === "as-configured" ? profile.eventOrder : { timing };
        const key = JSON.stringify([dayCount, eventOrder, interestPostingRounding]);
        if (seen.has(key)) continue;
        seen.add(key);
        const model = { ...req.model, profile: { ...profile, dayCount, eventOrder, rounding: { ...profile.rounding, interestPostingRounding } } };
        const result = simulate({ ...req, model, to: observed.date });
        const principal = result.ok ? result.closing.principalMinor : null;
        candidates.push({
          variant,
          isCurrent: dayCount === profile.dayCount && timing === "as-configured" && interestPostingRounding === profile.rounding.interestPostingRounding,
          ok: result.ok,
          principalMinor: principal,
          differenceMinor: principal === null ? null : principal - observed.principalMinor,
        });
      }
    }
  }
  const rank = (c: ConventionCandidate) => (c.differenceMinor === null ? Number.POSITIVE_INFINITY : Math.abs(c.differenceMinor));
  return candidates.sort((a, b) => rank(a) - rank(b) || Number(b.isCurrent) - Number(a.isCurrent));
}

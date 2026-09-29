import { compareDates, type IsoDate } from "../calendar/dates";
import type { DebtPhase } from "./model";

/**
 * Interest-only phases (FR-058, owner decision 2026-09-29).
 *
 * Interest-only is a phase of the loan, never an amortization method. A phase
 * covers its dates inclusively: a scheduled repayment dated within [from, to]
 * pays interest only, and the first repayment after `to` is recast according
 * to the phase's `recastAtEnd`. A whole-term interest-only loan is one phase
 * over the contractual term; its principal is settled by the final-payment
 * policy (normally `contractual-balloon`).
 */

export const PHASES_VERSION = "phases@1";

export function validatePhases(phases: readonly DebtPhase[]): string | null {
  const sorted = [...phases].sort((a, b) => compareDates(a.from, b.from));
  for (let i = 0; i < sorted.length; i++) {
    if (compareDates(sorted[i].from, sorted[i].to) > 0) return `An interest-only phase ends before it starts (${sorted[i].from} to ${sorted[i].to}).`;
    if (i > 0 && compareDates(sorted[i].from, sorted[i - 1].to) <= 0) return `Interest-only phases overlap (${sorted[i - 1].to} and ${sorted[i].from}).`;
  }
  return null;
}

/** The interest-only phase covering `date`, if any. */
export function interestOnlyPhaseOn(phases: readonly DebtPhase[], date: IsoDate): DebtPhase | null {
  return phases.find((p) => compareDates(p.from, date) <= 0 && compareDates(date, p.to) <= 0) ?? null;
}

/** The phase that ended most recently before `date` (strictly), for end-of-phase recasts. */
export function phaseEndedBefore(phases: readonly DebtPhase[], date: IsoDate, notBefore: IsoDate): DebtPhase | null {
  return phases.find((p) => compareDates(p.to, date) < 0 && compareDates(p.to, notBefore) >= 0) ?? null;
}

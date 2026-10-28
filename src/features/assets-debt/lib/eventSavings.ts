import type { Headline } from "./results";
import { extraTransactions, type SimAssumption, type SimulationState } from "./simulatorModel";
import { formatAmount } from "./money";

/**
 * What each event in Terms & Schedule saves (owner decision 2026-10-28, option 1: in date order). Events are added one
 * at a time in the order of their first date; each is credited with what it changes on top of the ones before it, so
 * the rows add up exactly to the group's total. A repeating event is one row: it is credited with all its occurrences.
 *
 * Pure: building the chain of simulations and comparing results. Running them is `useEventSavings`.
 */

/** What one event changed: positive interest and days mean saved; negative means added (a draw, a fee). */
export type Saving = {
  interestMinor: number;
  /** Payoff moved earlier by this many days (negative: later); null when either run is not paid off. */
  payoffDays: number | null;
  /** The regular repayment fell by this much (a loan that recalculates its repayment); 0 when unchanged. */
  repaymentMinor: number;
};

export function savingBetween(before: Headline, after: Headline): Saving {
  const payoffDays = before.payoffDate && after.payoffDate
    ? Math.round((Date.parse(`${before.payoffDate}T00:00:00Z`) - Date.parse(`${after.payoffDate}T00:00:00Z`)) / 86_400_000)
    : null;
  const repaymentMinor = before.regularRepaymentMinor !== null && after.regularRepaymentMinor !== null ? before.regularRepaymentMinor - after.regularRepaymentMinor : 0;
  return { interestMinor: before.totalInterestMinor - after.totalInterestMinor, payoffDays, repaymentMinor };
}

const MONTH_DAYS = 30.4375;

function span(days: number): string {
  const months = Math.round(Math.abs(days) / MONTH_DAYS);
  if (months === 0) return "under 1 mo";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return years ? `${years} yr${rest ? ` ${rest} mo` : ""}` : `${rest} mo`;
}

/** One cell: "1,862.40 · 1 mo", "adds 1,240.00 · 2 mo", "1,240.00 · repayment −52.10", or "No change". */
export function formatSaving(s: Saving, digits: number): string {
  const parts: string[] = [];
  if (s.interestMinor > 0) parts.push(formatAmount(s.interestMinor, digits));
  else if (s.interestMinor < 0) parts.push(`adds ${formatAmount(-s.interestMinor, digits)}`);
  if (s.payoffDays) parts.push(s.payoffDays > 0 ? span(s.payoffDays) : `${span(s.payoffDays)} later`);
  else if (s.repaymentMinor) parts.push(`repayment ${s.repaymentMinor > 0 ? "−" : "+"}${formatAmount(Math.abs(s.repaymentMinor), digits)}`);
  return parts.length ? parts.join(" · ") : "No change";
}

/** Each simulation in the chain: the base, then with the first 1, 2, … events added. Index k holds k events. */
export function chainOf(base: SimulationState, events: readonly SimAssumption[]): SimulationState[] {
  return events.map((_, k) => ({ ...base, assumptions: [...base.assumptions, ...events.slice(0, k + 1)] }));
}

/** The order events are credited in: first date, then the order they were added. */
export function inCreditOrder<T extends { effectiveFrom: string }>(events: readonly T[]): T[] {
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.effectiveFrom.localeCompare(b.e.effectiveFrom) || a.i - b.i).map(({ e }) => e);
}

/** The what-ifs a projection includes, in credit order, and the simulation without them. */
export function whatIfChain(sim: SimulationState, anchorDate: string | null): { base: SimulationState; events: SimAssumption[] } {
  const extras = new Set(extraTransactions(sim).map((a) => a.key));
  const included = (a: SimAssumption) => extras.has(a.key) && a.enabled !== false && (anchorDate === null || a.effectiveFrom > anchorDate);
  return { base: { ...sim, assumptions: sim.assumptions.filter((a) => !extras.has(a.key)) }, events: inCreditOrder(sim.assumptions.filter(included)) };
}

export type LedgerEvent = { date: string; kind: "extra-principal" | "draw" | "fee" | "interest-charged" | "adjustment"; amountMinor: number; rowId: string };

/**
 * What really happened, as events on the contract: extra principal, draws and fees from the Loan Ledger, in date order.
 * Charged interest and adjustments are not events a person chose, so they are not credited.
 */
export function ledgerChain(sim: SimulationState, startDate: string, ledger: readonly LedgerEvent[]): { base: SimulationState; events: (SimAssumption & { rowId: string })[] } {
  const base = { ...sim, assumptions: sim.assumptions.filter((a) => a.effectiveFrom < startDate) };
  const events = inCreditOrder(ledger.flatMap((l): (SimAssumption & { rowId: string })[] => {
    const common = { key: `ledger:${l.rowId}`, rowId: l.rowId, effectiveFrom: l.date, recurrence: null, amountMinor: l.amountMinor, offsetAccountId: null, note: null };
    if (l.kind === "extra-principal") return [{ ...common, kind: "extra-repayment", feeTreatment: null }];
    if (l.kind === "draw") return [{ ...common, kind: "draw", feeTreatment: null }];
    if (l.kind === "fee") return [{ ...common, kind: "fee", feeTreatment: "capitalized" }];
    return [];
  }));
  return { base, events };
}

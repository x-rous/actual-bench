import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import type { TrackingResult } from "@/lib/assets-debt/tracking/plan";

/**
 * Terms & Schedule for a loan tracked in Actual (design spec 06 §5.7, §7.6). The calculation has three parts:
 * - before the tracking start: the contract (and the events entered for that time);
 * - from the tracking start to today: what really happened, from the Loan Ledger (this module);
 * - after today: the contract plus the what-ifs that are switched on, projected from today's calculated balance.
 */

export type TrackedHistory = {
  /** The first tracked installment's due date: earlier dates are the contract's. */
  startDate: string;
  today: string;
  /** Where the projection of the rest of the loan starts. */
  anchor: { date: string; principalMinor: number; scheduledPaymentMinor: number; restartDate: string; accruedInterestMinor: number };
  /** What really happened, as dated engine events (repayments as paid, extra principal, draws, fees). */
  events: DebtProjectionEvent[];
  /** The loan account's own balance (the debt), from the tracking start to today. */
  actual: { date: string; owedMinor: number }[];
  /** How many installments come before the tracking start (they are assumed paid as contracted). 0 when tracking starts at installment 1. */
  installmentsBefore: number;
  /** Installments due by today with no payment found. */
  missingDueDates: string[];
  /** Ledger rows that are events (extra principal, draws, fees), for the Events list. */
  ledgerEvents: { date: string; kind: "extra-principal" | "draw" | "fee" | "interest-charged" | "adjustment"; amountMinor: number; rowId: string; payee: string | null; notes: string | null }[];
};

/** One event of what really happened. `diagnostics.fromActual` lets the chart mark the periods that hold one, in whatever month they fall. */
const event = (date: string, eventType: DebtProjectionEvent["eventType"], fields: Partial<DebtProjectionEvent>): DebtProjectionEvent => ({
  date, eventType, cashMovementMinor: 0, principalMovementMinor: 0, interestMinor: 0, feesMinor: 0, balanceBeforeMinor: 0, balanceAfterMinor: 0,
  certainty: "observed", sourceAccountId: null, debtAccountId: null, categoryAllocations: [], modelRevision: 0, engineVersions: {}, ...fields,
  diagnostics: { ...fields.diagnostics, fromActual: true },
} as DebtProjectionEvent);

export function trackedHistory(result: Extract<TrackingResult, { ok: true }>, startDate: string, today: string): TrackedHistory {
  type Step = { date: string; order: number; apply: (balance: number) => DebtProjectionEvent | null };
  const steps: Step[] = [];
  for (const inst of result.installments) {
    const p = inst.payment;
    if (!p || p.date > today || inst.status === "missing" || inst.status === "upcoming") continue;
    steps.push({ date: p.date, order: 2, apply: (before) => event(p.date, "repayment", { cashMovementMinor: -p.amountMinor, principalMovementMinor: -inst.principalMinor, interestMinor: inst.interestMinor, feesMinor: inst.feesMinor, ...(inst.principalMinor + inst.interestMinor + inst.feesMinor === p.amountMinor ? { lines: [{ kind: "principal", amountMinor: inst.principalMinor }, { kind: "interest", amountMinor: inst.interestMinor }, { kind: "fee", amountMinor: inst.feesMinor }] } : {}), balanceBeforeMinor: before, balanceAfterMinor: before - inst.principalMinor }) });
  }
  for (const e of result.events) {
    if (e.date > today) continue;
    if (e.kind === "extra-principal") steps.push({ date: e.date, order: 1, apply: (before) => event(e.date, "extra-repayment", { cashMovementMinor: -e.amountMinor, principalMovementMinor: -e.amountMinor, balanceBeforeMinor: before, balanceAfterMinor: before - e.amountMinor }) });
    else if (e.kind === "draw") steps.push({ date: e.date, order: 0, apply: (before) => event(e.date, "draw", { cashMovementMinor: e.amountMinor, principalMovementMinor: e.amountMinor, balanceBeforeMinor: before, balanceAfterMinor: before + e.amountMinor }) });
    else if (e.kind === "fee") steps.push({ date: e.date, order: 0, apply: (before) => event(e.date, "fee", { principalMovementMinor: e.amountMinor, feesMinor: e.amountMinor, balanceBeforeMinor: before, balanceAfterMinor: before + e.amountMinor }) });
  }
  steps.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let balance = result.opening.principalMinor;
  const events: DebtProjectionEvent[] = [];
  for (const step of steps) {
    const e = step.apply(balance);
    if (!e) continue;
    balance = e.balanceAfterMinor;
    events.push(e);
  }
  // The loan account's balance by date, from the tracking start (the debt is the negative of the account).
  // It starts at the tracking start, with the account's balance then (an opening balance on that day included).
  const actual: TrackedHistory["actual"] = [];
  const atStart = result.ledger.filter((l) => l.row.date <= startDate).at(-1);
  if (atStart && startDate <= today) actual.push({ date: startDate, owedMinor: -atStart.runningMinor });
  for (const l of result.ledger) {
    if (l.row.date <= startDate || l.row.date > today) continue;
    const owed = -l.runningMinor;
    if (actual.at(-1)?.date === l.row.date) actual[actual.length - 1] = { date: l.row.date, owedMinor: owed };
    else actual.push({ date: l.row.date, owedMinor: owed });
  }
  const last = result.ledger.filter((l) => l.row.date <= today).at(-1);
  if (last && actual.at(-1)?.date !== today) actual.push({ date: today, owedMinor: -last.runningMinor });
  const rows = new Map(result.ledger.map((l) => [l.row.id, l.row]));
  return {
    startDate, today, anchor: result.anchor, events, actual,
    installmentsBefore: result.before.count,
    missingDueDates: result.installments.filter((i) => i.status === "missing").map((i) => i.dueDate),
    ledgerEvents: result.events.map((e) => ({ ...e, payee: rows.get(e.rowId)?.payeeName ?? null, notes: rows.get(e.rowId)?.notes ?? null })),
  };
}

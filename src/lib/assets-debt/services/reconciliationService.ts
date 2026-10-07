import { paidOffState } from "./payoffState";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { getDebt } from "@/lib/app-db/debtRepository";
import { listDebtAssumptions } from "@/lib/app-db/debtAssumptionRepository";
import { getEffectiveDebtAnchor } from "@/lib/app-db/debtAnchorRepository";
import { listCurrentDebtObservations } from "@/lib/app-db/debtObservationRepository";
import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import { compareDebtBalances, debtDriftState, driftFingerprint } from "../classification/drift";
import { reconciliationHealth } from "./health";
import { projectStoredDebt } from "./projectionService";
import type { OffsetHistorySnapshot } from "./offsetHistoryService";
import type { PostingOutputSnapshot } from "./snapshot";

type ReconcileInput = Parameters<typeof reconcileDebt>[1];

/** The calculated balance on a date: as paid from the facts, or the schedule, or 0 once paid off. */
function modelOn(db: SqliteDatabase, input: ReconcileInput, comparisonDate: string) {
  const projected = projectStoredDebt(db, input.debtId, { from: "0001-01-01", to: comparisonDate, resolution: "events", offsetHistories: input.offsetHistories });
  if (!projected.ok) return { ok: false as const, result: projected };
  const projection = projected.projection;
  if (!projection.ok) return { ok: false as const, result: { ok: false as const, blocked: { code: "invalid-config" as const, message: projection.blocked.map((item) => item.message).join(" ") } } };
  const latestEvent = projection.events.at(-1);
  const scheduledMinor = latestEvent?.balanceAfterMinor ?? projected.model.terms.openingPrincipalMinor;
  // T309 "as paid", from the facts: the starting balance (or the latest lender restart), less the
  // principal of every repayment applied or recorded in Actual and every recorded extra payment, plus
  // draws; the schedule continues only after the last of those repayments' due date.
  const applied = asPaidFacts(db, input.debtId, comparisonDate, projected.model.terms);
  // Every payment found in Actual counts, applied or not (owner decision 2026-10-07): when the
  // re-plan found a later one, the calculation follows from the balance after it.
  const observed = input.observed && input.observed.paidDate <= comparisonDate && (!applied || input.observed.paidDate >= applied.paidDate) ? input.observed : null;
  const paid = observed ? observedFacts(db, input.debtId, observed) : applied;
  let modelMinor = scheduledMinor;
  let asPaidFrom: string | null = null;
  const paidOff = paidOffState(db, input.debtId);
  if (paidOff && paidOff.paidDate <= comparisonDate) {
    // Paid off: nothing is owed from that day on, whatever the schedule says.
    modelMinor = 0;
    asPaidFrom = paidOff.paidDate;
  } else if (paid) {
    if (comparisonDate < paid.dueDate) {
      modelMinor = paid.balanceAt(comparisonDate);
    } else {
      const opening = paid.balanceAt(paid.dueDate);
      const fromPaid = projectStoredDebt(db, input.debtId, {
        from: "0001-01-01", to: comparisonDate, resolution: "events", offsetHistories: input.offsetHistories,
        startFrom: { date: paid.dueDate, principalMinor: opening, accruedInterestMinor: 0, carriedRemainder: null },
      });
      if (fromPaid.ok && fromPaid.projection.ok) modelMinor = withoutUnseenRepayments(fromPaid.projection.events, paid.dueDate, opening);
    }
    asPaidFrom = paid.paidDate;
  }
  return { ok: true as const, modelMinor, asPaidFrom, scheduledMinor, paidOff };
}

export function reconcileDebt(db: SqliteDatabase, input: {
  debtId: string; comparisonDate: string; actualBalanceMinor: number; offsetHistories?: OffsetHistorySnapshot[];
  /** The balance after the latest payment the re-plan found in Actual. */
  observed?: { paidDate: string; dueDate: string; principalAfterMinor: number } | null;
  /** The loan account's rows (signed as in Actual), to know Actual's balance on a lender statement's date. */
  loanAccountRows?: ReadonlyArray<{ date: string; amountMinor: number }> | null;
}) {
  const debt = getDebt(db, input.debtId);
  if (!debt) return { ok: false as const, notFound: true as const };
  const today = modelOn(db, input, input.comparisonDate);
  if (!today.ok) return today.result;
  const { modelMinor, asPaidFrom, scheduledMinor, paidOff } = today;
  const observations = listCurrentDebtObservations(db, input.debtId);
  const lenderObservation = observations.find((row) => row.observedOn <= input.comparisonDate) ?? null;
  const lenderMinor = lenderObservation ? lenderObservation.principalMinor + (lenderObservation.accruedInterestMinor ?? 0) : null;
  // A statement older than the comparison date is compared on its own date (owner decision
  // 2026-10-07): a repayment or extra payment made after it is not a difference from the lender.
  let lenderAsOf: { date: string; modelMinor: number; actualMinor: number } | null = null;
  if (lenderObservation && lenderObservation.observedOn < input.comparisonDate) {
    const then = modelOn(db, { ...input, observed: input.observed && input.observed.paidDate <= lenderObservation.observedOn ? input.observed : null }, lenderObservation.observedOn);
    if (then.ok) {
      const negativeIsDebt = debt.signConvention !== "positive-is-debt";
      const actualThen = input.loanAccountRows
        ? (negativeIsDebt ? -1 : 1) * input.loanAccountRows.filter((r) => r.date <= lenderObservation.observedOn).reduce((sum, r) => sum + r.amountMinor, 0)
        // Without the rows: Actual moved since the statement as the calculation did (any gap between
        // them shows as Actual vs calculated anyway).
        : input.actualBalanceMinor + (then.modelMinor - modelMinor);
      lenderAsOf = { date: lenderObservation.observedOn, modelMinor: then.modelMinor, actualMinor: actualThen };
    }
  }
  const comparison = compareDebtBalances({ comparisonDate: input.comparisonDate, modelMinor, actualMinor: input.actualBalanceMinor, lenderMinor, lenderAsOf });
  const fingerprint = driftFingerprint(comparison);
  // Acceptance predating changed evidence is not carried forward. Observation
  // rows are immutable, so createdAt is a reliable boundary.
  const drift = debtDriftState({
    comparison, toleranceMinor: debt.driftToleranceMinor, currentRevision: debt.currentRevision,
    acceptedRevision: debt.driftAcceptedRevision,
    acceptedFingerprint: debt.driftAcceptedFingerprint,
    currentFingerprint: fingerprint,
  });
  const health = reconciliationHealth({ expectedIntervalDays: debt.expectedObservationIntervalDays, graceDays: debt.lenderChargeGraceDays, latestObservationDate: observations[0]?.observedOn ?? null, asOfDate: input.comparisonDate });
  return { ok: true as const, comparison, drift, health, lenderObservation, projectedBalanceVariance: null, fingerprint, scheduledMinor, asPaidFrom, paidOffOn: paidOff?.paidDate ?? null };
}

/**
 * The state after the latest applied repayment split up to the comparison date, when it can stand
 * for "the loan as actually paid": made under the current configuration revision and not older
 * than a lender anchor (an anchor after it already restarts the calculation).
 */
/**
 * The loan as actually paid up to `through`: repayments applied or recorded by Bench (their principal
 * as written in Actual) and one-off extra payments and draws from Terms & Schedule, counted from the
 * latest lender restart or the opening. Null when no repayment has been applied or recorded yet.
 */
/**
 * The balance after the last repayment Actual holds: the schedule's own movements since its due date
 * (rate changes, fees, draws, extra payments), but never a scheduled repayment, because a
 * repayment that has fallen due and is not applied or recorded from Actual was not paid as far as
 * Bench knows. Without this, a loan whose later repayments are missing in Actual would be shown as
 * paid down by the schedule (to zero once its term has passed).
 */
function withoutUnseenRepayments(events: ReadonlyArray<{ date: string; eventType: string; balanceAfterMinor: number }>, dueDate: string, opening: number): number {
  let balance = opening;
  let previous = opening;
  for (const event of events) {
    if (event.date <= dueDate) continue;
    if (event.eventType !== "repayment" && event.eventType !== "final-payment") balance += event.balanceAfterMinor - previous;
    previous = event.balanceAfterMinor;
  }
  return balance;
}

/** As `asPaidFacts`, from the balance after the latest payment found in Actual (extra payments and draws after it still count). */
function observedFacts(db: SqliteDatabase, debtId: string, observed: { paidDate: string; dueDate: string; principalAfterMinor: number }) {
  const oneOffs = listDebtAssumptions(db, debtId).filter((a) => a.recurrence === null && a.effectiveFrom > observed.paidDate);
  const balanceAt = (date: string) => observed.principalAfterMinor
    + oneOffs.filter((a) => a.effectiveFrom <= date).reduce((sum, a) => sum + (a.assumptionKind === "extra-repayment" ? -(a.amountMinor ?? 0) : a.assumptionKind === "draw" ? (a.amountMinor ?? 0) : 0), 0);
  return { paidDate: observed.paidDate, dueDate: observed.dueDate, balanceAt };
}

function asPaidFacts(db: SqliteDatabase, debtId: string, through: string, terms: { openingDate: string; openingPrincipalMinor: number }) {
  const anchor = getEffectiveDebtAnchor(db, debtId);
  const base = anchor ? { date: anchor.anchorDate, principalMinor: anchor.principalMinor } : { date: terms.openingDate, principalMinor: terms.openingPrincipalMinor };
  const repayments: { paidDate: string; dueDate: string; principalMinor: number }[] = [];
  for (const posting of listSubjectPostings(db, "debt", debtId)) {
    if (posting.status !== "applied" || posting.postingKind !== "repayment-split") continue;
    const output = JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot;
    const fact = output.kind === "restructure"
      ? { paidDate: output.before.date, principalMinor: output.components.find((c) => c.kind === "principal")?.amountMinor ?? 0 }
      : (output.kind === "claim" && output.recordedSplit) || output.kind === "adjust-split" ? { paidDate: output.recordedSplit!.parent.date, principalMinor: output.recordedSplit!.principalMinor } : null;
    if (fact && fact.paidDate > base.date && fact.paidDate <= through) repayments.push({ ...fact, dueDate: posting.periodKey });
  }
  if (!repayments.length) return null;
  const last = repayments.reduce((a, b) => (b.paidDate > a.paidDate ? b : a));
  const principalPaid = repayments.reduce((sum, r) => sum + r.principalMinor, 0);
  const oneOffs = listDebtAssumptions(db, debtId).filter((a) => a.recurrence === null && a.effectiveFrom > base.date);
  const balanceAt = (date: string) => base.principalMinor - principalPaid
    + oneOffs.filter((a) => a.effectiveFrom <= date).reduce((sum, a) => sum + (a.assumptionKind === "extra-repayment" ? -(a.amountMinor ?? 0) : a.assumptionKind === "draw" ? (a.amountMinor ?? 0) : 0), 0);
  return { paidDate: last.paidDate, dueDate: last.dueDate, balanceAt };
}

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

export function reconcileDebt(db: SqliteDatabase, input: { debtId: string; comparisonDate: string; actualBalanceMinor: number; offsetHistories?: OffsetHistorySnapshot[] }) {
  const debt = getDebt(db, input.debtId);
  if (!debt) return { ok: false as const, notFound: true as const };
  const projected = projectStoredDebt(db, input.debtId, { from: "0001-01-01", to: input.comparisonDate, resolution: "events", offsetHistories: input.offsetHistories });
  if (!projected.ok) return projected;
  const projection = projected.projection;
  if (!projection.ok) return { ok: false as const, blocked: { code: "invalid-config" as const, message: projection.blocked.map((item) => item.message).join(" ") } };
  const latestEvent = projection.events.at(-1);
  const scheduledMinor = latestEvent?.balanceAfterMinor ?? projected.model.terms.openingPrincipalMinor;
  // T309 "as paid", from the facts: the starting balance (or the latest lender restart), less the
  // principal of every repayment applied or recorded in Actual and every recorded extra payment, plus
  // draws; the schedule continues only after the last of those repayments' due date.
  const paid = asPaidFacts(db, input.debtId, input.comparisonDate, projected.model.terms);
  let modelMinor = scheduledMinor;
  let asPaidFrom: string | null = null;
  if (paid) {
    if (input.comparisonDate < paid.dueDate) {
      modelMinor = paid.balanceAt(input.comparisonDate);
    } else {
      const opening = paid.balanceAt(paid.dueDate);
      const fromPaid = projectStoredDebt(db, input.debtId, {
        from: "0001-01-01", to: input.comparisonDate, resolution: "events", offsetHistories: input.offsetHistories,
        startFrom: { date: paid.dueDate, principalMinor: opening, accruedInterestMinor: 0, carriedRemainder: null },
      });
      if (fromPaid.ok && fromPaid.projection.ok) modelMinor = fromPaid.projection.events.filter((e) => e.date > paid.dueDate).at(-1)?.balanceAfterMinor ?? opening;
    }
    asPaidFrom = paid.paidDate;
  }
  const observations = listCurrentDebtObservations(db, input.debtId);
  const lenderObservation = observations.find((row) => row.observedOn <= input.comparisonDate) ?? null;
  const lenderMinor = lenderObservation ? lenderObservation.principalMinor + (lenderObservation.accruedInterestMinor ?? 0) : null;
  const comparison = compareDebtBalances({ comparisonDate: input.comparisonDate, modelMinor, actualMinor: input.actualBalanceMinor, lenderMinor });
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
  return { ok: true as const, comparison, drift, health, lenderObservation, projectedBalanceVariance: null, fingerprint, scheduledMinor, asPaidFrom };
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
function asPaidFacts(db: SqliteDatabase, debtId: string, through: string, terms: { openingDate: string; openingPrincipalMinor: number }) {
  const anchor = getEffectiveDebtAnchor(db, debtId);
  const base = anchor ? { date: anchor.anchorDate, principalMinor: anchor.principalMinor } : { date: terms.openingDate, principalMinor: terms.openingPrincipalMinor };
  const repayments: { paidDate: string; dueDate: string; principalMinor: number }[] = [];
  for (const posting of listSubjectPostings(db, "debt", debtId)) {
    if (posting.status !== "applied" || posting.postingKind !== "repayment-split") continue;
    const output = JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot;
    const fact = output.kind === "restructure"
      ? { paidDate: output.before.date, principalMinor: output.components.find((c) => c.kind === "principal")?.amountMinor ?? 0 }
      : output.kind === "claim" && output.recordedSplit ? { paidDate: output.recordedSplit.parent.date, principalMinor: output.recordedSplit.principalMinor } : null;
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

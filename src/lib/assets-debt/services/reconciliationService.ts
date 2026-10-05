import type { SqliteDatabase } from "@/lib/app-db/types";
import { getDebt } from "@/lib/app-db/debtRepository";
import { getEffectiveDebtAnchor } from "@/lib/app-db/debtAnchorRepository";
import { listCurrentDebtObservations } from "@/lib/app-db/debtObservationRepository";
import { canonicalJson } from "@/lib/app-db/canonicalJson";
import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import { getModelRevision } from "@/lib/app-db/modelRevisionRepository";
import { compareDebtBalances, debtDriftState, driftFingerprint } from "../classification/drift";
import { reconciliationHealth } from "./health";
import { projectStoredDebt } from "./projectionService";
import type { OffsetHistorySnapshot } from "./offsetHistoryService";
import type { ClosingState, PostingOutputSnapshot } from "./snapshot";

export function reconcileDebt(db: SqliteDatabase, input: { debtId: string; comparisonDate: string; actualBalanceMinor: number; offsetHistories?: OffsetHistorySnapshot[] }) {
  const debt = getDebt(db, input.debtId);
  if (!debt) return { ok: false as const, notFound: true as const };
  const projected = projectStoredDebt(db, input.debtId, { from: "0001-01-01", to: input.comparisonDate, resolution: "events", offsetHistories: input.offsetHistories });
  if (!projected.ok) return projected;
  const projection = projected.projection;
  if (!projection.ok) return { ok: false as const, blocked: { code: "invalid-config" as const, message: projection.blocked.map((item) => item.message).join(" ") } };
  const latestEvent = projection.events.at(-1);
  const scheduledMinor = latestEvent?.balanceAfterMinor ?? projected.model.terms.openingPrincipalMinor;
  // T309 "as paid": from the latest applied repayment split (its closing already uses the actual
  // payment dates and the lender's statement convention), projected on schedule only after it.
  const start = asPaidStart(db, input.debtId, debt.currentRevision, input.comparisonDate);
  let modelMinor = scheduledMinor;
  let asPaidFrom: string | null = null;
  if (start) {
    if (input.comparisonDate < start.dueDate) {
      // Paid early and the due date it covers has not come yet: the balance is the split's closing.
      modelMinor = start.closing.principalMinor;
      asPaidFrom = start.closing.date;
    } else {
      // Continue on schedule after the due date that repayment covered, so it is not scheduled twice.
      const fromPaid = projectStoredDebt(db, input.debtId, {
        from: "0001-01-01", to: input.comparisonDate, resolution: "events", offsetHistories: input.offsetHistories,
        startFrom: { date: start.dueDate, principalMinor: start.closing.principalMinor, accruedInterestMinor: 0, carriedRemainder: start.closing.carriedRemainder },
      });
      if (fromPaid.ok && fromPaid.projection.ok) {
        modelMinor = fromPaid.projection.events.filter((e) => e.date > start.dueDate).at(-1)?.balanceAfterMinor ?? start.closing.principalMinor;
        asPaidFrom = start.closing.date;
      }
    }
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
 * Whether two revisions calculate the same way: a save that changed only the name, accounts,
 * status or other bookkeeping (activation, for one) keeps applied splits usable as "as paid".
 */
function sameCalculation(db: SqliteDatabase, debtId: string, a: number, b: number): boolean {
  if (a === b) return true;
  const calculationOf = (revision: number) => {
    const record = getModelRevision(db, "debt", debtId, revision);
    if (!record) return null;
    const snapshot = JSON.parse(record.configJson) as { debt?: { currencyMinorDigits?: unknown }; config?: unknown; rates?: unknown; offsets?: unknown; assumptions?: unknown };
    return canonicalJson({ digits: snapshot.debt?.currencyMinorDigits ?? null, config: snapshot.config ?? null, rates: snapshot.rates ?? null, offsets: snapshot.offsets ?? null, assumptions: snapshot.assumptions ?? null });
  };
  const first = calculationOf(a);
  return first !== null && first === calculationOf(b);
}

function asPaidStart(db: SqliteDatabase, debtId: string, revision: number, comparisonDate: string): { closing: ClosingState; dueDate: string } | null {
  const anchor = getEffectiveDebtAnchor(db, debtId);
  let best: { closing: ClosingState; dueDate: string } | null = null;
  for (const posting of listSubjectPostings(db, "debt", debtId)) {
    if (posting.status !== "applied" || posting.postingKind !== "repayment-split" || !sameCalculation(db, debtId, posting.configRevision, revision)) continue;
    const output = JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot;
    if (output.kind !== "restructure" || !output.closing || output.closing.date > comparisonDate) continue;
    if (anchor && output.closing.date < anchor.anchorDate) continue;
    if (!best || output.closing.date > best.closing.date) best = { closing: output.closing, dueDate: posting.periodKey };
  }
  return best;
}

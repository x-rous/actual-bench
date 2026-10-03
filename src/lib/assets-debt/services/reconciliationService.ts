import type { SqliteDatabase } from "@/lib/app-db/types";
import { getDebt } from "@/lib/app-db/debtRepository";
import { listCurrentDebtObservations } from "@/lib/app-db/debtObservationRepository";
import { compareDebtBalances, debtDriftState, driftFingerprint } from "../classification/drift";
import { reconciliationHealth } from "./health";
import { projectStoredDebt } from "./projectionService";
import type { OffsetHistorySnapshot } from "./offsetHistoryService";

export function reconcileDebt(db: SqliteDatabase, input: { debtId: string; comparisonDate: string; actualBalanceMinor: number; offsetHistories?: OffsetHistorySnapshot[] }) {
  const debt = getDebt(db, input.debtId);
  if (!debt) return { ok: false as const, notFound: true as const };
  const projected = projectStoredDebt(db, input.debtId, { from: "0001-01-01", to: input.comparisonDate, resolution: "events", offsetHistories: input.offsetHistories });
  if (!projected.ok) return projected;
  const projection = projected.projection;
  if (!projection.ok) return { ok: false as const, blocked: { code: "invalid-config" as const, message: projection.blocked.map((item) => item.message).join(" ") } };
  const latestEvent = projection.events.at(-1);
  const modelMinor = latestEvent?.balanceAfterMinor ?? projected.model.terms.openingPrincipalMinor;
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
  return { ok: true as const, comparison, drift, health, lenderObservation, projectedBalanceVariance: null, fingerprint };
}

import { AppDbValidationError } from "@/lib/app-db/errors";
import { getDebtAnchor, getEffectiveDebtAnchor, insertDebtAnchor, listDebtAnchors } from "@/lib/app-db/debtAnchorRepository";
import { getDebtObservation, listCurrentDebtObservations } from "@/lib/app-db/debtObservationRepository";
import { getDebt } from "@/lib/app-db/debtRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

export function anchorDebtAtObservation(db: SqliteDatabase, debtId: string, observationId: string, carriedRemainderDecimal: string | null = null, now = new Date().toISOString()) {
  const debt = getDebt(db, debtId);
  const observation = getDebtObservation(db, observationId);
  if (!debt) throw new AppDbValidationError("Debt not found");
  if (debt.status === "archived") throw new AppDbValidationError("Archived loans are read-only.");
  if (!observation || observation.debtId !== debtId) throw new AppDbValidationError("Observation not found for this debt");
  if (!listCurrentDebtObservations(db, debtId).some((row) => row.id === observationId)) throw new AppDbValidationError("A superseded observation cannot become an anchor");
  return insertDebtAnchor(db, {
    debtId, anchorDate: observation.observedOn, principalMinor: observation.principalMinor,
    accruedInterestMinor: observation.accruedInterestMinor, carriedRemainderDecimal,
    source: "accepted-observation", observationKind: observation.source, observationId,
    configRevision: debt.currentRevision,
  }, now);
}

export { getDebtAnchor, getEffectiveDebtAnchor, listDebtAnchors };

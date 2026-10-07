import { AppDbValidationError } from "@/lib/app-db/errors";
import { setDebtOnboardingDate } from "@/lib/app-db/debtRepository";
import { getDebtObservation } from "@/lib/app-db/debtObservationRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { anchorDebtAtObservation } from "./anchorService";

/** Records a read-only opening anchor; P1.6 owns any resulting adjustment proposal. */
export function onboardDebtFromObservation(db: SqliteDatabase, input: { debtId: string; observationId: string; modelPrincipalMinor: number }, now = new Date().toISOString()) {
  const observation = getDebtObservation(db, input.observationId);
  if (!observation || observation.debtId !== input.debtId) throw new AppDbValidationError("Observation not found for this debt");
  return db.transaction(() => {
    const anchor = anchorDebtAtObservation(db, input.debtId, input.observationId, null, now);
    setDebtOnboardingDate(db, input.debtId, observation.observedOn, now);
    return { anchor, openingDifferenceMinor: observation.principalMinor - input.modelPrincipalMinor, needsOpeningAdjustmentProposal: observation.principalMinor !== input.modelPrincipalMinor };
  })();
}

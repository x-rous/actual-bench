import { AppDbValidationError } from "@/lib/app-db/errors";
import { getDebt } from "@/lib/app-db/debtRepository";
import { getDebtObservation, insertDebtObservation, listCurrentDebtObservations, listDebtObservationHistory, type DebtObservationInput } from "@/lib/app-db/debtObservationRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

export function recordManualDebtObservation(db: SqliteDatabase, input: Omit<DebtObservationInput, "source" | "supersedesObservationId"> & { supersedesObservationId?: string | null }, now = new Date().toISOString()) {
  if (!getDebt(db, input.debtId)) throw new AppDbValidationError("Debt not found");
  if (input.supersedesObservationId) {
    const prior = getDebtObservation(db, input.supersedesObservationId);
    if (!prior || prior.debtId !== input.debtId) throw new AppDbValidationError("The observation being corrected does not belong to this debt");
    if (!listCurrentDebtObservations(db, input.debtId).some((row) => row.id === prior.id)) throw new AppDbValidationError("That observation has already been superseded");
  }
  return insertDebtObservation(db, { ...input, source: "manual-statement", supersedesObservationId: input.supersedesObservationId ?? null }, now);
}

export const currentDebtObservations = listCurrentDebtObservations;
export const debtObservationHistory = listDebtObservationHistory;

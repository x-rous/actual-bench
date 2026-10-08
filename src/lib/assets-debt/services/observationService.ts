import { AppDbValidationError } from "@/lib/app-db/errors";
import { getDebt } from "@/lib/app-db/debtRepository";
import { getDebtObservation, insertDebtObservation, listCurrentDebtObservations, listDebtObservationHistory, type DebtObservationInput } from "@/lib/app-db/debtObservationRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

export function recordManualDebtObservation(db: SqliteDatabase, input: Omit<DebtObservationInput, "source" | "supersedesObservationId"> & { supersedesObservationId?: string | null }, now = new Date().toISOString()) {
  const debt = getDebt(db, input.debtId);
  if (!debt) throw new AppDbValidationError("Debt not found");
  if (debt.status === "archived") throw new AppDbValidationError("Archived loans are read-only.");
  if (input.supersedesObservationId) {
    const prior = getDebtObservation(db, input.supersedesObservationId);
    if (!prior || prior.debtId !== input.debtId) throw new AppDbValidationError("The observation being corrected does not belong to this debt");
    if (!listCurrentDebtObservations(db, input.debtId).some((row) => row.id === prior.id)) throw new AppDbValidationError("That observation has already been superseded");
  }
  return insertDebtObservation(db, { ...input, source: "manual-statement", supersedesObservationId: input.supersedesObservationId ?? null }, now);
}

export const currentDebtObservations = listCurrentDebtObservations;
export const debtObservationHistory = listDebtObservationHistory;

/** Delete statement rows in a safe order: a row is removed only once nothing still names it as corrected. */
export function deleteObservationRows(db: SqliteDatabase, ids: ReadonlySet<string>): void {
  const remaining = new Set(ids);
  const pointsAt = db.prepare("SELECT COUNT(*) AS n FROM debt_observations WHERE supersedes_observation_id = ?");
  const remove = db.prepare("DELETE FROM debt_observations WHERE id = ?");
  while (remaining.size) {
    const free = [...remaining].filter((id) => (pointsAt.get<{ n: number }>(id)?.n ?? 0) === 0);
    if (!free.length) throw new AppDbValidationError("The statement history could not be removed in order");
    for (const id of free) {
      remove.run(id);
      remaining.delete(id);
    }
  }
}

/**
 * Remove a lender statement (owner decision 2026-10-05): the statement with every correction of it
 * (the whole chain), and any restart of the calculation made from one of them. Actual is not
 * touched. Returns what was removed so the screen can say so.
 */
export function removeDebtObservation(db: SqliteDatabase, debtId: string, observationId: string): { statements: number; restarts: number } {
  if (getDebt(db, debtId)?.status === "archived") throw new AppDbValidationError("Archived loans are read-only.");
  const all = listDebtObservationHistory(db, debtId);
  if (!all.some((o) => o.id === observationId)) throw new AppDbValidationError("That statement does not belong to this loan");
  // The connected chain: the statement, what it corrected, and what corrected it, in both directions.
  const chain = new Set([observationId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const o of all) {
      const linked = chain.has(o.id) || (o.supersedesObservationId !== null && chain.has(o.supersedesObservationId));
      if (linked && !chain.has(o.id)) { chain.add(o.id); grew = true; }
      if (chain.has(o.id) && o.supersedesObservationId && !chain.has(o.supersedesObservationId)) { chain.add(o.supersedesObservationId); grew = true; }
    }
  }
  return db.transaction(() => {
    const ids = [...chain];
    const marks = ids.map(() => "?").join(", ");
    const restarts = db.prepare(`DELETE FROM debt_anchors WHERE debt_id = ? AND observation_id IN (${marks})`).run(debtId, ...ids).changes;
    deleteObservationRows(db, chain);
    return { statements: chain.size, restarts };
  })();
}

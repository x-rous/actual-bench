import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import { optionalInteger, optionalText, requireInteger, requireIsoDate, requireText, rethrowConstraint } from "./debtValues";
import type { SqliteDatabase } from "./types";

export type DebtObservationSource = "manual-statement" | "actual-balance" | "onboarding";

export type DebtObservationRecord = {
  id: string;
  debtId: string;
  observedOn: string;
  recordedAt: string;
  principalMinor: number;
  accruedInterestMinor: number | null;
  source: DebtObservationSource;
  supersedesObservationId: string | null;
  note: string | null;
  createdAt: string;
};

type Row = {
  id: string; debt_id: string; observed_on: string; recorded_at: string;
  principal_minor: number; accrued_interest_minor: number | null; source: DebtObservationSource;
  supersedes_observation_id: string | null; note: string | null; created_at: string;
};

const fromRow = (row: Row): DebtObservationRecord => ({
  id: row.id, debtId: row.debt_id, observedOn: row.observed_on, recordedAt: row.recorded_at,
  principalMinor: row.principal_minor, accruedInterestMinor: row.accrued_interest_minor,
  source: row.source, supersedesObservationId: row.supersedes_observation_id,
  note: row.note, createdAt: row.created_at,
});

export type DebtObservationInput = Omit<DebtObservationRecord, "id" | "createdAt"> & { id?: string };

export function insertDebtObservation(db: SqliteDatabase, input: DebtObservationInput, now = new Date().toISOString()): DebtObservationRecord {
  const id = input.id ?? generateId();
  const source = input.source;
  if (!["manual-statement", "actual-balance", "onboarding"].includes(source)) throw new AppDbValidationError("Unknown observation source");
  try {
    db.prepare(
      `INSERT INTO debt_observations
       (id, debt_id, observed_on, recorded_at, principal_minor, accrued_interest_minor, source,
        supersedes_observation_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, requireText(input.debtId, "debtId"), requireIsoDate(input.observedOn, "observedOn"),
      requireText(input.recordedAt, "recordedAt"), requireInteger(input.principalMinor, "principalMinor", 0),
      optionalInteger(input.accruedInterestMinor, "accruedInterestMinor", 0), source,
      optionalText(input.supersedesObservationId, "supersedesObservationId"), optionalText(input.note, "note"), now
    );
  } catch (error) {
    rethrowConstraint(error, { FOREIGN: "The debt or observation being corrected does not exist." });
  }
  return getDebtObservation(db, id)!;
}

export function getDebtObservation(db: SqliteDatabase, id: string): DebtObservationRecord | null {
  const row = db.prepare("SELECT * FROM debt_observations WHERE id = ?").get<Row>(id);
  return row ? fromRow(row) : null;
}

/** Latest factual evidence only. A superseded row remains immutable audit history. */
export function listCurrentDebtObservations(db: SqliteDatabase, debtId: string): DebtObservationRecord[] {
  return db.prepare(
    `SELECT o.* FROM debt_observations o
      WHERE o.debt_id = ?
        AND NOT EXISTS (SELECT 1 FROM debt_observations n WHERE n.supersedes_observation_id = o.id)
      ORDER BY o.observed_on DESC, o.recorded_at DESC, o.created_at DESC, o.id DESC`
  ).all<Row>(debtId).map(fromRow);
}

export function listDebtObservationHistory(db: SqliteDatabase, debtId: string): DebtObservationRecord[] {
  return db.prepare("SELECT * FROM debt_observations WHERE debt_id = ? ORDER BY observed_on DESC, recorded_at DESC, created_at DESC, id DESC")
    .all<Row>(debtId).map(fromRow);
}

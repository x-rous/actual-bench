import { generateId } from "@/lib/uuid";
import { optionalInteger, optionalText, requireInteger, requireIsoDate, requireText, rethrowConstraint } from "./debtValues";
import type { SqliteDatabase } from "./types";

export type DebtAnchorRecord = {
  id: string; debtId: string; anchorDate: string; principalMinor: number;
  accruedInterestMinor: number | null; carriedRemainderDecimal: string | null;
  source: string; observationKind: string | null; observationId: string | null;
  configRevision: number; createdAt: string;
};

type Row = {
  id: string; debt_id: string; anchor_date: string; principal_minor: number;
  accrued_interest_minor: number | null; carried_remainder_decimal: string | null;
  source: string; observation_kind: string | null; observation_id: string | null;
  config_revision: number; created_at: string;
};

const fromRow = (r: Row): DebtAnchorRecord => ({ id: r.id, debtId: r.debt_id, anchorDate: r.anchor_date,
  principalMinor: r.principal_minor, accruedInterestMinor: r.accrued_interest_minor,
  carriedRemainderDecimal: r.carried_remainder_decimal, source: r.source,
  observationKind: r.observation_kind, observationId: r.observation_id,
  configRevision: r.config_revision, createdAt: r.created_at });

export function insertDebtAnchor(db: SqliteDatabase, input: Omit<DebtAnchorRecord, "id" | "createdAt"> & { id?: string }, now = new Date().toISOString()): DebtAnchorRecord {
  const id = input.id ?? generateId();
  try {
    db.prepare(`INSERT INTO debt_anchors
      (id, debt_id, anchor_date, principal_minor, accrued_interest_minor, carried_remainder_decimal,
       source, observation_kind, observation_id, config_revision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, requireText(input.debtId, "debtId"), requireIsoDate(input.anchorDate, "anchorDate"),
        requireInteger(input.principalMinor, "principalMinor", 0), optionalInteger(input.accruedInterestMinor, "accruedInterestMinor", 0),
        optionalText(input.carriedRemainderDecimal, "carriedRemainderDecimal"), requireText(input.source, "source"),
        optionalText(input.observationKind, "observationKind"), optionalText(input.observationId, "observationId"),
        requireInteger(input.configRevision, "configRevision", 1), now);
  } catch (error) { rethrowConstraint(error, { FOREIGN: "The debt does not exist." }); }
  return getDebtAnchor(db, id)!;
}

export function getDebtAnchor(db: SqliteDatabase, id: string): DebtAnchorRecord | null {
  const row = db.prepare("SELECT * FROM debt_anchors WHERE id = ?").get<Row>(id);
  return row ? fromRow(row) : null;
}

export function getEffectiveDebtAnchor(db: SqliteDatabase, debtId: string): DebtAnchorRecord | null {
  const row = db.prepare("SELECT * FROM debt_anchors WHERE debt_id = ? ORDER BY anchor_date DESC, created_at DESC, id DESC LIMIT 1").get<Row>(debtId);
  return row ? fromRow(row) : null;
}

export function listDebtAnchors(db: SqliteDatabase, debtId: string): DebtAnchorRecord[] {
  return db.prepare("SELECT * FROM debt_anchors WHERE debt_id = ? ORDER BY anchor_date DESC, created_at DESC, id DESC").all<Row>(debtId).map(fromRow);
}

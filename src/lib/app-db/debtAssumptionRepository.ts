import { AppDbValidationError } from "./errors";
import { replaceChildRows } from "./debtChildRows";
import { optionalText, requireInteger, requireIsoDate, requireOneOf, requireText, rethrowConstraint } from "./debtValues";
import {
  DEBT_ASSUMPTION_KINDS,
  FEE_TREATMENT_VALUES,
  readStoredEnum,
  type DebtAssumptionKind,
  type DebtAssumptionRecord,
  type DebtAssumptionRecurrence,
  type FeeTreatmentValue,
  type SqliteDatabase,
} from "./types";

/**
 * Baseline future assumptions (RD-084 P1.3, v38; FR-110). Never a scenario
 * table (FR-114): a calculator result becomes a baseline only when the user
 * applies it, as rows here plus a new model revision.
 *
 * `fee_treatment` belongs to fee assumptions only and `offset_account_id` to
 * offset-balance assumptions only (G1 D-3); table CHECKs enforce both. The
 * offset account is an Actual id, so it is not a foreign key.
 */

/** Recurrence envelope version this build writes and reads. */
export const RECURRENCE_ENVELOPE_VERSION = 1;
/** Recurring assumptions repeat on a regular cadence; custom dates are separate rows. */
export const ASSUMPTION_RECURRENCE_FREQUENCIES = ["weekly", "fortnightly", "monthly", "quarterly", "annual"] as const;
const RECURRING_KINDS: readonly DebtAssumptionKind[] = ["extra-repayment", "draw", "fee"];

type AssumptionRow = {
  id: string;
  debt_id: string;
  assumption_kind: string;
  effective_from: string;
  recurrence_json: string | null;
  amount_minor: number | null;
  fee_treatment: string | null;
  offset_account_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type AssumptionInput = {
  id?: string | null;
  kind: DebtAssumptionKind;
  effectiveFrom: string;
  recurrence: DebtAssumptionRecurrence | null;
  /** Minor units: the amount, or for offset-balance the assumed balance. */
  amountMinor: number;
  feeTreatment: FeeTreatmentValue | null;
  offsetAccountId: string | null;
  note: string | null;
};

function readRecurrence(raw: string | null): DebtAssumptionRecord["recurrence"] {
  if (raw === null) return null;
  try {
    const envelope = JSON.parse(raw) as { version?: unknown; data?: { frequency?: unknown; until?: unknown } };
    if (envelope.version === RECURRENCE_ENVELOPE_VERSION && typeof envelope.data?.frequency === "string" && typeof envelope.data?.until === "string") {
      return { frequency: envelope.data.frequency, until: envelope.data.until };
    }
  } catch {
    // fall through: unreadable is reported, never guessed
  }
  return { unknown: raw };
}

function rowToRecord(row: AssumptionRow): DebtAssumptionRecord {
  return {
    id: row.id,
    debtId: row.debt_id,
    assumptionKind: readStoredEnum(DEBT_ASSUMPTION_KINDS, row.assumption_kind),
    effectiveFrom: row.effective_from,
    recurrence: readRecurrence(row.recurrence_json),
    amountMinor: row.amount_minor,
    feeTreatment: row.fee_treatment === null ? null : readStoredEnum(FEE_TREATMENT_VALUES, row.fee_treatment),
    offsetAccountId: row.offset_account_id,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function columns(row: AssumptionInput) {
  const kind = requireOneOf(DEBT_ASSUMPTION_KINDS, row.kind, "kind");
  const from = requireIsoDate(row.effectiveFrom, "effectiveFrom");
  let recurrence: string | null = null;
  if (row.recurrence !== null && row.recurrence !== undefined) {
    if (!RECURRING_KINDS.includes(kind)) throw new AppDbValidationError(`A ${kind} assumption cannot recur`);
    const frequency = requireOneOf(ASSUMPTION_RECURRENCE_FREQUENCIES, row.recurrence.frequency, "recurrence.frequency");
    const until = requireIsoDate(row.recurrence.until, "recurrence.until");
    if (until < from) throw new AppDbValidationError("A recurrence must end on or after its first date");
    recurrence = JSON.stringify({ version: RECURRENCE_ENVELOPE_VERSION, data: { frequency, until } });
  }
  const feeTreatment = kind === "fee" ? requireOneOf(FEE_TREATMENT_VALUES, row.feeTreatment, "feeTreatment") : null;
  if (kind !== "fee" && row.feeTreatment) throw new AppDbValidationError("Only a fee assumption has a treatment");
  const offsetAccountId = kind === "offset-balance" ? requireText(row.offsetAccountId, "offsetAccountId") : null;
  if (kind !== "offset-balance" && row.offsetAccountId) throw new AppDbValidationError("Only an offset-balance assumption names an account");
  return [kind, from, recurrence, requireInteger(row.amountMinor, "amountMinor", 0), feeTreatment, offsetAccountId, optionalText(row.note, "note")] as const;
}

export function listDebtAssumptions(db: SqliteDatabase, debtId: string): DebtAssumptionRecord[] {
  return db
    .prepare("SELECT * FROM debt_future_assumptions WHERE debt_id = ? ORDER BY effective_from, assumption_kind, id")
    .all<AssumptionRow>(debtId)
    .map(rowToRecord);
}

export function replaceDebtAssumptions(db: SqliteDatabase, debtId: string, rows: readonly AssumptionInput[], now = new Date().toISOString()): void {
  const prepared = rows.map((r) => ({ ...r, cols: columns(r) }));
  try {
    replaceChildRows(db, "debt_future_assumptions", debtId, prepared, {
      insert: (id, r) =>
        db
          .prepare(
            `INSERT INTO debt_future_assumptions (id, debt_id, assumption_kind, effective_from, recurrence_json,
               amount_minor, fee_treatment, offset_account_id, note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, debtId, ...r.cols, now, now),
      update: (id, r) =>
        db
          .prepare(
            `UPDATE debt_future_assumptions SET assumption_kind = ?, effective_from = ?, recurrence_json = ?,
               amount_minor = ?, fee_treatment = ?, offset_account_id = ?, note = ?, updated_at = ?
             WHERE id = ? AND debt_id = ?`
          )
          .run(...r.cols, now, id, debtId),
    });
  } catch (error) {
    rethrowConstraint(error, { FOREIGN: "The debt does not exist." });
  }
}

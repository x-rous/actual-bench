import { generateId } from "@/lib/uuid";
import { canonicalHash, canonicalJson } from "./canonicalJson";
import { AppDbValidationError } from "./errors";
import { optionalText, requireInteger, requireOneOf, requireText, rethrowConstraint } from "./debtValues";
import {
  POSTING_CLASSIFICATIONS,
  POSTING_KINDS,
  POSTING_STATUSES,
  POSTING_SUBJECT_KINDS,
  readStoredEnum,
  type FinancialPostingRecord,
  type PostingClassification,
  type PostingKind,
  type PostingReason,
  type PostingStatus,
  type PostingSubjectKind,
  type SqliteDatabase,
} from "./types";

/**
 * Financial postings (RD-084 P1.6, v44; data-model.md "financial_postings").
 *
 * Workflow state that becomes audit. The repository owns every status
 * transition, so a posting cannot reach `approved` without the user's decision
 * time, cannot start applying unless it is `approved`, and cannot be pruned once
 * anyone decided on it. Snapshots, identity and the marker are written once:
 * the `financial_postings_identity_immutable` trigger aborts any UPDATE that
 * bypasses this module.
 *
 * There is deliberately no auto-apply transition here. `approved` and
 * `declined` are reachable only through `decidePosting`, which the apply and
 * decline routes call on the user's explicit action (SC-018).
 */

type PostingRow = {
  id: string;
  budget_sync_id: string;
  subject_kind: string;
  subject_id: string;
  posting_kind: string;
  period_key: string;
  generation: number;
  config_revision: number;
  input_format_version: number;
  input_snapshot_json: string;
  input_hash: string;
  engine_versions_json: string;
  output_snapshot_json: string;
  classification: string;
  classification_reasons_json: string;
  idempotency_marker: string | null;
  status: string;
  decided_at: string | null;
  applied_at: string | null;
  actual_ids_json: string | null;
  reversal_of: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

export const PROPOSAL_RETENTION_DAYS = 90;

function rowToRecord(row: PostingRow): FinancialPostingRecord {
  return {
    id: row.id,
    budgetSyncId: row.budget_sync_id,
    subjectKind: readStoredEnum(POSTING_SUBJECT_KINDS, row.subject_kind),
    subjectId: row.subject_id,
    postingKind: readStoredEnum(POSTING_KINDS, row.posting_kind),
    periodKey: row.period_key,
    generation: row.generation,
    configRevision: row.config_revision,
    inputFormatVersion: row.input_format_version,
    inputSnapshotJson: row.input_snapshot_json,
    inputHash: row.input_hash,
    engineVersions: JSON.parse(row.engine_versions_json) as Record<string, string>,
    outputSnapshotJson: row.output_snapshot_json,
    classification: readStoredEnum(POSTING_CLASSIFICATIONS, row.classification),
    reasons: JSON.parse(row.classification_reasons_json) as PostingReason[],
    idempotencyMarker: row.idempotency_marker,
    status: readStoredEnum(POSTING_STATUSES, row.status),
    decidedAt: row.decided_at,
    appliedAt: row.applied_at,
    actualIds: row.actual_ids_json === null ? null : (JSON.parse(row.actual_ids_json) as string[]),
    reversalOf: row.reversal_of,
    error: row.error_json === null ? null : (JSON.parse(row.error_json) as Record<string, unknown>),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getFinancialPosting(db: SqliteDatabase, id: string): FinancialPostingRecord | null {
  const row = db.prepare("SELECT * FROM financial_postings WHERE id = ?").get<PostingRow>(id);
  return row ? rowToRecord(row) : null;
}

function requirePosting(db: SqliteDatabase, id: string): FinancialPostingRecord {
  const posting = getFinancialPosting(db, id);
  if (!posting) throw new AppDbValidationError("Posting not found");
  return posting;
}

export function listSubjectPostings(db: SqliteDatabase, subjectKind: PostingSubjectKind, subjectId: string): FinancialPostingRecord[] {
  return db
    .prepare("SELECT * FROM financial_postings WHERE subject_kind = ? AND subject_id = ? ORDER BY period_key, created_at, id")
    .all<PostingRow>(subjectKind, subjectId)
    .map(rowToRecord);
}

export function listPeriodPostings(
  db: SqliteDatabase,
  key: { subjectKind: PostingSubjectKind; subjectId: string; postingKind: PostingKind; periodKey: string }
): FinancialPostingRecord[] {
  return db
    .prepare(
      `SELECT * FROM financial_postings
       WHERE subject_kind = ? AND subject_id = ? AND posting_kind = ? AND period_key = ?
       ORDER BY generation, created_at, id`
    )
    .all<PostingRow>(key.subjectKind, key.subjectId, key.postingKind, key.periodKey)
    .map(rowToRecord);
}

/** S10: the generation starts at 1 and moves on only past a reversed posting of the same key. */
export function nextPostingGeneration(
  db: SqliteDatabase,
  key: { subjectKind: PostingSubjectKind; subjectId: string; postingKind: PostingKind; periodKey: string }
): number {
  const row = db
    .prepare(
      `SELECT count(*) AS n FROM financial_postings
       WHERE subject_kind = ? AND subject_id = ? AND posting_kind = ? AND period_key = ? AND status = 'reversed'`
    )
    .get<{ n: number }>(key.subjectKind, key.subjectId, key.postingKind, key.periodKey);
  return 1 + (row?.n ?? 0);
}

export type ProposalInput = {
  budgetSyncId: string;
  subjectKind: PostingSubjectKind;
  subjectId: string;
  postingKind: PostingKind;
  periodKey: string;
  generation: number;
  configRevision: number;
  inputFormatVersion: number;
  /** Canonical-JSON-able: safe-integer amounts and decimal strings only (canonicalJson refuses floats). */
  inputSnapshot: unknown;
  engineVersions: Record<string, string>;
  outputSnapshot: unknown;
  classification: PostingClassification;
  reasons: PostingReason[];
  idempotencyMarker: string | null;
  reversalOf?: string | null;
};

export type ProposalResult = { posting: FinancialPostingRecord; reused: boolean };

/**
 * Record a proposal (A-3). An undecided proposal for the same key whose input
 * hash is unchanged is reused, not re-inserted. An undecided proposal whose
 * inputs changed is superseded by the new one; decided rows are never touched.
 */
export function upsertProposal(db: SqliteDatabase, input: ProposalInput, now = new Date().toISOString()): ProposalResult {
  const subjectKind = requireOneOf(POSTING_SUBJECT_KINDS, input.subjectKind, "subjectKind");
  const postingKind = requireOneOf(POSTING_KINDS, input.postingKind, "postingKind");
  const classification = requireOneOf(POSTING_CLASSIFICATIONS, input.classification, "classification");
  const periodKey = requireText(input.periodKey, "periodKey");
  const inputJson = canonicalJson(input.inputSnapshot);
  const inputHash = canonicalHash(input.inputSnapshot);
  const outputJson = canonicalJson(input.outputSnapshot);
  for (const reason of input.reasons) {
    if (typeof reason.code !== "string" || typeof reason.text !== "string" || reason.text.trim() === "") {
      throw new AppDbValidationError("Every classification reason needs a code and plain-language text");
    }
  }
  if (classification !== "safe" && input.reasons.length === 0) {
    throw new AppDbValidationError("A Review or Blocked proposal must say why (SC-011)");
  }

  return db.transaction((): ProposalResult => {
    const existing = db
      .prepare(
        `SELECT * FROM financial_postings
         WHERE subject_kind = ? AND subject_id = ? AND posting_kind = ? AND period_key = ? AND input_hash = ? AND status = 'proposed'`
      )
      .get<PostingRow>(subjectKind, input.subjectId, postingKind, periodKey, inputHash);
    // The same inputs can be classified differently when something outside them changed (material
    // drift came or went): then the stored classification is stale and a new version replaces it.
    if (existing && existing.classification === classification && existing.classification_reasons_json === canonicalJson(input.reasons)) {
      return { posting: rowToRecord(existing), reused: true };
    }

    db.prepare(
      `UPDATE financial_postings SET status = 'superseded', updated_at = ?, error_json = ?
       WHERE subject_kind = ? AND subject_id = ? AND posting_kind = ? AND period_key = ? AND status = 'proposed'
         AND reversal_of IS ?`
    ).run(now, supersededJson(input.reversalOf ? "newer-undo" : "newer-preview"), subjectKind, input.subjectId, postingKind, periodKey, input.reversalOf ?? null);

    const id = generateId();
    try {
      db.prepare(
        `INSERT INTO financial_postings
         (id, budget_sync_id, subject_kind, subject_id, posting_kind, period_key, generation, config_revision,
          input_format_version, input_snapshot_json, input_hash, engine_versions_json, output_snapshot_json,
          classification, classification_reasons_json, idempotency_marker, status, decided_at, applied_at,
          actual_ids_json, reversal_of, error_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', NULL, NULL, NULL, ?, NULL, ?, ?)`
      ).run(
        id,
        requireText(input.budgetSyncId, "budgetSyncId"),
        subjectKind,
        requireText(input.subjectId, "subjectId"),
        postingKind,
        periodKey,
        requireInteger(input.generation, "generation", 1),
        requireInteger(input.configRevision, "configRevision", 1),
        requireInteger(input.inputFormatVersion, "inputFormatVersion", 1),
        inputJson,
        inputHash,
        canonicalJson(input.engineVersions),
        outputJson,
        classification,
        canonicalJson(input.reasons),
        optionalText(input.idempotencyMarker, "idempotencyMarker"),
        optionalText(input.reversalOf, "reversalOf"),
        now,
        now
      );
    } catch (error) {
      rethrowConstraint(error, { FOREIGN: "The posting being reversed does not exist." });
    }
    return { posting: requirePosting(db, id), reused: false };
  })();
}

function transition(
  db: SqliteDatabase,
  id: string,
  from: readonly PostingStatus[],
  to: PostingStatus,
  set: Record<string, string | null>,
  now: string
): FinancialPostingRecord {
  const posting = requirePosting(db, id);
  const status = typeof posting.status === "string" ? posting.status : null;
  if (status === null || !from.includes(status)) {
    throw new AppDbValidationError(`A ${status ?? "unrecognised"} posting cannot become ${to}`);
  }
  const columns = Object.keys(set);
  const assignments = ["status = ?", "updated_at = ?", ...columns.map((c) => `${c} = ?`)].join(", ");
  const changed = db
    .prepare(`UPDATE financial_postings SET ${assignments} WHERE id = ? AND status = ?`)
    .run(to, now, ...columns.map((c) => set[c]), id, status).changes;
  // The status guard in WHERE makes a concurrent transition lose cleanly.
  if (changed !== 1) throw new AppDbValidationError("The posting changed while this action was in progress");
  return requirePosting(db, id);
}

/**
 * The user's explicit decision. The only path to `approved` or `declined`, and
 * it always records `decided_at`. A Blocked proposal cannot be approved.
 */
export function decidePosting(
  db: SqliteDatabase,
  id: string,
  decision: "approved" | "declined",
  decidedAt: string
): FinancialPostingRecord {
  const at = requireText(decidedAt, "decidedAt");
  if (decision === "approved") {
    const posting = requirePosting(db, id);
    if (posting.classification !== "safe" && posting.classification !== "review") {
      throw new AppDbValidationError("A blocked proposal cannot be applied; resolve it in Actual first");
    }
  }
  return transition(db, id, ["proposed"], decision, { decided_at: at }, at);
}

/** The apply step itself; refuses anything that is not an approved, decided posting. */
export function beginApplyingPosting(db: SqliteDatabase, id: string, now = new Date().toISOString()): FinancialPostingRecord {
  const posting = requirePosting(db, id);
  if (posting.status !== "approved" || posting.decidedAt === null) {
    throw new AppDbValidationError("Only a posting the user approved can be applied");
  }
  return transition(db, id, ["approved"], "applying", {}, now);
}

export function markPostingApplied(
  db: SqliteDatabase,
  id: string,
  input: { actualIds: string[]; appliedAt: string; fromIndeterminate?: boolean }
): FinancialPostingRecord {
  for (const actualId of input.actualIds) requireText(actualId, "actualIds");
  return transition(
    db,
    id,
    input.fromIndeterminate ? ["indeterminate"] : ["applying"],
    "applied",
    { applied_at: requireText(input.appliedAt, "appliedAt"), actual_ids_json: canonicalJson(input.actualIds), error_json: null },
    input.appliedAt
  );
}

export function markPostingFailed(db: SqliteDatabase, id: string, error: Record<string, unknown>, now = new Date().toISOString()): FinancialPostingRecord {
  return transition(db, id, ["applying"], "failed", { error_json: canonicalJson(error) }, now);
}

/** Actual may or may not hold the write. Resolved only by recovery or a reviewed decision; never retried blindly. */
export function markPostingIndeterminate(db: SqliteDatabase, id: string, error: Record<string, unknown>, now = new Date().toISOString()): FinancialPostingRecord {
  return transition(db, id, ["applying"], "indeterminate", { error_json: canonicalJson(error) }, now);
}

/** Conflicting recovery evidence keeps the write interrupted; it is not proof of absence. */
export function recordPostingRecoveryReview(db: SqliteDatabase, id: string, reason: PostingReason, now = new Date().toISOString()): FinancialPostingRecord {
  return transition(db, id, ["indeterminate"], "indeterminate", { error_json: canonicalJson({ stage: "recovery-review", message: reason.text, code: reason.code }) }, now);
}

/**
 * Recovery found nothing in Actual: the posting goes back to `proposed`, now
 * Review, and needs a fresh user decision before anything is written again.
 */
export function reproposeIndeterminatePosting(db: SqliteDatabase, id: string, reason: PostingReason, now = new Date().toISOString()): FinancialPostingRecord {
  return db.transaction(() => {
    const posting = transition(db, id, ["indeterminate"], "proposed", { decided_at: null }, now);
    const reasons = [...posting.reasons.filter((r) => r.code !== reason.code), reason];
    db.prepare("UPDATE financial_postings SET classification = 'review', classification_reasons_json = ? WHERE id = ?").run(canonicalJson(reasons), id);
    return requirePosting(db, id);
  })();
}

/** Preflight found Actual changed since preview; the proposal is replaced by a fresh preview. */
/** Why a proposal stopped being current, shown to the user instead of a bare "superseded". */
export type SupersededCause = "newer-preview" | "newer-undo" | "actual-changed" | "replaced-by-applied";

const supersededJson = (cause: SupersededCause) => JSON.stringify({ superseded: cause });

export function supersedePosting(db: SqliteDatabase, id: string, now = new Date().toISOString(), cause: SupersededCause = "newer-preview"): FinancialPostingRecord {
  return transition(db, id, ["proposed"], "superseded", { error_json: supersededJson(cause) }, now);
}

/**
 * A failed change whose period a later change has since settled (applied): closed, so it no longer
 * asks for action. Nothing in Actual is touched; what Actual holds now is what the later change
 * verified.
 */
export function closeReplacedFailure(db: SqliteDatabase, id: string, now = new Date().toISOString()): FinancialPostingRecord {
  const posting = requirePosting(db, id);
  return transition(db, id, ["failed"], "superseded", { error_json: canonicalJson({ ...posting.error, superseded: "replaced-by-applied" }) }, now);
}

/** Only when the compensating reversal posting itself has been applied. */
export function markPostingReversed(db: SqliteDatabase, id: string, now = new Date().toISOString()): FinancialPostingRecord {
  return transition(db, id, ["applied"], "reversed", {}, now);
}

/**
 * An applied posting whose rows no longer hold in Actual (edited, unsplit or deleted there after it
 * was applied): it stops counting, like an undone one, and the reason says what changed. Bench then
 * plans the period again from what Actual has now (owner decision 2026-10-07).
 */
export function markPostingChangedInActual(db: SqliteDatabase, id: string, detail: string, now = new Date().toISOString()): FinancialPostingRecord {
  return transition(db, id, ["applied"], "reversed", { error_json: JSON.stringify({ cause: "changed-in-actual", detail }) }, now);
}

export function findReversalProposal(db: SqliteDatabase, originalId: string): FinancialPostingRecord | null {
  const row = db
    .prepare("SELECT * FROM financial_postings WHERE reversal_of = ? AND status IN ('proposed', 'approved', 'applying', 'applied', 'indeterminate') ORDER BY created_at DESC LIMIT 1")
    .get<PostingRow>(originalId);
  return row ? rowToRecord(row) : null;
}

/**
 * Proposals a preview no longer stands behind become `superseded`: every
 * undecided proposal of the subject that this preview did not produce, when it
 * was made from an older configuration revision or falls in the previewed
 * window. Without this, a proposal whose period no longer exists (for example
 * after a due date moved to the next business day) stayed listed with its old
 * figures. Reversal proposals are the user's own request and are never touched.
 */
export function supersedeStaleProposals(
  db: SqliteDatabase,
  input: { subjectKind: string; subjectId: string; keepIds: readonly string[]; configRevision: number; window: { from: string; to: string } },
  now = new Date().toISOString()
): number {
  const keep = JSON.stringify([...input.keepIds]);
  return db
    .prepare(
      `UPDATE financial_postings SET status = 'superseded', updated_at = ?, error_json = '{"superseded":"newer-preview"}'
       WHERE subject_kind = ? AND subject_id = ? AND status = 'proposed' AND reversal_of IS NULL
         AND id NOT IN (SELECT value FROM json_each(?))
         AND (config_revision < ? OR period_key BETWEEN ? AND ?)`
    )
    .run(now, input.subjectKind, input.subjectId, keep, input.configRevision, input.window.from, input.window.to).changes;
}

/**
 * A-3 retention: superseded proposals nobody decided on, older than 90 days.
 * Never a row with a decision, an apply, Actual ids or a reversal link, and
 * never one another row still references.
 */
export function pruneSupersededProposals(db: SqliteDatabase, now = new Date()): number {
  const cutoff = new Date(now.getTime() - PROPOSAL_RETENTION_DAYS * 86_400_000).toISOString();
  return db
    .prepare(
      `DELETE FROM financial_postings
       WHERE status = 'superseded' AND decided_at IS NULL AND applied_at IS NULL AND actual_ids_json IS NULL
         AND reversal_of IS NULL AND created_at < ?
         AND id NOT IN (SELECT reversal_of FROM financial_postings WHERE reversal_of IS NOT NULL)
         AND id NOT IN (SELECT posting_id FROM debt_transaction_links WHERE posting_id IS NOT NULL)`
    )
    .run(cutoff).changes;
}

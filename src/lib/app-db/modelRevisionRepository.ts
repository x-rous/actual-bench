import { canonicalHash, canonicalJson } from "./canonicalJson";
import { AppDbValidationError } from "./errors";
import { requireInteger, requireText } from "./debtValues";
import {
  MODEL_REVISION_SUBJECT_KINDS,
  readStoredEnum,
  type ModelRevisionRecord,
  type ModelRevisionSubjectKind,
  type SqliteDatabase,
} from "./types";

/**
 * Immutable model revisions (RD-084 P1.3, v38; FR-023).
 *
 * Insert and read only: there is deliberately no update or delete here, and
 * the `model_revisions_immutable` trigger aborts any UPDATE that bypasses this
 * module. The snapshot is stored exactly as hashed, as canonical JSON, so a
 * stored revision re-hashes to its own `config_hash`. What the snapshot
 * contains, and whether a save needs a new revision at all, is decided by the
 * configuration service (materialChange.ts), not here.
 */

type RevisionRow = {
  subject_kind: string;
  subject_id: string;
  revision: number;
  config_format: string;
  config_version: number;
  config_json: string;
  config_hash: string;
  change_summary: string;
  created_at: string;
};

function rowToRecord(row: RevisionRow): ModelRevisionRecord {
  return {
    subjectKind: readStoredEnum(MODEL_REVISION_SUBJECT_KINDS, row.subject_kind),
    subjectId: row.subject_id,
    revision: row.revision,
    configFormat: row.config_format,
    configVersion: row.config_version,
    configJson: row.config_json,
    configHash: row.config_hash,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
  };
}

/** The hash a snapshot will be stored under: SHA-256 of its canonical JSON. */
export function revisionHash(snapshot: unknown): string {
  return canonicalHash(snapshot);
}

export function insertModelRevision(
  db: SqliteDatabase,
  input: {
    subjectKind: ModelRevisionSubjectKind;
    subjectId: string;
    revision: number;
    configFormat: string;
    configVersion: number;
    snapshot: unknown;
    changeSummary?: string;
  },
  now = new Date().toISOString()
): ModelRevisionRecord {
  const subjectKind = input.subjectKind;
  if (!MODEL_REVISION_SUBJECT_KINDS.includes(subjectKind)) throw new AppDbValidationError("Unknown revision subject kind");
  const subjectId = requireText(input.subjectId, "subjectId");
  const revision = requireInteger(input.revision, "revision", 1);
  const configJson = canonicalJson(input.snapshot);
  try {
    db.prepare(
      `INSERT INTO model_revisions (subject_kind, subject_id, revision, config_format, config_version, config_json, config_hash, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      subjectKind,
      subjectId,
      revision,
      requireText(input.configFormat, "configFormat"),
      requireInteger(input.configVersion, "configVersion", 1),
      configJson,
      canonicalHash(input.snapshot),
      input.changeSummary ?? "",
      now
    );
  } catch (error) {
    // The native SQLite error may come from another realm, so read its text rather than test instanceof.
    if (/UNIQUE|PRIMARY KEY/i.test(String((error as { message?: unknown })?.message ?? error))) {
      throw new AppDbValidationError(`Revision ${revision} already exists for this ${subjectKind}`);
    }
    throw error;
  }
  return getModelRevision(db, subjectKind, subjectId, revision)!;
}

export function getModelRevision(db: SqliteDatabase, subjectKind: ModelRevisionSubjectKind, subjectId: string, revision: number): ModelRevisionRecord | null {
  const row = db
    .prepare("SELECT * FROM model_revisions WHERE subject_kind = ? AND subject_id = ? AND revision = ?")
    .get<RevisionRow>(subjectKind, subjectId, revision);
  return row ? rowToRecord(row) : null;
}

export function getLatestModelRevision(db: SqliteDatabase, subjectKind: ModelRevisionSubjectKind, subjectId: string): ModelRevisionRecord | null {
  const row = db
    .prepare("SELECT * FROM model_revisions WHERE subject_kind = ? AND subject_id = ? ORDER BY revision DESC LIMIT 1")
    .get<RevisionRow>(subjectKind, subjectId);
  return row ? rowToRecord(row) : null;
}

export function listModelRevisions(db: SqliteDatabase, subjectKind: ModelRevisionSubjectKind, subjectId: string): ModelRevisionRecord[] {
  return db
    .prepare("SELECT * FROM model_revisions WHERE subject_kind = ? AND subject_id = ? ORDER BY revision")
    .all<RevisionRow>(subjectKind, subjectId)
    .map(rowToRecord);
}

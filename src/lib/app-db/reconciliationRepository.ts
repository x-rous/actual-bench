/**
 * Persistence for bank statement reconciliation sessions (RD-071 / PR-034a).
 *
 * Server-only. A session survives page navigation, browser restart, and a
 * partial Apply, and it backs the session list on the reconciliation home
 * screen.
 *
 * Unlike the sync tables, these rows hold **budget content** — the normalized
 * statement the user imported, plus a snapshot of the Actual transactions it
 * was matched against. That is called out in the user documentation, and
 * sessions are user-deletable. No credentials are stored here.
 *
 * Nothing in these tables has been written to Actual: every row is a staged
 * proposal until the user explicitly applies it.
 */

import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * Session lifecycle. `partial` is a first-class state: an Apply that half
 * succeeded must remain resumable and retryable without recreating the
 * successful writes.
 */
export type ReconciliationSessionStatus =
  | "draft"
  | "parsed"
  | "matching"
  | "needs_review"
  | "ready"
  | "applying"
  | "partial"
  | "completed"
  | "failed";

const SESSION_STATUSES: readonly ReconciliationSessionStatus[] = [
  "draft",
  "parsed",
  "matching",
  "needs_review",
  "ready",
  "applying",
  "partial",
  "completed",
  "failed",
];

export type ReconciliationProfileRecord = {
  id: string;
  budgetSyncId: string;
  accountId: string;
  name: string;
  /** Serialized `ColumnMapping`. */
  mapping: unknown;
  /** Serialized `MatchConfig`, including the user's text-target selection. */
  matchConfig: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ReconciliationSessionRecord = {
  id: string;
  budgetSyncId: string;
  accountId: string;
  accountName: string | null;
  profileId: string | null;
  status: ReconciliationSessionStatus;
  statementName: string | null;
  statementStart: string | null;
  statementEnd: string | null;
  candidateStart: string | null;
  candidateEnd: string | null;
  statementFingerprint: string | null;
  /** Session-level override of the profile's match config, when set. */
  matchConfig: unknown | null;
  totals: unknown | null;
  /** Outcome of each apply operation from the most recent attempt. */
  applyResults: unknown | null;
  /** How staged changes are turned into writes. */
  applyConfig: unknown | null;
  /** A short label the user gave this session, for telling reruns apart. */
  tag: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
};

export type ReconciliationStatementRowRecord = {
  id: string;
  sessionId: string;
  sourceRowNumber: number;
  postedDate: string;
  /** Integer minor units, sign preserved exactly. */
  amount: number;
  description: string;
  reference: string | null;
  transactionDate: string | null;
  /** Integer minor units, in the transaction's original currency. */
  originalAmount: number | null;
  originalCurrency: string | null;
  fingerprint: string;
  raw: unknown;
};

export type ReconciliationItemRecord = {
  id: string;
  sessionId: string;
  /** V1 writes at most one id; arrays leave grouped N:M open. */
  statementRowIds: string[];
  actualTransactionIds: string[];
  disposition: string;
  reasonCode: string | null;
  match: unknown | null;
  guards: unknown | null;
  actualSnapshot: unknown | null;
  stagedChanges: unknown | null;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

type ProfileRow = {
  id: string;
  budget_sync_id: string;
  account_id: string;
  name: string;
  mapping_json: string;
  match_config_json: string;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  budget_sync_id: string;
  account_id: string;
  account_name: string | null;
  profile_id: string | null;
  status: string;
  statement_name: string | null;
  statement_start: string | null;
  statement_end: string | null;
  candidate_start: string | null;
  candidate_end: string | null;
  statement_fingerprint: string | null;
  match_config_json: string | null;
  totals_json: string | null;
  apply_results_json: string | null;
  apply_config_json: string | null;
  tag: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
};

type StatementRowRow = {
  id: string;
  session_id: string;
  source_row_number: number;
  posted_date: string;
  amount: number;
  description: string;
  reference: string | null;
  transaction_date: string | null;
  original_amount: number | null;
  original_currency: string | null;
  fingerprint: string;
  raw_json: string;
};

type ItemRow = {
  id: string;
  session_id: string;
  statement_row_ids_json: string;
  actual_transaction_ids_json: string;
  disposition: string;
  reason_code: string | null;
  match_json: string | null;
  guards_json: string | null;
  actual_snapshot_json: string | null;
  staged_changes_json: string | null;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    // A corrupt blob must not take the whole session down: the caller sees a
    // missing field and can re-derive or re-import rather than hitting a 500.
    return null;
  }
}

function parseIdList(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
}

function requireText(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError(`Reconciliation ${field} is required`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new AppDbValidationError(`Reconciliation ${field} must be ${max} characters or fewer`);
  }
  return text;
}

function optionalText(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, field, max);
}

function requireStatus(value: unknown): ReconciliationSessionStatus {
  if (typeof value !== "string" || !SESSION_STATUSES.includes(value as ReconciliationSessionStatus)) {
    throw new AppDbValidationError(`Unknown reconciliation session status: ${String(value)}`);
  }
  return value as ReconciliationSessionStatus;
}

function profileToRecord(row: ProfileRow): ReconciliationProfileRecord {
  return {
    id: row.id,
    budgetSyncId: row.budget_sync_id,
    accountId: row.account_id,
    name: row.name,
    mapping: parseJson(row.mapping_json),
    matchConfig: parseJson(row.match_config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionToRecord(row: SessionRow): ReconciliationSessionRecord {
  return {
    id: row.id,
    budgetSyncId: row.budget_sync_id,
    accountId: row.account_id,
    accountName: row.account_name,
    profileId: row.profile_id,
    status: row.status as ReconciliationSessionStatus,
    statementName: row.statement_name,
    statementStart: row.statement_start,
    statementEnd: row.statement_end,
    candidateStart: row.candidate_start,
    candidateEnd: row.candidate_end,
    statementFingerprint: row.statement_fingerprint,
    matchConfig: parseJson(row.match_config_json),
    totals: parseJson(row.totals_json),
    applyResults: parseJson(row.apply_results_json),
    applyConfig: parseJson(row.apply_config_json),
    tag: row.tag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at,
  };
}

function statementRowToRecord(row: StatementRowRow): ReconciliationStatementRowRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceRowNumber: row.source_row_number,
    postedDate: row.posted_date,
    amount: row.amount,
    description: row.description,
    reference: row.reference,
    transactionDate: row.transaction_date,
    originalAmount: row.original_amount,
    originalCurrency: row.original_currency,
    fingerprint: row.fingerprint,
    raw: parseJson(row.raw_json),
  };
}

function itemToRecord(row: ItemRow): ReconciliationItemRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    statementRowIds: parseIdList(row.statement_row_ids_json),
    actualTransactionIds: parseIdList(row.actual_transaction_ids_json),
    disposition: row.disposition,
    reasonCode: row.reason_code,
    match: parseJson(row.match_json),
    guards: parseJson(row.guards_json),
    actualSnapshot: parseJson(row.actual_snapshot_json),
    stagedChanges: parseJson(row.staged_changes_json),
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export type ProfileInput = {
  budgetSyncId: string;
  accountId: string;
  name: string;
  mapping: unknown;
  matchConfig: unknown;
};

export function listReconciliationProfiles(
  db: SqliteDatabase,
  budgetSyncId: string,
  accountId?: string
): ReconciliationProfileRecord[] {
  const rows = accountId
    ? db
        .prepare(
          "SELECT * FROM reconciliation_profiles WHERE budget_sync_id = ? AND account_id = ? ORDER BY updated_at DESC"
        )
        .all<ProfileRow>(budgetSyncId, accountId)
    : db
        .prepare("SELECT * FROM reconciliation_profiles WHERE budget_sync_id = ? ORDER BY updated_at DESC")
        .all<ProfileRow>(budgetSyncId);
  return rows.map(profileToRecord);
}

/**
 * Create a profile, or update the existing one with the same name for this
 * account.
 *
 * Upsert rather than insert: "Save profile" is offered every time a statement
 * is imported, and a user re-saving the same named profile means "keep my
 * latest mapping", not "fail with a constraint error".
 */
export function saveReconciliationProfile(
  db: SqliteDatabase,
  input: ProfileInput
): ReconciliationProfileRecord {
  const budgetSyncId = requireText(input.budgetSyncId, "budget");
  const accountId = requireText(input.accountId, "account");
  const name = requireText(input.name, "profile name", 200);
  const timestamp = nowIso();

  const existing = db
    .prepare(
      "SELECT * FROM reconciliation_profiles WHERE budget_sync_id = ? AND account_id = ? AND name = ?"
    )
    .get<ProfileRow>(budgetSyncId, accountId, name);

  if (existing) {
    db.prepare(
      "UPDATE reconciliation_profiles SET mapping_json = ?, match_config_json = ?, updated_at = ? WHERE id = ?"
    ).run(
      JSON.stringify(input.mapping ?? null),
      JSON.stringify(input.matchConfig ?? null),
      timestamp,
      existing.id
    );
    return profileToRecord({
      ...existing,
      mapping_json: JSON.stringify(input.mapping ?? null),
      match_config_json: JSON.stringify(input.matchConfig ?? null),
      updated_at: timestamp,
    });
  }

  const id = generateId();
  db.prepare(
    `INSERT INTO reconciliation_profiles
       (id, budget_sync_id, account_id, name, mapping_json, match_config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    budgetSyncId,
    accountId,
    name,
    JSON.stringify(input.mapping ?? null),
    JSON.stringify(input.matchConfig ?? null),
    timestamp,
    timestamp
  );

  return {
    id,
    budgetSyncId,
    accountId,
    name,
    mapping: input.mapping ?? null,
    matchConfig: input.matchConfig ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function deleteReconciliationProfile(db: SqliteDatabase, id: string): boolean {
  const result = db.prepare("DELETE FROM reconciliation_profiles WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type CreateSessionInput = {
  budgetSyncId: string;
  accountId: string;
  accountName?: string | null;
  profileId?: string | null;
  statementName?: string | null;
  tag?: string | null;
};

export function createReconciliationSession(
  db: SqliteDatabase,
  input: CreateSessionInput
): ReconciliationSessionRecord {
  const id = generateId();
  const timestamp = nowIso();
  const budgetSyncId = requireText(input.budgetSyncId, "budget");
  const accountId = requireText(input.accountId, "account");

  db.prepare(
    `INSERT INTO reconciliation_sessions
       (id, budget_sync_id, account_id, account_name, profile_id, status, statement_name, tag, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    id,
    budgetSyncId,
    accountId,
    optionalText(input.accountName, "account name"),
    input.profileId ?? null,
    optionalText(input.statementName, "statement name"),
    optionalText(input.tag, "tag"),
    timestamp,
    timestamp
  );

  return getReconciliationSession(db, id)!;
}

export function getReconciliationSession(
  db: SqliteDatabase,
  id: string
): ReconciliationSessionRecord | null {
  const row = db
    .prepare("SELECT * FROM reconciliation_sessions WHERE id = ?")
    .get<SessionRow>(id);
  return row ? sessionToRecord(row) : null;
}

export function listReconciliationSessions(
  db: SqliteDatabase,
  budgetSyncId: string
): ReconciliationSessionRecord[] {
  return db
    .prepare(
      "SELECT * FROM reconciliation_sessions WHERE budget_sync_id = ? ORDER BY updated_at DESC"
    )
    .all<SessionRow>(budgetSyncId)
    .map(sessionToRecord);
}

export type UpdateSessionInput = {
  status?: ReconciliationSessionStatus;
  accountName?: string | null;
  profileId?: string | null;
  statementName?: string | null;
  statementStart?: string | null;
  statementEnd?: string | null;
  candidateStart?: string | null;
  candidateEnd?: string | null;
  statementFingerprint?: string | null;
  matchConfig?: unknown;
  totals?: unknown;
  applyResults?: unknown;
  applyConfig?: unknown;
  tag?: string | null;
  appliedAt?: string | null;
};

export function updateReconciliationSession(
  db: SqliteDatabase,
  id: string,
  input: UpdateSessionInput
): ReconciliationSessionRecord | null {
  const existing = db
    .prepare("SELECT * FROM reconciliation_sessions WHERE id = ?")
    .get<SessionRow>(id);
  if (!existing) return null;

  const assignments: string[] = [];
  const values: unknown[] = [];

  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };

  if (input.status !== undefined) set("status", requireStatus(input.status));
  if (input.accountName !== undefined) set("account_name", optionalText(input.accountName, "account name"));
  if (input.profileId !== undefined) set("profile_id", input.profileId);
  if (input.statementName !== undefined) set("statement_name", optionalText(input.statementName, "statement name"));
  if (input.statementStart !== undefined) set("statement_start", input.statementStart);
  if (input.statementEnd !== undefined) set("statement_end", input.statementEnd);
  if (input.candidateStart !== undefined) set("candidate_start", input.candidateStart);
  if (input.candidateEnd !== undefined) set("candidate_end", input.candidateEnd);
  if (input.statementFingerprint !== undefined) set("statement_fingerprint", input.statementFingerprint);
  if (input.tag !== undefined) set("tag", optionalText(input.tag, "tag"));
  if (input.matchConfig !== undefined) set("match_config_json", JSON.stringify(input.matchConfig ?? null));
  if (input.totals !== undefined) set("totals_json", JSON.stringify(input.totals ?? null));
  if (input.applyResults !== undefined) {
    set("apply_results_json", JSON.stringify(input.applyResults ?? null));
  }
  if (input.applyConfig !== undefined) {
    set("apply_config_json", JSON.stringify(input.applyConfig ?? null));
  }
  if (input.appliedAt !== undefined) set("applied_at", input.appliedAt);

  if (assignments.length === 0) return sessionToRecord(existing);

  set("updated_at", nowIso());
  values.push(id);
  db.prepare(`UPDATE reconciliation_sessions SET ${assignments.join(", ")} WHERE id = ?`).run(
    ...values
  );

  return getReconciliationSession(db, id);
}

/** Deletes the session and, by cascade, its statement rows and items. */
export function deleteReconciliationSession(db: SqliteDatabase, id: string): boolean {
  const result = db.prepare("DELETE FROM reconciliation_sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Statement rows
// ---------------------------------------------------------------------------

export type StatementRowInput = {
  id: string;
  sourceRowNumber: number;
  postedDate: string;
  amount: number;
  description: string;
  reference?: string | null;
  transactionDate?: string | null;
  originalAmount?: number | null;
  originalCurrency?: string | null;
  fingerprint: string;
  raw: unknown;
};

/**
 * Replace the session's statement rows in one transaction.
 *
 * Replace rather than append: re-importing a statement into the same session
 * must not leave rows from the previous parse behind, and a half-written
 * statement would corrupt every downstream count.
 */
export function replaceStatementRows(
  db: SqliteDatabase,
  sessionId: string,
  rows: StatementRowInput[]
): number {
  const insert = db.prepare(
    `INSERT INTO reconciliation_statement_rows
       (id, session_id, source_row_number, posted_date, amount, description, reference,
        transaction_date, original_amount, original_currency, fingerprint, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const run = db.transaction(() => {
    db.prepare("DELETE FROM reconciliation_statement_rows WHERE session_id = ?").run(sessionId);
    for (const row of rows) {
      if (row.originalAmount != null && !Number.isInteger(row.originalAmount)) {
        throw new AppDbValidationError(
          `Statement row ${row.sourceRowNumber} original amount must be an integer in minor units`
        );
      }
      if (!Number.isInteger(row.amount)) {
        // Minor units are integers by definition; a float here means a parsing
        // bug upstream and must not be silently persisted.
        throw new AppDbValidationError(
          `Statement row ${row.sourceRowNumber} amount must be an integer in minor units`
        );
      }
      insert.run(
        row.id,
        sessionId,
        row.sourceRowNumber,
        row.postedDate,
        row.amount,
        row.description,
        row.reference ?? null,
        row.transactionDate ?? null,
        row.originalAmount ?? null,
        row.originalCurrency ?? null,
        row.fingerprint,
        JSON.stringify(row.raw ?? null)
      );
    }
  });

  run();
  return rows.length;
}

export function listStatementRows(
  db: SqliteDatabase,
  sessionId: string
): ReconciliationStatementRowRecord[] {
  return db
    .prepare(
      "SELECT * FROM reconciliation_statement_rows WHERE session_id = ? ORDER BY source_row_number"
    )
    .all<StatementRowRow>(sessionId)
    .map(statementRowToRecord);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemInput = {
  id?: string;
  statementRowIds?: string[];
  actualTransactionIds?: string[];
  disposition: string;
  reasonCode?: string | null;
  match?: unknown;
  guards?: unknown;
  actualSnapshot?: unknown;
  stagedChanges?: unknown;
};

/** Replace the session's items in one transaction (e.g. after a re-match). */
export function replaceReconciliationItems(
  db: SqliteDatabase,
  sessionId: string,
  items: ItemInput[]
): number {
  const insert = db.prepare(
    `INSERT INTO reconciliation_items
       (id, session_id, statement_row_ids_json, actual_transaction_ids_json, disposition,
        reason_code, match_json, guards_json, actual_snapshot_json, staged_changes_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const timestamp = nowIso();

  const run = db.transaction(() => {
    db.prepare("DELETE FROM reconciliation_items WHERE session_id = ?").run(sessionId);
    for (const item of items) {
      insert.run(
        item.id ?? generateId(),
        sessionId,
        JSON.stringify(item.statementRowIds ?? []),
        JSON.stringify(item.actualTransactionIds ?? []),
        requireText(item.disposition, "disposition", 50),
        item.reasonCode ?? null,
        item.match === undefined ? null : JSON.stringify(item.match),
        item.guards === undefined ? null : JSON.stringify(item.guards),
        item.actualSnapshot === undefined ? null : JSON.stringify(item.actualSnapshot),
        item.stagedChanges === undefined ? null : JSON.stringify(item.stagedChanges),
        timestamp
      );
    }
  });

  run();
  return items.length;
}

export function listReconciliationItems(
  db: SqliteDatabase,
  sessionId: string
): ReconciliationItemRecord[] {
  return db
    .prepare("SELECT * FROM reconciliation_items WHERE session_id = ? ORDER BY rowid")
    .all<ItemRow>(sessionId)
    .map(itemToRecord);
}

/**
 * Update one item — the write behind every user decision in the workbench
 * (change a disposition, edit a staged field, accept a manual match).
 */
export function updateReconciliationItem(
  db: SqliteDatabase,
  id: string,
  input: Partial<ItemInput>
): ReconciliationItemRecord | null {
  const existing = db.prepare("SELECT * FROM reconciliation_items WHERE id = ?").get<ItemRow>(id);
  if (!existing) return null;

  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };

  if (input.statementRowIds !== undefined) {
    set("statement_row_ids_json", JSON.stringify(input.statementRowIds));
  }
  if (input.actualTransactionIds !== undefined) {
    set("actual_transaction_ids_json", JSON.stringify(input.actualTransactionIds));
  }
  if (input.disposition !== undefined) set("disposition", requireText(input.disposition, "disposition", 50));
  if (input.reasonCode !== undefined) set("reason_code", input.reasonCode);
  if (input.match !== undefined) set("match_json", JSON.stringify(input.match));
  if (input.guards !== undefined) set("guards_json", JSON.stringify(input.guards));
  if (input.actualSnapshot !== undefined) set("actual_snapshot_json", JSON.stringify(input.actualSnapshot));
  if (input.stagedChanges !== undefined) set("staged_changes_json", JSON.stringify(input.stagedChanges));

  if (assignments.length === 0) return itemToRecord(existing);

  set("updated_at", nowIso());
  values.push(id);
  db.prepare(`UPDATE reconciliation_items SET ${assignments.join(", ")} WHERE id = ?`).run(...values);

  const updated = db.prepare("SELECT * FROM reconciliation_items WHERE id = ?").get<ItemRow>(id);
  return updated ? itemToRecord(updated) : null;
}

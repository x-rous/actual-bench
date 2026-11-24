import { ABANDONED_APPLY_MS } from "@/lib/sync/applyClaim";
import { generateId } from "@/lib/uuid";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import {
  normalizeEnvelopeOrEmpty as normalizeEnvelope,
  normalizeOptionalEnvelope,
  parseEnvelope,
  parseOptionalEnvelope,
  stringifyEnvelope,
} from "./jsonEnvelope";
import { clampLimit } from "./pagination";
import type {
  JsonEnvelope,
  SqliteDatabase,
  SyncApplyState,
  SyncDuplicateConfidence,
  SyncEntityType,
  SyncFlowRun,
  SyncFlowRunItem,
  SyncItemClassification,
  SyncRunStatus,
  SyncRunTrigger,
} from "./types";

type SyncFlowRunRow = {
  id: string;
  flow_id: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary_json: string;
  error_json: string | null;
  created_by_trigger?: string;
  source_snapshot_summary_json?: string | null;
  target_snapshot_summary_json?: string | null;
  counts_json?: string | null;
};

type SyncFlowRunItemRow = {
  id: string;
  run_id: string;
  flow_id: string | null;
  sequence?: number | null;
  source_item_ref_json: string;
  target_item_ref_json: string | null;
  status: string;
  message: string | null;
  source_entity_type: string | null;
  source_item_key: string | null;
  source_transaction_id: string | null;
  source_split_id: string | null;
  source_fingerprint: string | null;
  planned_action: string | null;
  planned_target_payload_json: string | null;
  classification: string | null;
  duplicate_confidence: string | null;
  warnings_json: string | null;
  errors_json: string | null;
  selected_for_apply: number;
  apply_state: string | null;
  created_target_transaction_id: string | null;
  created_target_marker: string | null;
  created_at: string;
  updated_at: string | null;
};

type CreateSyncFlowRunInput = {
  id?: string;
  flowId?: string | null;
  status?: SyncRunStatus;
  startedAt?: string;
  finishedAt?: string | null;
  summary?: JsonEnvelope;
  error?: JsonEnvelope | null;
  createdByTrigger?: SyncRunTrigger;
  sourceSnapshotSummary?: JsonEnvelope | null;
  targetSnapshotSummary?: JsonEnvelope | null;
  counts?: JsonEnvelope | null;
};

type CreateSyncFlowRunItemInput = {
  id?: string;
  runId: string;
  flowId?: string | null;
  sequence?: number | null;
  sourceItemRef?: JsonEnvelope;
  targetItemRef?: JsonEnvelope | null;
  status?: string;
  message?: string | null;
  sourceEntityType?: SyncEntityType | null;
  sourceItemKey?: string | null;
  sourceTransactionId?: string | null;
  sourceSplitId?: string | null;
  sourceFingerprint?: string | null;
  plannedAction?: string | null;
  plannedTargetPayload?: JsonEnvelope | null;
  classification?: SyncItemClassification | null;
  duplicateConfidence?: SyncDuplicateConfidence | null;
  warnings?: JsonEnvelope | null;
  errors?: JsonEnvelope | null;
  selectedForApply?: boolean;
  applyState?: SyncApplyState | null;
  createdTargetTransactionId?: string | null;
  createdTargetMarker?: string | null;
};

function normalizeId(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  const id = value.trim();
  if (!id) throw new AppDbValidationError("ID must not be empty");
  return id;
}

function normalizeOptionalText(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > 4000) throw new AppDbValidationError(`${label} is too long`);
  return text;
}

function rowToRun(row: SyncFlowRunRow): SyncFlowRun {
  return {
    id: row.id,
    flowId: row.flow_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: parseEnvelope(row.summary_json, "summary"),
    error: parseOptionalEnvelope(row.error_json, "error"),
    createdByTrigger: (row.created_by_trigger ?? "manual_preview") as SyncRunTrigger,
    sourceSnapshotSummary: parseOptionalEnvelope(row.source_snapshot_summary_json, "sourceSnapshotSummary"),
    targetSnapshotSummary: parseOptionalEnvelope(row.target_snapshot_summary_json, "targetSnapshotSummary"),
    counts: parseOptionalEnvelope(row.counts_json, "counts"),
  };
}

function rowToRunItem(row: SyncFlowRunItemRow): SyncFlowRunItem {
  return {
    id: row.id,
    runId: row.run_id,
    flowId: row.flow_id,
    sequence: row.sequence ?? null,
    sourceItemRef: parseEnvelope(row.source_item_ref_json, "sourceItemRef"),
    targetItemRef: parseOptionalEnvelope(row.target_item_ref_json, "targetItemRef"),
    status: row.status,
    message: row.message,
    sourceEntityType: row.source_entity_type as SyncEntityType | null,
    sourceItemKey: row.source_item_key,
    sourceTransactionId: row.source_transaction_id,
    sourceSplitId: row.source_split_id,
    sourceFingerprint: row.source_fingerprint,
    plannedAction: row.planned_action,
    plannedTargetPayload: parseOptionalEnvelope(row.planned_target_payload_json, "plannedTargetPayload"),
    classification: row.classification as SyncItemClassification | null,
    duplicateConfidence: row.duplicate_confidence as SyncDuplicateConfidence | null,
    warnings: parseOptionalEnvelope(row.warnings_json, "warnings"),
    errors: parseOptionalEnvelope(row.errors_json, "errors"),
    selectedForApply: row.selected_for_apply === 1,
    applyState: row.apply_state as SyncApplyState | null,
    createdTargetTransactionId: row.created_target_transaction_id,
    createdTargetMarker: row.created_target_marker,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSyncFlowRun(db: SqliteDatabase, input: CreateSyncFlowRunInput = {}): SyncFlowRun {
  const now = new Date().toISOString();
  const id = normalizeId(input.id, generateId());
  const summary = normalizeEnvelope(input.summary, "summary");
  const error = normalizeOptionalEnvelope(input.error, "error");
  const sourceSnapshotSummary = normalizeOptionalEnvelope(input.sourceSnapshotSummary, "sourceSnapshotSummary");
  const targetSnapshotSummary = normalizeOptionalEnvelope(input.targetSnapshotSummary, "targetSnapshotSummary");
  const counts = normalizeOptionalEnvelope(input.counts, "counts");

  db.prepare(
    `INSERT INTO sync_flow_runs (
      id,
      flow_id,
      status,
      started_at,
      finished_at,
      summary_json,
      error_json,
      created_by_trigger,
      source_snapshot_summary_json,
      target_snapshot_summary_json,
      counts_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.flowId ?? null,
    input.status ?? "draft_preview",
    input.startedAt ?? now,
    input.finishedAt ?? null,
    stringifyEnvelope(summary),
    stringifyEnvelope(error),
    input.createdByTrigger ?? "manual_preview",
    stringifyEnvelope(sourceSnapshotSummary),
    stringifyEnvelope(targetSnapshotSummary),
    stringifyEnvelope(counts)
  );

  const created = getSyncFlowRun(db, id);
  if (!created) throw new AppDbValidationError("Failed to create sync run");
  return created;
}

export function getSyncFlowRun(db: SqliteDatabase, runId: string): SyncFlowRun | null {
  const row = db.prepare("SELECT * FROM sync_flow_runs WHERE id = ?").get<SyncFlowRunRow>(runId);
  return row ? rowToRun(row) : null;
}

export function listSyncFlowRuns(db: SqliteDatabase, options: { flowId?: string; limit?: number } = {}): SyncFlowRun[] {
  const limit = clampLimit(options.limit, 50, 200);

  if (options.flowId) {
    return db
      .prepare("SELECT * FROM sync_flow_runs WHERE flow_id = ? ORDER BY started_at DESC LIMIT ?")
      .all<SyncFlowRunRow>(options.flowId, limit)
      .map(rowToRun);
  }

  return db
    .prepare("SELECT * FROM sync_flow_runs ORDER BY started_at DESC LIMIT ?")
    .all<SyncFlowRunRow>(limit)
    .map(rowToRun);
}

/**
 * Build the same `SyncFlowRunItem` shape `createSyncFlowRunItem` would
 * produce, without writing it to the database.
 *
 * For classifications nothing ever acts on or reviews again (`already_synced`
 * today), persisting a row every run is how this table grew past 100k rows
 * from routine unattended ticks alone — the aggregate count already lives
 * cheaply in the run's own `counts` envelope, and apply never reads these
 * items back. The browser session still needs to display them (the "Already
 * synced" filter tile), so the caller returns this alongside the persisted
 * items rather than dropping it.
 */
export function buildEphemeralSyncFlowRunItem(input: CreateSyncFlowRunItemInput): SyncFlowRunItem {
  const now = new Date().toISOString();
  const id = normalizeId(input.id, generateId());
  return {
    id,
    runId: input.runId,
    flowId: input.flowId ?? null,
    sequence: input.sequence ?? null,
    sourceItemRef: normalizeEnvelope(input.sourceItemRef, "sourceItemRef"),
    targetItemRef: normalizeOptionalEnvelope(input.targetItemRef, "targetItemRef"),
    status: input.status ?? "planned",
    message: normalizeOptionalText(input.message, "message"),
    sourceEntityType: input.sourceEntityType ?? null,
    sourceItemKey: normalizeOptionalText(input.sourceItemKey, "sourceItemKey"),
    sourceTransactionId: normalizeOptionalText(input.sourceTransactionId, "sourceTransactionId"),
    sourceSplitId: normalizeOptionalText(input.sourceSplitId, "sourceSplitId"),
    sourceFingerprint: normalizeOptionalText(input.sourceFingerprint, "sourceFingerprint"),
    plannedAction: normalizeOptionalText(input.plannedAction, "plannedAction"),
    plannedTargetPayload: normalizeOptionalEnvelope(input.plannedTargetPayload, "plannedTargetPayload"),
    classification: input.classification ?? null,
    duplicateConfidence: input.duplicateConfidence ?? null,
    warnings: normalizeOptionalEnvelope(input.warnings, "warnings"),
    errors: normalizeOptionalEnvelope(input.errors, "errors"),
    selectedForApply: input.selectedForApply ?? false,
    applyState: input.applyState ?? null,
    createdTargetTransactionId: normalizeOptionalText(input.createdTargetTransactionId, "createdTargetTransactionId"),
    createdTargetMarker: normalizeOptionalText(input.createdTargetMarker, "createdTargetMarker"),
    createdAt: now,
    updatedAt: now,
  };
}

export function createSyncFlowRunItem(db: SqliteDatabase, input: CreateSyncFlowRunItemInput): SyncFlowRunItem {
  const now = new Date().toISOString();
  const id = normalizeId(input.id, generateId());
  const sourceItemRef = normalizeEnvelope(input.sourceItemRef, "sourceItemRef");
  const targetItemRef = normalizeOptionalEnvelope(input.targetItemRef, "targetItemRef");
  const plannedTargetPayload = normalizeOptionalEnvelope(input.plannedTargetPayload, "plannedTargetPayload");
  const warnings = normalizeOptionalEnvelope(input.warnings, "warnings");
  const errors = normalizeOptionalEnvelope(input.errors, "errors");

  db.prepare(
    `INSERT INTO sync_flow_run_items (
      id,
      run_id,
      flow_id,
      sequence,
      source_item_ref_json,
      target_item_ref_json,
      status,
      message,
      source_entity_type,
      source_item_key,
      source_transaction_id,
      source_split_id,
      source_fingerprint,
      planned_action,
      planned_target_payload_json,
      classification,
      duplicate_confidence,
      warnings_json,
      errors_json,
      selected_for_apply,
      apply_state,
      created_target_transaction_id,
      created_target_marker,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.runId,
    input.flowId ?? null,
    input.sequence ?? null,
    stringifyEnvelope(sourceItemRef),
    stringifyEnvelope(targetItemRef),
    input.status ?? "planned",
    normalizeOptionalText(input.message, "message"),
    input.sourceEntityType ?? null,
    normalizeOptionalText(input.sourceItemKey, "sourceItemKey"),
    normalizeOptionalText(input.sourceTransactionId, "sourceTransactionId"),
    normalizeOptionalText(input.sourceSplitId, "sourceSplitId"),
    normalizeOptionalText(input.sourceFingerprint, "sourceFingerprint"),
    normalizeOptionalText(input.plannedAction, "plannedAction"),
    stringifyEnvelope(plannedTargetPayload),
    input.classification ?? null,
    input.duplicateConfidence ?? null,
    stringifyEnvelope(warnings),
    stringifyEnvelope(errors),
    input.selectedForApply ? 1 : 0,
    input.applyState ?? null,
    normalizeOptionalText(input.createdTargetTransactionId, "createdTargetTransactionId"),
    normalizeOptionalText(input.createdTargetMarker, "createdTargetMarker"),
    now,
    now
  );

  const created = getSyncFlowRunItem(db, id);
  if (!created) throw new AppDbValidationError("Failed to create sync run item");
  return created;
}

export function getSyncFlowRunItem(db: SqliteDatabase, itemId: string): SyncFlowRunItem | null {
  const row = db.prepare("SELECT * FROM sync_flow_run_items WHERE id = ?").get<SyncFlowRunItemRow>(itemId);
  return row ? rowToRunItem(row) : null;
}

// Order by explicit planner sequence first (nulls last for legacy rows), then
// fall back to creation order for stability.
const RUN_ITEMS_ORDER = "ORDER BY sequence IS NULL, sequence ASC, created_at ASC, id ASC";

export function listSyncFlowRunItems(db: SqliteDatabase, options: { runId: string; limit?: number }): SyncFlowRunItem[] {
  const limit = clampLimit(options.limit, 200, 500);
  return db
    .prepare(`SELECT * FROM sync_flow_run_items WHERE run_id = ? ${RUN_ITEMS_ORDER} LIMIT ?`)
    .all<SyncFlowRunItemRow>(options.runId, limit)
    .map(rowToRunItem);
}

/**
 * Every item for a run, uncapped. Apply must process the run's full item set —
 * a capped page would silently skip planned items — and the run's items are a
 * bounded, one-time snapshot, so returning them all is safe.
 */
export function getAllSyncFlowRunItems(db: SqliteDatabase, runId: string): SyncFlowRunItem[] {
  return db
    .prepare(`SELECT * FROM sync_flow_run_items WHERE run_id = ? ${RUN_ITEMS_ORDER}`)
    .all<SyncFlowRunItemRow>(runId)
    .map(rowToRunItem);
}

export type UpdateSyncFlowRunPatch = {
  status?: SyncRunStatus;
  finishedAt?: string | null;
  summary?: JsonEnvelope;
  error?: JsonEnvelope | null;
  counts?: JsonEnvelope | null;
  /** Sent by an apply: the write is refused unless this claim still owns the run. */
  applyToken?: string | null;
};

/**
 * Refuse a write from an apply that no longer owns its run: another apply took
 * it over, or it was closed as abandoned. Writes without a token are not from an
 * apply and are not checked.
 */
function assertApplyOwner(db: SqliteDatabase, runId: string, applyToken: string | null | undefined): void {
  if (applyToken == null) return;
  const owned = db
    .prepare(
      `SELECT 1 AS owned FROM sync_flow_runs
       WHERE id = ? AND status = 'applying' AND json_extract(summary_json, '$.data.applyToken') = ?`
    )
    .get<{ owned: number }>(runId, applyToken);
  if (!owned) throw new AppDbConflictError("This apply no longer owns the run; its write was refused.");
}

export { ABANDONED_APPLY_MS };

/**
 * Atomically move a run to `applying`, only from one of `from` and only while no
 * other run of the same flow is applying. Exactly one caller wins, so a double
 * click, a second tab or a second preview cannot write the same rows twice.
 * Returns the token that identifies this apply, or null when it lost.
 */
export function claimSyncFlowRun(db: SqliteDatabase, runId: string, from: readonly SyncRunStatus[]): string | null {
  if (from.length === 0) return null;
  const run = getSyncFlowRun(db, runId);
  // A run whose flow was deleted has nothing to apply to and could never be cleaned up.
  if (!run?.flowId) return null;
  const flowId = run.flowId;
  const token = generateId();
  const now = new Date();
  const placeholders = from.map(() => "?").join(", ");
  const claim = db.transaction(() => {
    failAbandonedSyncRuns(db, flowId, new Date(now.getTime() - ABANDONED_APPLY_MS).toISOString());
    return db
      .prepare(
        `UPDATE sync_flow_runs
         SET status = 'applying',
             finished_at = NULL,
             summary_json = json_set(summary_json, '$.data.applyStartedAt', ?, '$.data.applyHeartbeatAt', ?, '$.data.applyToken', ?)
         WHERE id = ? AND status IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1 FROM sync_flow_runs other
             WHERE other.flow_id = sync_flow_runs.flow_id AND other.status = 'applying' AND other.id <> sync_flow_runs.id
           )`
      )
      .run(now.toISOString(), now.toISOString(), token, runId, ...from).changes;
  });
  return claim() === 1 ? token : null;
}

/** Renew an apply's claim. False means the run no longer belongs to this apply. */
export function heartbeatSyncFlowRun(db: SqliteDatabase, runId: string, token: string): boolean {
  return (
    db
      .prepare(
        `UPDATE sync_flow_runs
         SET summary_json = json_set(summary_json, '$.data.applyHeartbeatAt', ?)
         WHERE id = ? AND status = 'applying' AND json_extract(summary_json, '$.data.applyToken') = ?`
      )
      .run(new Date().toISOString(), runId, token).changes === 1
  );
}

/**
 * Close applies whose writer stopped renewing its claim (a closed tab, a killed
 * worker), which would otherwise read as "applying" forever. Mappings and target
 * markers keep the next preview correct, so it is enough to end the run and say
 * what happened.
 */
export function failAbandonedSyncRuns(db: SqliteDatabase, flowId: string, olderThanIso: string): number {
  const now = new Date().toISOString();
  const error = stringifyEnvelope({
    version: 1,
    data: { code: "apply_interrupted", message: "This apply did not finish. Run a new preview to pick up anything it missed." },
  });
  return db
    .prepare(
      `UPDATE sync_flow_runs
       SET status = 'failed', finished_at = ?, error_json = ?
       WHERE flow_id = ? AND status = 'applying'
         AND COALESCE(json_extract(summary_json, '$.data.applyHeartbeatAt'), json_extract(summary_json, '$.data.applyStartedAt'), started_at) < ?`
    )
    .run(now, error, flowId, olderThanIso).changes;
}

export function updateSyncFlowRun(
  db: SqliteDatabase,
  runId: string,
  patch: UpdateSyncFlowRunPatch
): SyncFlowRun | null {
  const existing = getSyncFlowRun(db, runId);
  if (!existing) return null;
  assertApplyOwner(db, runId, patch.applyToken);

  const summary = patch.summary === undefined ? existing.summary : normalizeEnvelope(patch.summary, "summary");
  const error = patch.error === undefined ? existing.error : normalizeOptionalEnvelope(patch.error, "error");
  const counts = patch.counts === undefined ? existing.counts : normalizeOptionalEnvelope(patch.counts, "counts");

  db.prepare(
    `UPDATE sync_flow_runs
     SET status = ?,
         finished_at = ?,
         summary_json = ?,
         error_json = ?,
         counts_json = ?
     WHERE id = ?`
  ).run(
    patch.status ?? existing.status,
    patch.finishedAt === undefined ? existing.finishedAt : patch.finishedAt,
    stringifyEnvelope(summary),
    stringifyEnvelope(error),
    stringifyEnvelope(counts),
    runId
  );

  return getSyncFlowRun(db, runId);
}

/**
 * When this flow's settings last had a complete account scan, or null. A scan of
 * different settings does not count: the new settings have never seen the rest
 * of the account.
 */
export function lastFullScanAt(db: SqliteDatabase, flowId: string, planHash: string): string | null {
  const row = db
    .prepare(
      `SELECT MAX(json_extract(summary_json, '$.data.fullScanAt')) AS at
       FROM sync_flow_runs
       WHERE flow_id = ? AND json_extract(summary_json, '$.data.flowPlanHash') = ?`
    )
    .get<{ at: string | null }>(flowId, planHash);
  return row?.at ?? null;
}

/** What each flow's latest run left for a person to deal with. */
export type SyncFlowAttention = {
  flowId: string;
  runId: string;
  status: string;
  at: string;
  failed: number;
  waitingForRate: number;
  blocked: number;
  review: number;
  error: string | null;
};

export function listSyncFlowAttention(db: SqliteDatabase): SyncFlowAttention[] {
  const runs = db
    .prepare(
      `SELECT r.id, r.flow_id, r.status, COALESCE(r.finished_at, r.started_at) AS at, r.error_json
       FROM sync_flow_runs r
       WHERE r.flow_id IS NOT NULL
         AND r.id = (SELECT o.id FROM sync_flow_runs o WHERE o.flow_id = r.flow_id ORDER BY o.started_at DESC, o.id DESC LIMIT 1)`
    )
    .all<{ id: string; flow_id: string; status: string; at: string; error_json: string | null }>();
  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN apply_state = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN apply_state = 'pending' AND classification = 'blocked' AND warnings_json LIKE '%fx_rate_pending%' THEN 1 ELSE 0 END) AS waiting,
       SUM(CASE WHEN apply_state = 'pending' AND classification = 'blocked' AND warnings_json NOT LIKE '%fx_rate_pending%' THEN 1 ELSE 0 END) AS blocked,
       SUM(CASE WHEN apply_state = 'pending' AND classification IN ('exact_duplicate', 'strong_duplicate', 'weak_duplicate', 'source_changed_since_sync', 'source_missing', 'target_missing', 'warning')
                 AND COALESCE(warnings_json, '') NOT LIKE '%exact_duplicate_auto_map%' THEN 1 ELSE 0 END) AS review
     FROM sync_flow_run_items WHERE run_id = ?`
  );
  const out: SyncFlowAttention[] = [];
  for (const run of runs) {
    const row = counts.get<{ failed: number | null; waiting: number | null; blocked: number | null; review: number | null }>(run.id);
    const error = parseOptionalEnvelope(run.error_json, "error");
    const message = typeof error?.data?.message === "string" ? error.data.message : null;
    const entry: SyncFlowAttention = {
      flowId: run.flow_id,
      runId: run.id,
      status: run.status,
      at: run.at,
      failed: row?.failed ?? 0,
      waitingForRate: row?.waiting ?? 0,
      blocked: row?.blocked ?? 0,
      review: row?.review ?? 0,
      error: run.status === "failed" ? message : null,
    };
    if (entry.failed + entry.waitingForRate + entry.blocked + entry.review > 0 || entry.status === "failed") out.push(entry);
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export type UpdateSyncFlowRunItemPatch = {
  status?: string;
  message?: string | null;
  applyState?: SyncApplyState | null;
  warnings?: JsonEnvelope | null;
  errors?: JsonEnvelope | null;
  targetItemRef?: JsonEnvelope | null;
  /** The payload apply will write, when the user changed it (a charged amount). */
  plannedTargetPayload?: JsonEnvelope | null;
  selectedForApply?: boolean;
  createdTargetTransactionId?: string | null;
  createdTargetMarker?: string | null;
  /** Sent by an apply: the write is refused unless this claim still owns the item's run. */
  applyToken?: string | null;
};

export function updateSyncFlowRunItem(
  db: SqliteDatabase,
  itemId: string,
  patch: UpdateSyncFlowRunItemPatch
): SyncFlowRunItem | null {
  const existing = getSyncFlowRunItem(db, itemId);
  if (!existing) return null;
  assertApplyOwner(db, existing.runId, patch.applyToken);

  const warnings = patch.warnings === undefined ? existing.warnings : normalizeOptionalEnvelope(patch.warnings, "warnings");
  const errors = patch.errors === undefined ? existing.errors : normalizeOptionalEnvelope(patch.errors, "errors");
  const targetItemRef =
    patch.targetItemRef === undefined ? existing.targetItemRef : normalizeOptionalEnvelope(patch.targetItemRef, "targetItemRef");
  const plannedTargetPayload =
    patch.plannedTargetPayload === undefined
      ? existing.plannedTargetPayload
      : normalizeOptionalEnvelope(patch.plannedTargetPayload, "plannedTargetPayload");

  db.prepare(
    `UPDATE sync_flow_run_items
     SET status = ?,
         message = ?,
         apply_state = ?,
         warnings_json = ?,
         errors_json = ?,
         target_item_ref_json = ?,
         planned_target_payload_json = ?,
         selected_for_apply = ?,
         created_target_transaction_id = ?,
         created_target_marker = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    patch.status ?? existing.status,
    patch.message === undefined ? existing.message : normalizeOptionalText(patch.message, "message"),
    patch.applyState === undefined ? existing.applyState : patch.applyState,
    stringifyEnvelope(warnings),
    stringifyEnvelope(errors),
    stringifyEnvelope(targetItemRef),
    stringifyEnvelope(plannedTargetPayload),
    (patch.selectedForApply === undefined ? existing.selectedForApply : patch.selectedForApply) ? 1 : 0,
    patch.createdTargetTransactionId === undefined
      ? existing.createdTargetTransactionId
      : normalizeOptionalText(patch.createdTargetTransactionId, "createdTargetTransactionId"),
    patch.createdTargetMarker === undefined
      ? existing.createdTargetMarker
      : normalizeOptionalText(patch.createdTargetMarker, "createdTargetMarker"),
    new Date().toISOString(),
    itemId
  );

  return getSyncFlowRunItem(db, itemId);
}

/**
 * Retention: keep the newest `keep` runs per flow and delete the rest.
 * `sync_flow_run_items` cascades with its run (`ON DELETE CASCADE`), so
 * pruning a run's history is one delete, not two.
 *
 * Per flow rather than globally, for the same reason `pruneAutomationRuns`
 * (automationRunRepository.ts) is: a flow ticking every 15 minutes should not
 * age out the only handful of runs an occasional flow has ever had.
 *
 * Runs whose flow has been deleted (`flow_id` is NULL, because the column is
 * ON DELETE SET NULL) are one more group, not an exemption. Skipping them -
 * which an ordinary `=` join does silently, since NULL = NULL is never true -
 * left every run of every deleted flow, and all of its items, in the database
 * permanently: unreachable from the Sync page, which lists runs per flow, and
 * beyond the reach of the only thing that cleans this table up. `IS` is
 * SQLite's NULL-safe comparison, so they age out like anything else.
 */
export function pruneSyncFlowRuns(db: SqliteDatabase, keep: number): number {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new AppDbValidationError("keep must be a positive integer");
  }

  const result = db
    .prepare(
      `DELETE FROM sync_flow_runs
        WHERE id NOT IN (
          SELECT id FROM sync_flow_runs AS ranked
           WHERE ranked.flow_id IS sync_flow_runs.flow_id
           ORDER BY started_at DESC
           LIMIT ?
        )`
    )
    .run(keep);

  return result.changes;
}

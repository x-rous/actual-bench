import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import type {
  JsonEnvelope,
  JsonObject,
  JsonValue,
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
  leg_id: string | null;
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
  legId?: string | null;
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

const EMPTY_ENVELOPE: JsonEnvelope = { version: 1, data: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function normalizeJsonObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new AppDbValidationError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function normalizeEnvelope(value: JsonEnvelope | undefined, label: string): JsonEnvelope {
  if (value === undefined) return EMPTY_ENVELOPE;
  if (!isRecord(value)) throw new AppDbValidationError(`${label} must be a versioned JSON envelope`);

  if (!Number.isInteger(value.version) || value.version < 1) {
    throw new AppDbValidationError(`${label}.version must be a positive integer`);
  }

  return { version: value.version, data: normalizeJsonObject(value.data, `${label}.data`) };
}

function normalizeOptionalEnvelope(value: JsonEnvelope | null | undefined, label: string): JsonEnvelope | null {
  if (value === undefined || value === null) return null;
  return normalizeEnvelope(value, label);
}

function parseEnvelope(raw: string, label: string): JsonEnvelope {
  try {
    const parsed = JSON.parse(raw) as JsonEnvelope;
    return normalizeEnvelope(parsed, label);
  } catch {
    throw new AppDbValidationError(`${label} contains invalid JSON`);
  }
}

function parseOptionalEnvelope(raw: string | null | undefined, label: string): JsonEnvelope | null {
  return raw ? parseEnvelope(raw, label) : null;
}

function stringifyEnvelope(envelope: JsonEnvelope | null): string | null {
  return envelope ? JSON.stringify(envelope) : null;
}

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
    legId: row.leg_id,
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
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

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
      leg_id,
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
    input.legId ?? null,
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

export function listSyncFlowRunItems(db: SqliteDatabase, options: { runId: string; limit?: number }): SyncFlowRunItem[] {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  return db
    .prepare("SELECT * FROM sync_flow_run_items WHERE run_id = ? ORDER BY created_at ASC, id ASC LIMIT ?")
    .all<SyncFlowRunItemRow>(options.runId, limit)
    .map(rowToRunItem);
}

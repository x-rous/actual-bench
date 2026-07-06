import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import type {
  SqliteDatabase,
  SyncEntityType,
  SyncMapping,
  SyncMappingInput,
  SyncMappingPatch,
  SyncMappingStatus,
} from "./types";

type SyncMappingRow = {
  id: string;
  flow_id: string;
  source_connection_fingerprint: string;
  source_budget_id: string;
  source_account_id: string | null;
  source_entity_type: string;
  source_transaction_id: string | null;
  source_split_id: string | null;
  source_item_key: string;
  source_fingerprint: string;
  target_connection_fingerprint: string;
  target_budget_id: string;
  target_account_id: string | null;
  target_entity_type: string;
  target_transaction_id: string | null;
  target_item_key: string | null;
  target_fingerprint: string | null;
  target_marker: string | null;
  created_run_id: string | null;
  status: string;
  last_seen_at: string | null;
  last_applied_at: string | null;
  created_at: string;
  updated_at: string;
};

function isSyncEntityType(value: string): value is SyncEntityType {
  return value === "transaction" || value === "split_line" || value === "payee" || value === "category" || value === "category_group";
}

function isSyncMappingStatus(value: string): value is SyncMappingStatus {
  return value === "active" || value === "source_missing" || value === "target_missing" || value === "disabled";
}

function normalizeRequiredText(value: string | undefined | null, label: string): string {
  if (typeof value !== "string") throw new AppDbValidationError(`${label} is required`);
  const text = value.trim();
  if (!text) throw new AppDbValidationError(`${label} is required`);
  if (text.length > 1000) throw new AppDbValidationError(`${label} is too long`);
  return text;
}

function normalizeOptionalText(value: string | undefined | null, label: string): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > 4000) throw new AppDbValidationError(`${label} is too long`);
  return text;
}

function normalizeEntityType(value: SyncEntityType, label: string): SyncEntityType {
  if (!isSyncEntityType(value)) throw new AppDbValidationError(`${label} is not supported`);
  return value;
}

function normalizeStatus(value: SyncMappingStatus | undefined): SyncMappingStatus {
  if (value === undefined) return "active";
  if (!isSyncMappingStatus(value)) throw new AppDbValidationError("Mapping status is not supported");
  return value;
}

function rowToMapping(row: SyncMappingRow): SyncMapping {
  return {
    id: row.id,
    flowId: row.flow_id,
    sourceConnectionFingerprint: row.source_connection_fingerprint,
    sourceBudgetId: row.source_budget_id,
    sourceAccountId: row.source_account_id,
    sourceEntityType: row.source_entity_type as SyncEntityType,
    sourceTransactionId: row.source_transaction_id,
    sourceSplitId: row.source_split_id,
    sourceItemKey: row.source_item_key,
    sourceFingerprint: row.source_fingerprint,
    targetConnectionFingerprint: row.target_connection_fingerprint,
    targetBudgetId: row.target_budget_id,
    targetAccountId: row.target_account_id,
    targetEntityType: row.target_entity_type as SyncEntityType,
    targetTransactionId: row.target_transaction_id,
    targetItemKey: row.target_item_key,
    targetFingerprint: row.target_fingerprint,
    targetMarker: row.target_marker,
    createdRunId: row.created_run_id,
    status: row.status as SyncMappingStatus,
    lastSeenAt: row.last_seen_at,
    lastAppliedAt: row.last_applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSyncMapping(db: SqliteDatabase, input: SyncMappingInput): SyncMapping {
  const now = new Date().toISOString();
  const id = normalizeOptionalText(input.id, "id") ?? generateId();

  db.prepare(
    `INSERT INTO sync_mappings (
      id,
      flow_id,
      source_connection_fingerprint,
      source_budget_id,
      source_account_id,
      source_entity_type,
      source_transaction_id,
      source_split_id,
      source_item_key,
      source_fingerprint,
      target_connection_fingerprint,
      target_budget_id,
      target_account_id,
      target_entity_type,
      target_transaction_id,
      target_item_key,
      target_fingerprint,
      target_marker,
      created_run_id,
      status,
      last_seen_at,
      last_applied_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    normalizeRequiredText(input.flowId, "flowId"),
    normalizeRequiredText(input.sourceConnectionFingerprint, "sourceConnectionFingerprint"),
    normalizeRequiredText(input.sourceBudgetId, "sourceBudgetId"),
    normalizeOptionalText(input.sourceAccountId, "sourceAccountId"),
    normalizeEntityType(input.sourceEntityType, "sourceEntityType"),
    normalizeOptionalText(input.sourceTransactionId, "sourceTransactionId"),
    normalizeOptionalText(input.sourceSplitId, "sourceSplitId"),
    normalizeRequiredText(input.sourceItemKey, "sourceItemKey"),
    normalizeRequiredText(input.sourceFingerprint, "sourceFingerprint"),
    normalizeRequiredText(input.targetConnectionFingerprint, "targetConnectionFingerprint"),
    normalizeRequiredText(input.targetBudgetId, "targetBudgetId"),
    normalizeOptionalText(input.targetAccountId, "targetAccountId"),
    normalizeEntityType(input.targetEntityType, "targetEntityType"),
    normalizeOptionalText(input.targetTransactionId, "targetTransactionId"),
    normalizeOptionalText(input.targetItemKey, "targetItemKey"),
    normalizeOptionalText(input.targetFingerprint, "targetFingerprint"),
    normalizeOptionalText(input.targetMarker, "targetMarker"),
    normalizeOptionalText(input.createdRunId, "createdRunId"),
    normalizeStatus(input.status),
    input.lastSeenAt ?? null,
    input.lastAppliedAt ?? null,
    now,
    now
  );

  const created = getSyncMapping(db, id);
  if (!created) throw new AppDbValidationError("Failed to create sync mapping");
  return created;
}

export function getSyncMapping(db: SqliteDatabase, mappingId: string): SyncMapping | null {
  const row = db.prepare("SELECT * FROM sync_mappings WHERE id = ?").get<SyncMappingRow>(mappingId);
  return row ? rowToMapping(row) : null;
}

export function getSyncMappingBySource(db: SqliteDatabase, flowId: string, sourceItemKey: string): SyncMapping | null {
  const row = db
    .prepare("SELECT * FROM sync_mappings WHERE flow_id = ? AND source_item_key = ?")
    .get<SyncMappingRow>(flowId, sourceItemKey);
  return row ? rowToMapping(row) : null;
}

export function listSyncMappings(
  db: SqliteDatabase,
  options: { flowId?: string; status?: SyncMappingStatus; limit?: number } = {}
): SyncMapping[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.flowId) {
    conditions.push("flow_id = ?");
    params.push(options.flowId);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM sync_mappings ${where} ORDER BY updated_at DESC, created_at DESC LIMIT ?`)
    .all<SyncMappingRow>(...params, limit)
    .map(rowToMapping);
}

export function updateSyncMapping(db: SqliteDatabase, mappingId: string, patch: SyncMappingPatch): SyncMapping | null {
  const existing = getSyncMapping(db, mappingId);
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sync_mappings
     SET source_fingerprint = ?,
         target_transaction_id = ?,
         target_item_key = ?,
         target_fingerprint = ?,
         target_marker = ?,
         created_run_id = ?,
         status = ?,
         last_seen_at = ?,
         last_applied_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    patch.sourceFingerprint === undefined ? existing.sourceFingerprint : normalizeRequiredText(patch.sourceFingerprint, "sourceFingerprint"),
    patch.targetTransactionId === undefined ? existing.targetTransactionId : normalizeOptionalText(patch.targetTransactionId, "targetTransactionId"),
    patch.targetItemKey === undefined ? existing.targetItemKey : normalizeOptionalText(patch.targetItemKey, "targetItemKey"),
    patch.targetFingerprint === undefined ? existing.targetFingerprint : normalizeOptionalText(patch.targetFingerprint, "targetFingerprint"),
    patch.targetMarker === undefined ? existing.targetMarker : normalizeOptionalText(patch.targetMarker, "targetMarker"),
    patch.createdRunId === undefined ? existing.createdRunId : normalizeOptionalText(patch.createdRunId, "createdRunId"),
    patch.status === undefined ? existing.status : normalizeStatus(patch.status),
    patch.lastSeenAt === undefined ? existing.lastSeenAt : patch.lastSeenAt,
    patch.lastAppliedAt === undefined ? existing.lastAppliedAt : patch.lastAppliedAt,
    now,
    mappingId
  );

  return getSyncMapping(db, mappingId);
}

import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import {
  EMPTY_ENVELOPE,
  isRecord,
  normalizeEnvelope as normalizeSharedEnvelope,
  parseEnvelope as parseSharedEnvelope,
} from "./jsonEnvelope";
import type { JsonEnvelope, SqliteDatabase, SyncDomain, SyncFlow } from "./types";

type SyncFlowRow = {
  id: string;
  name: string;
  enabled: number;
  flow_type?: string;
  description: string | null;
  source_ref_json: string;
  target_ref_json: string;
  filter_json: string;
  transform_json: string;
  options_json: string;
  created_at: string;
  updated_at: string;
};

type NormalizedRefs = {
  sourceRef: JsonEnvelope;
  targetRef: JsonEnvelope;
  filter: JsonEnvelope;
  transform: JsonEnvelope;
  options: JsonEnvelope;
};

type NormalizedFlowInput = {
  name?: string;
  enabled?: boolean;
  flowType?: SyncDomain;
  description?: string | null;
  refs?: NormalizedRefs;
};

/** Flow metadata is user-supplied configuration, so credential-looking fields
 * are rejected: a secret belongs in the vault, referenced by fingerprint. */
function normalizeEnvelope(value: unknown, label: string): JsonEnvelope {
  return normalizeSharedEnvelope(value, label, { rejectSecrets: true });
}

function parseEnvelope(raw: string, label: string): JsonEnvelope {
  return parseSharedEnvelope(raw, label, { rejectSecrets: true });
}

function stringifyEnvelope(envelope: JsonEnvelope): string {
  return JSON.stringify(envelope);
}

function normalizeName(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") {
    throw new AppDbValidationError("Flow name is required");
  }

  const name = value.trim();
  if (!name) throw new AppDbValidationError("Flow name is required");
  if (name.length > 120) throw new AppDbValidationError("Flow name must be 120 characters or fewer");
  return name;
}

function normalizeDescription(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AppDbValidationError("Flow description must be text");
  }

  const description = value.trim();
  if (!description) return null;
  if (description.length > 1000) {
    throw new AppDbValidationError("Flow description must be 1000 characters or fewer");
  }
  return description;
}

function normalizeEnabled(value: unknown, defaultValue?: boolean): boolean | undefined {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw new AppDbValidationError("Flow enabled must be true or false");
  }
  return value;
}

function normalizeFlowType(value: unknown): SyncDomain | undefined {
  if (value === undefined) return undefined;
  if (value !== "transaction_sync" && value !== "payee_sync" && value !== "category_sync" && value !== "master_data_sync" && value !== "consolidation_sync") {
    throw new AppDbValidationError("Flow type is not supported");
  }
  return value;
}

/**
 * A flow is one source -> one target, not a multi-leg pipeline: nothing ever
 * created more than one `sync_flow_legs` row per flow, and the UI never
 * exposed a way to. The refs are still nested under a single `legs: [{...}]`
 * array on the wire, matching what the client form has always sent
 * (`flowForm.ts`'s `buildFlowPayload`).
 *
 * A second leg is rejected rather than quietly dropped, for the same reason
 * the v31 migration refuses to collapse a multi-leg flow: accepting a route
 * and then storing only part of it is the kind of silent data loss that is
 * only discovered once the sync has been running against the wrong target.
 *
 * An empty array means "no route supplied", which on create falls back to
 * empty envelopes and on update leaves the stored refs alone. Note this is
 * deliberately *not* what the old per-leg-row model did on update - that
 * deleted every leg row, wiping the route - because clearing a flow's entire
 * route is not a plausible reading of an omitted value.
 */
function normalizeRefs(value: unknown): NormalizedRefs | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AppDbValidationError("Flow legs must be an array");
  }
  if (value.length === 0) return undefined;
  if (value.length > 1) {
    throw new AppDbValidationError(
      "A sync flow has exactly one source and one target, so it accepts at most one leg"
    );
  }
  const item = value[0];
  if (!isRecord(item)) {
    throw new AppDbValidationError("Flow leg 1 must be an object");
  }

  return {
    sourceRef: normalizeEnvelope(item.sourceRef, "legs[0].sourceRef"),
    targetRef: normalizeEnvelope(item.targetRef, "legs[0].targetRef"),
    filter: normalizeEnvelope(item.filter, "legs[0].filter"),
    transform: normalizeEnvelope(item.transform, "legs[0].transform"),
    options: item.options === undefined ? EMPTY_ENVELOPE : normalizeEnvelope(item.options, "legs[0].options"),
  };
}

function normalizeFlowInput(input: unknown, mode: "create" | "update"): NormalizedFlowInput {
  if (!isRecord(input)) {
    throw new AppDbValidationError("Request body must be an object");
  }

  return {
    name: normalizeName(input.name, mode === "create"),
    enabled: normalizeEnabled(input.enabled, mode === "create" ? true : undefined),
    flowType: normalizeFlowType(input.flowType),
    description: normalizeDescription(input.description),
    refs: normalizeRefs(input.legs),
  };
}

function rowToSyncFlow(row: SyncFlowRow): SyncFlow {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    flowType: (row.flow_type ?? "transaction_sync") as SyncDomain,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceRef: parseEnvelope(row.source_ref_json, "sourceRef"),
    targetRef: parseEnvelope(row.target_ref_json, "targetRef"),
    filter: parseEnvelope(row.filter_json, "filter"),
    transform: parseEnvelope(row.transform_json, "transform"),
    options: parseEnvelope(row.options_json, "options"),
  };
}

export function listSyncFlows(db: SqliteDatabase): SyncFlow[] {
  return db
    .prepare("SELECT * FROM sync_flows ORDER BY updated_at DESC, name COLLATE NOCASE ASC")
    .all<SyncFlowRow>()
    .map(rowToSyncFlow);
}

export function getSyncFlow(db: SqliteDatabase, flowId: string): SyncFlow | null {
  const row = db.prepare("SELECT * FROM sync_flows WHERE id = ?").get<SyncFlowRow>(flowId);
  return row ? rowToSyncFlow(row) : null;
}

export function createSyncFlow(db: SqliteDatabase, input: unknown): SyncFlow {
  const normalized = normalizeFlowInput(input, "create");
  const now = new Date().toISOString();
  const flowId = generateId();
  const refs = normalized.refs ?? {
    sourceRef: EMPTY_ENVELOPE,
    targetRef: EMPTY_ENVELOPE,
    filter: EMPTY_ENVELOPE,
    transform: EMPTY_ENVELOPE,
    options: EMPTY_ENVELOPE,
  };

  db.prepare(
    `INSERT INTO sync_flows (
      id, name, enabled, flow_type, description,
      source_ref_json, target_ref_json, filter_json, transform_json, options_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    flowId,
    normalized.name,
    normalized.enabled === false ? 0 : 1,
    normalized.flowType ?? "transaction_sync",
    normalized.description ?? null,
    stringifyEnvelope(refs.sourceRef),
    stringifyEnvelope(refs.targetRef),
    stringifyEnvelope(refs.filter),
    stringifyEnvelope(refs.transform),
    stringifyEnvelope(refs.options),
    now,
    now
  );

  const created = getSyncFlow(db, flowId);
  if (!created) throw new AppDbValidationError("Failed to create sync flow");
  return created;
}

export function updateSyncFlow(db: SqliteDatabase, flowId: string, input: unknown): SyncFlow | null {
  const existing = getSyncFlow(db, flowId);
  if (!existing) return null;

  const normalized = normalizeFlowInput(input, "update");
  const now = new Date().toISOString();
  const refs = normalized.refs;

  db.prepare(
    `UPDATE sync_flows
     SET name = ?, enabled = ?, flow_type = ?, description = ?,
         source_ref_json = ?, target_ref_json = ?, filter_json = ?, transform_json = ?, options_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    normalized.name ?? existing.name,
    normalized.enabled === undefined ? (existing.enabled ? 1 : 0) : normalized.enabled ? 1 : 0,
    normalized.flowType ?? existing.flowType,
    normalized.description === undefined ? existing.description : normalized.description,
    stringifyEnvelope(refs?.sourceRef ?? existing.sourceRef),
    stringifyEnvelope(refs?.targetRef ?? existing.targetRef),
    stringifyEnvelope(refs?.filter ?? existing.filter),
    stringifyEnvelope(refs?.transform ?? existing.transform),
    stringifyEnvelope(refs?.options ?? existing.options),
    now,
    flowId
  );

  return getSyncFlow(db, flowId);
}

export function deleteSyncFlow(db: SqliteDatabase, flowId: string): boolean {
  const result = db.prepare("DELETE FROM sync_flows WHERE id = ?").run(flowId);
  return result.changes > 0;
}

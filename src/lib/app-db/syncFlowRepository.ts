import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import {
  EMPTY_ENVELOPE,
  isRecord,
  normalizeEnvelope as normalizeSharedEnvelope,
  parseEnvelope as parseSharedEnvelope,
} from "./jsonEnvelope";
import type { JsonEnvelope, SqliteDatabase, SyncDomain, SyncFlow, SyncFlowLeg } from "./types";

type SyncFlowRow = {
  id: string;
  name: string;
  enabled: number;
  flow_type?: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type SyncFlowLegRow = {
  id: string;
  flow_id: string;
  position: number;
  source_ref_json: string;
  target_ref_json: string;
  filter_json: string;
  transform_json: string;
  options_json: string;
  created_at: string;
  updated_at: string;
};

type NormalizedLegInput = {
  id: string;
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
  legs?: NormalizedLegInput[];
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

function normalizeLegInputs(value: unknown): NormalizedLegInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AppDbValidationError("Flow legs must be an array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new AppDbValidationError(`Flow leg ${index + 1} must be an object`);
    }

    const id = item.id === undefined ? generateId() : item.id;
    if (typeof id !== "string" || !id.trim()) {
      throw new AppDbValidationError(`Flow leg ${index + 1} has an invalid id`);
    }

    return {
      id,
      sourceRef: normalizeEnvelope(item.sourceRef, `legs[${index}].sourceRef`),
      targetRef: normalizeEnvelope(item.targetRef, `legs[${index}].targetRef`),
      filter: normalizeEnvelope(item.filter, `legs[${index}].filter`),
      transform: normalizeEnvelope(item.transform, `legs[${index}].transform`),
      options: item.options === undefined
        ? EMPTY_ENVELOPE
        : normalizeEnvelope(item.options, `legs[${index}].options`),
    };
  });
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
    legs: normalizeLegInputs(input.legs),
  };
}

function legRowToSyncFlowLeg(row: SyncFlowLegRow): SyncFlowLeg {
  return {
    id: row.id,
    flowId: row.flow_id,
    position: row.position,
    sourceRef: parseEnvelope(row.source_ref_json, "sourceRef"),
    targetRef: parseEnvelope(row.target_ref_json, "targetRef"),
    filter: parseEnvelope(row.filter_json, "filter"),
    transform: parseEnvelope(row.transform_json, "transform"),
    options: parseEnvelope(row.options_json, "options"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getLegs(db: SqliteDatabase, flowId: string): SyncFlowLeg[] {
  return db
    .prepare("SELECT * FROM sync_flow_legs WHERE flow_id = ? ORDER BY position ASC, created_at ASC")
    .all<SyncFlowLegRow>(flowId)
    .map(legRowToSyncFlowLeg);
}

function rowToSyncFlow(db: SqliteDatabase, row: SyncFlowRow): SyncFlow {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    flowType: (row.flow_type ?? "transaction_sync") as SyncDomain,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    legs: getLegs(db, row.id),
  };
}

function insertLegs(db: SqliteDatabase, flowId: string, legs: NormalizedLegInput[], now: string): void {
  const insertLeg = db.prepare(
    `INSERT INTO sync_flow_legs (
      id,
      flow_id,
      position,
      source_ref_json,
      target_ref_json,
      filter_json,
      transform_json,
      options_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  legs.forEach((leg, index) => {
    insertLeg.run(
      leg.id,
      flowId,
      index,
      stringifyEnvelope(leg.sourceRef),
      stringifyEnvelope(leg.targetRef),
      stringifyEnvelope(leg.filter),
      stringifyEnvelope(leg.transform),
      stringifyEnvelope(leg.options),
      now,
      now
    );
  });
}

export function listSyncFlows(db: SqliteDatabase): SyncFlow[] {
  return db
    .prepare("SELECT * FROM sync_flows ORDER BY updated_at DESC, name COLLATE NOCASE ASC")
    .all<SyncFlowRow>()
    .map((row) => rowToSyncFlow(db, row));
}

export function getSyncFlow(db: SqliteDatabase, flowId: string): SyncFlow | null {
  const row = db.prepare("SELECT * FROM sync_flows WHERE id = ?").get<SyncFlowRow>(flowId);
  return row ? rowToSyncFlow(db, row) : null;
}

export function createSyncFlow(db: SqliteDatabase, input: unknown): SyncFlow {
  const normalized = normalizeFlowInput(input, "create");
  const now = new Date().toISOString();
  const flowId = generateId();
  const legs = normalized.legs ?? [];

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO sync_flows (id, name, enabled, flow_type, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      flowId,
      normalized.name,
      normalized.enabled === false ? 0 : 1,
      normalized.flowType ?? "transaction_sync",
      normalized.description ?? null,
      now,
      now
    );
    insertLegs(db, flowId, legs, now);
  });

  create();
  const created = getSyncFlow(db, flowId);
  if (!created) throw new AppDbValidationError("Failed to create sync flow");
  return created;
}

export function updateSyncFlow(db: SqliteDatabase, flowId: string, input: unknown): SyncFlow | null {
  const existing = getSyncFlow(db, flowId);
  if (!existing) return null;

  const normalized = normalizeFlowInput(input, "update");
  const now = new Date().toISOString();

  const update = db.transaction(() => {
    db.prepare(
      `UPDATE sync_flows
       SET name = ?, enabled = ?, flow_type = ?, description = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      normalized.name ?? existing.name,
      normalized.enabled === undefined ? (existing.enabled ? 1 : 0) : normalized.enabled ? 1 : 0,
      normalized.flowType ?? existing.flowType,
      normalized.description === undefined ? existing.description : normalized.description,
      now,
      flowId
    );

    if (normalized.legs) {
      db.prepare("DELETE FROM sync_flow_legs WHERE flow_id = ?").run(flowId);
      insertLegs(db, flowId, normalized.legs, now);
    }
  });

  update();
  return getSyncFlow(db, flowId);
}

/**
 * Persist a health pause on a flow the same way the client interval auto-pause
 * does (RD-054): disable it and stamp `autoPausedAt` into each leg's options.
 * This makes a server-scheduler pause visible via the existing "Auto-paused"
 * badge and resumable via the existing re-enable toggle (which clears
 * `autoPausedAt`). Used by the unattended scheduler after repeated failures.
 */
export function pauseSyncFlowForHealth(db: SqliteDatabase, flowId: string, pausedAtIso: string): SyncFlow | null {
  const existing = getSyncFlow(db, flowId);
  if (!existing) return null;
  const now = new Date().toISOString();

  const update = db.transaction(() => {
    db.prepare("UPDATE sync_flows SET enabled = 0, updated_at = ? WHERE id = ?").run(now, flowId);
    for (const leg of existing.legs) {
      const current =
        leg.options?.data && typeof leg.options.data === "object" && !Array.isArray(leg.options.data)
          ? (leg.options.data as Record<string, unknown>)
          : {};
      const options = { version: leg.options?.version ?? 1, data: { ...current, autoPausedAt: pausedAtIso } };
      db.prepare("UPDATE sync_flow_legs SET options_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(options),
        now,
        leg.id
      );
    }
  });

  update();
  return getSyncFlow(db, flowId);
}

export function deleteSyncFlow(db: SqliteDatabase, flowId: string): boolean {
  const result = db.prepare("DELETE FROM sync_flows WHERE id = ?").run(flowId);
  return result.changes > 0;
}

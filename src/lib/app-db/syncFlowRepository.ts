import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import type { JsonEnvelope, JsonObject, JsonValue, SqliteDatabase, SyncFlow, SyncFlowLeg } from "./types";

type SyncFlowRow = {
  id: string;
  name: string;
  enabled: number;
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
  description?: string | null;
  legs?: NormalizedLegInput[];
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

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSecretLikeKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized === "apikey" ||
    normalized.endsWith("apikey") ||
    normalized.includes("password") ||
    normalized.endsWith("token") ||
    normalized.includes("credential")
  );
}

function findSecretField(value: JsonValue, path: string): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findSecretField(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (isSecretLikeKey(key)) return nextPath;
    const found = findSecretField(item as JsonValue, nextPath);
    if (found) return found;
  }

  return null;
}

function normalizeJsonObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new AppDbValidationError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function normalizeEnvelope(value: unknown, label: string): JsonEnvelope {
  if (!isRecord(value)) {
    throw new AppDbValidationError(`${label} must be a versioned JSON envelope`);
  }

  const version = value.version;
  if (!Number.isInteger(version) || Number(version) < 1) {
    throw new AppDbValidationError(`${label}.version must be a positive integer`);
  }

  const data = normalizeJsonObject(value.data, `${label}.data`);
  const secretPath = findSecretField(data, `${label}.data`);
  if (secretPath) {
    throw new AppDbValidationError(`Metadata cannot store credential field ${secretPath}`);
  }

  return { version: Number(version), data };
}

function parseEnvelope(raw: string, label: string): JsonEnvelope {
  try {
    return normalizeEnvelope(JSON.parse(raw) as unknown, label);
  } catch (error) {
    if (error instanceof AppDbValidationError) throw error;
    throw new AppDbValidationError(`${label} contains invalid JSON`);
  }
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
      `INSERT INTO sync_flows (id, name, enabled, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      flowId,
      normalized.name,
      normalized.enabled === false ? 0 : 1,
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
       SET name = ?, enabled = ?, description = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      normalized.name ?? existing.name,
      normalized.enabled === undefined ? (existing.enabled ? 1 : 0) : normalized.enabled ? 1 : 0,
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

export function deleteSyncFlow(db: SqliteDatabase, flowId: string): boolean {
  const result = db.prepare("DELETE FROM sync_flows WHERE id = ?").run(flowId);
  return result.changes > 0;
}

import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import {
  EMPTY_ENVELOPE,
  isRecord,
  normalizeEnvelope as normalizeSharedEnvelope,
  parseEnvelope as parseSharedEnvelope,
} from "./jsonEnvelope";
import type { JsonEnvelope, SqliteDatabase } from "./types";
import type {
  BackupArtifactKind,
  BackupRetentionTier,
  BackupVerificationLevel,
  BackupVerificationStatus,
} from "@/lib/backup/manifest";

/**
 * Storage for verified backups (RD-077 / PR-047a).
 *
 * Destinations, policies, artifacts and the copies of an artifact that live in
 * each destination. Storage only — nothing here writes a file, exports a
 * budget, or decides what to prune.
 *
 * The one rule the schema enforces rather than trusts: no row may hold a
 * secret. A destination's credentials and a backup passphrase are vault
 * references, and the config envelopes are checked for credential-shaped fields
 * on the way in, the same as sync flow metadata.
 */

export type BackupDestinationKind = "local" | "s3";

export type BackupDestination = {
  id: string;
  name: string;
  kind: BackupDestinationKind;
  enabled: boolean;
  config: JsonEnvelope;
  /** Vault fingerprint. Never a secret. */
  credentialRef: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupRetention = {
  /** Copies to keep per tier. Zero disables a tier. */
  daily: number;
  weekly: number;
  monthly: number;
  yearly: number;
  /** Nothing younger than this prunes, whatever the rules say. */
  minimumAgeHours: number;
  /** How long an automatic safety point is exempt from tier retention. */
  autoProtectionDays: number;
  /** …or the newest N automatic points, whichever protects more. */
  autoProtectionCount: number;
};

export const DEFAULT_RETENTION: BackupRetention = {
  daily: 7,
  weekly: 4,
  monthly: 12,
  yearly: 3,
  minimumAgeHours: 24,
  autoProtectionDays: 14,
  autoProtectionCount: 10,
};

export type BackupPolicyContents = "budget" | "app-db" | "both";
export type BackupEncryptionMode = "none" | "passphrase";

/** How often a backup rule runs. Mirrors the automation engine's vocabulary. */
export type BackupScheduleKind = "cron" | "interval";

export type BackupPolicy = {
  id: string;
  name: string;
  enabled: boolean;
  scheduleKind: BackupScheduleKind;
  /** Set when `scheduleKind` is `cron`; five-field expression. */
  cronExpression: string | null;
  /** Set when `scheduleKind` is `interval`. */
  intervalMinutes: number | null;
  /** IANA timezone the cron expression is read in. */
  timezone: string;
  /** Whether stored copies are re-verified on a schedule. */
  scrubEnabled: boolean;
  contents: BackupPolicyContents;
  sourceRef: JsonEnvelope;
  destinationIds: string[];
  verificationLevel: BackupVerificationLevel;
  encryption: BackupEncryptionMode;
  encryptionCredentialRef: string | null;
  retention: BackupRetention;
  createdAt: string;
  updatedAt: string;
};

export type BackupArtifact = {
  id: string;
  policyId: string | null;
  kind: BackupArtifactKind;
  createdAt: string;
  sourceBudgetId: string | null;
  sourceBudgetName: string | null;
  sizeBytes: number;
  checksumSha256: string;
  plaintextChecksumSha256: string | null;
  encrypted: boolean;
  encryption: JsonEnvelope | null;
  /** Which sealed passphrase opens this copy. Never a secret. */
  encryptionCredentialRef: string | null;
  tier: BackupRetentionTier;
  pinned: boolean;
  protectedUntil: string | null;
  takenBefore: string | null;
  verificationLevel: BackupVerificationLevel | null;
  verificationStatus: BackupVerificationStatus;
  verifiedAt: string | null;
  verification: JsonEnvelope | null;
  manifestVersion: number;
  benchVersion: string | null;
  notes: string | null;
};

export type BackupLocationStatus = "stored" | "failed" | "missing" | "deleted";

export type BackupArtifactLocation = {
  id: string;
  artifactId: string;
  destinationId: string | null;
  objectKey: string;
  status: BackupLocationStatus;
  uploadedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── shared helpers ───────────────────────────────────────────────────────────

/** Destination and policy settings are user input, so credential-shaped fields
 * are refused: the secret belongs in the vault, referenced by fingerprint. */
function normalizeEnvelope(value: unknown, label: string): JsonEnvelope {
  return normalizeSharedEnvelope(value, label, { rejectSecrets: true });
}

function parseEnvelope(raw: string, label: string): JsonEnvelope {
  return parseSharedEnvelope(raw, label, { rejectSecrets: true });
}

function text(value: unknown, label: string, maxLength = 400): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new AppDbValidationError(`${label} is too long`);
  return trimmed;
}

function optionalText(value: unknown, label: string, maxLength = 2000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AppDbValidationError(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new AppDbValidationError(`${label} is too long`);
  return trimmed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AppDbValidationError(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function count(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppDbValidationError(`${label} must be zero or a positive integer`);
  }
  return value;
}

const DESTINATION_KINDS: BackupDestinationKind[] = ["local", "s3"];
const CONTENTS: BackupPolicyContents[] = ["budget", "app-db", "both"];
const LEVELS: BackupVerificationLevel[] = ["archive", "data", "deep"];
const STATUSES: BackupVerificationStatus[] = ["unverified", "passed", "failed"];
const TIERS: BackupRetentionTier[] = ["manual", "auto", "daily", "weekly", "monthly", "yearly"];
const LOCATION_STATUSES: BackupLocationStatus[] = ["stored", "failed", "missing", "deleted"];

// ── destinations ─────────────────────────────────────────────────────────────

type DestinationRow = {
  id: string;
  name: string;
  kind: string;
  enabled: number;
  config_json: string;
  credential_ref: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

function rowToDestination(row: DestinationRow): BackupDestination {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as BackupDestinationKind,
    enabled: row.enabled === 1,
    config: parseEnvelope(row.config_json, "config"),
    credentialRef: row.credential_ref,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastFailureReason: row.last_failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listBackupDestinations(db: SqliteDatabase): BackupDestination[] {
  return db
    .prepare("SELECT * FROM backup_destinations ORDER BY created_at")
    .all<DestinationRow>()
    .map(rowToDestination);
}

export function getBackupDestination(db: SqliteDatabase, id: string): BackupDestination | null {
  const row = db.prepare("SELECT * FROM backup_destinations WHERE id = ?").get<DestinationRow>(id);
  return row ? rowToDestination(row) : null;
}

export function createBackupDestination(db: SqliteDatabase, input: unknown): BackupDestination {
  if (!isRecord(input)) throw new AppDbValidationError("Destination payload must be an object");

  const now = new Date().toISOString();
  const id = input.id === undefined ? generateId() : text(input.id, "id", 64);

  db.prepare(
    `INSERT INTO backup_destinations
       (id, name, kind, enabled, config_json, credential_ref, last_success_at,
        last_failure_at, last_failure_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
  ).run(
    id,
    text(input.name, "name", 120),
    oneOf(input.kind, DESTINATION_KINDS, "kind", "local"),
    input.enabled === false ? 0 : 1,
    JSON.stringify(
      input.config === undefined ? EMPTY_ENVELOPE : normalizeEnvelope(input.config, "config")
    ),
    optionalText(input.credentialRef, "credentialRef", 200),
    now,
    now
  );

  const created = getBackupDestination(db, id);
  if (!created) throw new AppDbValidationError("Failed to create destination");
  return created;
}

export function updateBackupDestination(
  db: SqliteDatabase,
  id: string,
  input: unknown
): BackupDestination | null {
  if (!isRecord(input)) throw new AppDbValidationError("Destination payload must be an object");
  const existing = getBackupDestination(db, id);
  if (!existing) return null;

  const assignments: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (input.name !== undefined) set("name", text(input.name, "name", 120));
  if (input.enabled !== undefined) set("enabled", input.enabled === false ? 0 : 1);
  if (input.config !== undefined) {
    set("config_json", JSON.stringify(normalizeEnvelope(input.config, "config")));
  }
  if (input.credentialRef !== undefined) {
    set("credential_ref", optionalText(input.credentialRef, "credentialRef", 200));
  }
  if (assignments.length === 0) return existing;

  set("updated_at", new Date().toISOString());
  params.push(id);
  db.prepare(`UPDATE backup_destinations SET ${assignments.join(", ")} WHERE id = ?`).run(...params);
  return getBackupDestination(db, id);
}

/**
 * Record what a destination just did.
 *
 * Health lives on the destination rather than on the run, because a bucket that
 * rejects writes is broken independently of whichever policy discovered it.
 */
export function recordDestinationOutcome(
  db: SqliteDatabase,
  id: string,
  outcome: { success: boolean; at: string; reason?: string }
): BackupDestination | null {
  const existing = getBackupDestination(db, id);
  if (!existing) return null;

  if (outcome.success) {
    db.prepare(
      "UPDATE backup_destinations SET last_success_at = ?, last_failure_reason = NULL, updated_at = ? WHERE id = ?"
    ).run(outcome.at, new Date().toISOString(), id);
  } else {
    db.prepare(
      "UPDATE backup_destinations SET last_failure_at = ?, last_failure_reason = ?, updated_at = ? WHERE id = ?"
    ).run(outcome.at, optionalText(outcome.reason, "reason", 500), new Date().toISOString(), id);
  }

  return getBackupDestination(db, id);
}

export function deleteBackupDestination(db: SqliteDatabase, id: string): boolean {
  return db.prepare("DELETE FROM backup_destinations WHERE id = ?").run(id).changes > 0;
}

// ── policies ─────────────────────────────────────────────────────────────────

type PolicyRow = {
  id: string;
  name: string;
  enabled: number;
  contents: string;
  source_ref_json: string;
  destination_ids_json: string;
  verification_level: string;
  encryption: string;
  encryption_credential_ref: string | null;
  retention_json: string;
  schedule_kind: string | null;
  cron_expression: string | null;
  interval_minutes: number | null;
  timezone: string | null;
  scrub_enabled: number | null;
  created_at: string;
  updated_at: string;
};

function normalizeRetention(value: unknown): BackupRetention {
  if (value === undefined || value === null) return DEFAULT_RETENTION;
  if (!isRecord(value)) throw new AppDbValidationError("retention must be an object");

  return {
    daily: count(value.daily, "retention.daily", DEFAULT_RETENTION.daily),
    weekly: count(value.weekly, "retention.weekly", DEFAULT_RETENTION.weekly),
    monthly: count(value.monthly, "retention.monthly", DEFAULT_RETENTION.monthly),
    yearly: count(value.yearly, "retention.yearly", DEFAULT_RETENTION.yearly),
    minimumAgeHours: count(
      value.minimumAgeHours,
      "retention.minimumAgeHours",
      DEFAULT_RETENTION.minimumAgeHours
    ),
    autoProtectionDays: count(
      value.autoProtectionDays,
      "retention.autoProtectionDays",
      DEFAULT_RETENTION.autoProtectionDays
    ),
    autoProtectionCount: count(
      value.autoProtectionCount,
      "retention.autoProtectionCount",
      DEFAULT_RETENTION.autoProtectionCount
    ),
  };
}

function parseRetention(raw: string): BackupRetention {
  try {
    return normalizeRetention(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof AppDbValidationError) throw error;
    throw new AppDbValidationError("retention contains invalid JSON");
  }
}

function parseDestinationIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    throw new AppDbValidationError("destinationIds contains invalid JSON");
  }
}

function rowToPolicy(row: PolicyRow): BackupPolicy {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    contents: row.contents as BackupPolicyContents,
    sourceRef: parseEnvelope(row.source_ref_json, "sourceRef"),
    destinationIds: parseDestinationIds(row.destination_ids_json),
    verificationLevel: row.verification_level as BackupVerificationLevel,
    encryption: row.encryption as BackupEncryptionMode,
    encryptionCredentialRef: row.encryption_credential_ref,
    retention: parseRetention(row.retention_json),
    scheduleKind: row.schedule_kind === "interval" ? "interval" : "cron",
    cronExpression: row.cron_expression,
    intervalMinutes: row.interval_minutes,
    timezone: row.timezone || "UTC",
    // Defaults on, because a backup nobody re-checks is the failure mode this
    // feature exists to close.
    scrubEnabled: row.scrub_enabled === null ? true : row.scrub_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listBackupPolicies(db: SqliteDatabase): BackupPolicy[] {
  return db
    .prepare("SELECT * FROM backup_policies ORDER BY created_at")
    .all<PolicyRow>()
    .map(rowToPolicy);
}

export function getBackupPolicy(db: SqliteDatabase, id: string): BackupPolicy | null {
  const row = db.prepare("SELECT * FROM backup_policies WHERE id = ?").get<PolicyRow>(id);
  return row ? rowToPolicy(row) : null;
}

export function createBackupPolicy(db: SqliteDatabase, input: unknown): BackupPolicy {
  if (!isRecord(input)) throw new AppDbValidationError("Policy payload must be an object");

  const now = new Date().toISOString();
  const id = input.id === undefined ? generateId() : text(input.id, "id", 64);
  const destinationIds = Array.isArray(input.destinationIds)
    ? input.destinationIds.filter((entry): entry is string => typeof entry === "string")
    : [];

  const encryption = oneOf(input.encryption, ["none", "passphrase"] as const, "encryption", "none");

  db.prepare(
    `INSERT INTO backup_policies
       (id, name, enabled, contents, source_ref_json, destination_ids_json,
        verification_level, encryption, encryption_credential_ref, retention_json,
        schedule_kind, cron_expression, interval_minutes, timezone, scrub_enabled,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    text(input.name, "name", 120),
    input.enabled === false ? 0 : 1,
    oneOf(input.contents, CONTENTS, "contents", "both"),
    JSON.stringify(
      input.sourceRef === undefined ? EMPTY_ENVELOPE : normalizeEnvelope(input.sourceRef, "sourceRef")
    ),
    JSON.stringify(destinationIds),
    oneOf(input.verificationLevel, LEVELS, "verificationLevel", "data"),
    encryption,
    optionalText(input.encryptionCredentialRef, "encryptionCredentialRef", 200),
    JSON.stringify(normalizeRetention(input.retention)),
    oneOf(input.scheduleKind, ["cron", "interval"] as const, "scheduleKind", "cron"),
    // A nightly backup in the small hours is the right default: late enough
    // that the day's transactions are in, early enough to be done before anyone
    // looks at the budget.
    optionalText(input.cronExpression, "cronExpression", 120) ?? "0 2 * * *",
    input.intervalMinutes === undefined || input.intervalMinutes === null
      ? null
      : count(input.intervalMinutes, "intervalMinutes", 1440),
    optionalText(input.timezone, "timezone", 64) ?? "UTC",
    input.scrubEnabled === false ? 0 : 1,
    now,
    now
  );

  const created = getBackupPolicy(db, id);
  if (!created) throw new AppDbValidationError("Failed to create policy");
  return created;
}

export function updateBackupPolicy(db: SqliteDatabase, id: string, input: unknown): BackupPolicy | null {
  if (!isRecord(input)) throw new AppDbValidationError("Policy payload must be an object");
  const existing = getBackupPolicy(db, id);
  if (!existing) return null;

  const assignments: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (input.name !== undefined) set("name", text(input.name, "name", 120));
  if (input.enabled !== undefined) set("enabled", input.enabled === false ? 0 : 1);
  if (input.contents !== undefined) set("contents", oneOf(input.contents, CONTENTS, "contents", "both"));
  if (input.sourceRef !== undefined) {
    set("source_ref_json", JSON.stringify(normalizeEnvelope(input.sourceRef, "sourceRef")));
  }
  if (input.destinationIds !== undefined) {
    const ids = Array.isArray(input.destinationIds)
      ? input.destinationIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    set("destination_ids_json", JSON.stringify(ids));
  }
  if (input.verificationLevel !== undefined) {
    set("verification_level", oneOf(input.verificationLevel, LEVELS, "verificationLevel", "data"));
  }
  if (input.encryption !== undefined) {
    set("encryption", oneOf(input.encryption, ["none", "passphrase"] as const, "encryption", "none"));
  }
  if (input.encryptionCredentialRef !== undefined) {
    set(
      "encryption_credential_ref",
      optionalText(input.encryptionCredentialRef, "encryptionCredentialRef", 200)
    );
  }
  if (input.retention !== undefined) {
    set("retention_json", JSON.stringify(normalizeRetention(input.retention)));
  }
  if (input.scheduleKind !== undefined) {
    set("schedule_kind", oneOf(input.scheduleKind, ["cron", "interval"] as const, "scheduleKind", "cron"));
  }
  if (input.cronExpression !== undefined) {
    set("cron_expression", optionalText(input.cronExpression, "cronExpression", 120));
  }
  if (input.intervalMinutes !== undefined) {
    set(
      "interval_minutes",
      input.intervalMinutes === null ? null : count(input.intervalMinutes, "intervalMinutes", 1440)
    );
  }
  if (input.timezone !== undefined) set("timezone", optionalText(input.timezone, "timezone", 64) ?? "UTC");
  if (input.scrubEnabled !== undefined) set("scrub_enabled", input.scrubEnabled === false ? 0 : 1);
  if (assignments.length === 0) return existing;

  set("updated_at", new Date().toISOString());
  params.push(id);
  db.prepare(`UPDATE backup_policies SET ${assignments.join(", ")} WHERE id = ?`).run(...params);
  return getBackupPolicy(db, id);
}

export function deleteBackupPolicy(db: SqliteDatabase, id: string): boolean {
  return db.prepare("DELETE FROM backup_policies WHERE id = ?").run(id).changes > 0;
}

// ── artifacts and their copies ───────────────────────────────────────────────

type ArtifactRow = {
  id: string;
  policy_id: string | null;
  kind: string;
  created_at: string;
  source_budget_id: string | null;
  source_budget_name: string | null;
  size_bytes: number;
  checksum_sha256: string;
  plaintext_checksum_sha256: string | null;
  encrypted: number;
  encryption_json: string | null;
  encryption_credential_ref: string | null;
  tier: string;
  pinned: number;
  protected_until: string | null;
  taken_before: string | null;
  verification_level: string | null;
  verification_status: string;
  verified_at: string | null;
  verification_json: string | null;
  manifest_version: number;
  bench_version: string | null;
  notes: string | null;
};

function rowToArtifact(row: ArtifactRow): BackupArtifact {
  return {
    id: row.id,
    policyId: row.policy_id,
    kind: row.kind as BackupArtifactKind,
    createdAt: row.created_at,
    sourceBudgetId: row.source_budget_id,
    sourceBudgetName: row.source_budget_name,
    sizeBytes: row.size_bytes,
    checksumSha256: row.checksum_sha256,
    plaintextChecksumSha256: row.plaintext_checksum_sha256,
    encrypted: row.encrypted === 1,
    // Encryption parameters are not user input and hold no secret, so they are
    // read plainly rather than through the credential guard.
    encryption: row.encryption_json ? (JSON.parse(row.encryption_json) as JsonEnvelope) : null,
    encryptionCredentialRef: row.encryption_credential_ref,
    tier: row.tier as BackupRetentionTier,
    pinned: row.pinned === 1,
    protectedUntil: row.protected_until,
    takenBefore: row.taken_before,
    verificationLevel: (row.verification_level as BackupVerificationLevel | null) ?? null,
    verificationStatus: row.verification_status as BackupVerificationStatus,
    verifiedAt: row.verified_at,
    verification: row.verification_json ? (JSON.parse(row.verification_json) as JsonEnvelope) : null,
    manifestVersion: row.manifest_version,
    benchVersion: row.bench_version,
    notes: row.notes,
  };
}

export function createBackupArtifact(db: SqliteDatabase, input: unknown): BackupArtifact {
  if (!isRecord(input)) throw new AppDbValidationError("Artifact payload must be an object");

  const id = input.id === undefined ? generateId() : text(input.id, "id", 64);

  db.prepare(
    `INSERT INTO backup_artifacts
       (id, policy_id, kind, created_at, source_budget_id, source_budget_name, size_bytes,
        checksum_sha256, plaintext_checksum_sha256, encrypted, encryption_json,
        encryption_credential_ref, tier, pinned,
        protected_until, taken_before, verification_level, verification_status, verified_at,
        verification_json, manifest_version, bench_version, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    optionalText(input.policyId, "policyId", 64),
    oneOf(input.kind, ["budget", "app-db"] as const, "kind", "budget"),
    optionalText(input.createdAt, "createdAt", 40) ?? new Date().toISOString(),
    optionalText(input.sourceBudgetId, "sourceBudgetId", 200),
    optionalText(input.sourceBudgetName, "sourceBudgetName", 200),
    count(input.sizeBytes, "sizeBytes", 0),
    text(input.checksumSha256, "checksumSha256", 128),
    optionalText(input.plaintextChecksumSha256, "plaintextChecksumSha256", 128),
    input.encrypted === true ? 1 : 0,
    input.encryption === undefined || input.encryption === null
      ? null
      : JSON.stringify(input.encryption),
    optionalText(input.encryptionCredentialRef, "encryptionCredentialRef", 200),
    oneOf(input.tier, TIERS, "tier", "manual"),
    input.pinned === true ? 1 : 0,
    optionalText(input.protectedUntil, "protectedUntil", 40),
    optionalText(input.takenBefore, "takenBefore", 300),
    input.verificationLevel === undefined || input.verificationLevel === null
      ? null
      : oneOf(input.verificationLevel, LEVELS, "verificationLevel", "data"),
    oneOf(input.verificationStatus, STATUSES, "verificationStatus", "unverified"),
    optionalText(input.verifiedAt, "verifiedAt", 40),
    input.verification === undefined || input.verification === null
      ? null
      : JSON.stringify(input.verification),
    count(input.manifestVersion, "manifestVersion", 1),
    optionalText(input.benchVersion, "benchVersion", 60),
    optionalText(input.notes, "notes", 2000)
  );

  const created = getBackupArtifact(db, id);
  if (!created) throw new AppDbValidationError("Failed to create artifact");
  return created;
}

export function getBackupArtifact(db: SqliteDatabase, id: string): BackupArtifact | null {
  const row = db.prepare("SELECT * FROM backup_artifacts WHERE id = ?").get<ArtifactRow>(id);
  return row ? rowToArtifact(row) : null;
}

export function listBackupArtifacts(
  db: SqliteDatabase,
  options: { policyId?: string; kind?: BackupArtifactKind; limit?: number } = {}
): BackupArtifact[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.policyId) {
    clauses.push("policy_id = ?");
    params.push(options.policyId);
  }
  if (options.kind) {
    clauses.push("kind = ?");
    params.push(options.kind);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : 200;

  return db
    .prepare(`SELECT * FROM backup_artifacts ${where} ORDER BY created_at DESC LIMIT ?`)
    .all<ArtifactRow>(...params, limit)
    .map(rowToArtifact);
}

/** Record a verification result against an artifact. */
export function recordArtifactVerification(
  db: SqliteDatabase,
  id: string,
  input: {
    level: BackupVerificationLevel;
    status: BackupVerificationStatus;
    at: string;
    findings?: JsonEnvelope | null;
  }
): BackupArtifact | null {
  const existing = getBackupArtifact(db, id);
  if (!existing) return null;

  db.prepare(
    `UPDATE backup_artifacts
        SET verification_level = ?, verification_status = ?, verified_at = ?, verification_json = ?
      WHERE id = ?`
  ).run(
    oneOf(input.level, LEVELS, "level", "data"),
    oneOf(input.status, STATUSES, "status", "unverified"),
    input.at,
    input.findings ? JSON.stringify(input.findings) : null,
    id
  );

  return getBackupArtifact(db, id);
}

/** Pin or unpin. A pin is permanent and outranks every retention rule. */
export function setArtifactPinned(db: SqliteDatabase, id: string, pinned: boolean): BackupArtifact | null {
  if (!getBackupArtifact(db, id)) return null;
  db.prepare("UPDATE backup_artifacts SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
  return getBackupArtifact(db, id);
}

export function deleteBackupArtifact(db: SqliteDatabase, id: string): boolean {
  return db.prepare("DELETE FROM backup_artifacts WHERE id = ?").run(id).changes > 0;
}

type LocationRow = {
  id: string;
  artifact_id: string;
  destination_id: string | null;
  object_key: string;
  status: string;
  uploaded_at: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function rowToLocation(row: LocationRow): BackupArtifactLocation {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    destinationId: row.destination_id,
    objectKey: row.object_key,
    status: row.status as BackupLocationStatus,
    uploadedAt: row.uploaded_at,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Record one copy of an artifact in one destination.
 *
 * Upserts on (artifact, destination, key) so a retried upload updates the copy
 * it already knows about instead of inventing a second one.
 */
export function recordArtifactLocation(db: SqliteDatabase, input: unknown): BackupArtifactLocation {
  if (!isRecord(input)) throw new AppDbValidationError("Location payload must be an object");

  const now = new Date().toISOString();
  const artifactId = text(input.artifactId, "artifactId", 64);
  const destinationId = optionalText(input.destinationId, "destinationId", 64);
  const objectKey = text(input.objectKey, "objectKey", 1024);
  const status = oneOf(input.status, LOCATION_STATUSES, "status", "stored");

  const existing = db
    .prepare(
      `SELECT * FROM backup_artifact_locations
        WHERE artifact_id = ? AND object_key = ?
          AND (destination_id IS ? OR destination_id = ?)`
    )
    .get<LocationRow>(artifactId, objectKey, destinationId, destinationId);

  const id = existing?.id ?? (input.id === undefined ? generateId() : text(input.id, "id", 64));

  if (existing) {
    db.prepare(
      `UPDATE backup_artifact_locations
          SET status = ?, uploaded_at = ?, last_verified_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      status,
      optionalText(input.uploadedAt, "uploadedAt", 40) ?? existing.uploaded_at,
      optionalText(input.lastVerifiedAt, "lastVerifiedAt", 40) ?? existing.last_verified_at,
      optionalText(input.lastError, "lastError", 500),
      now,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO backup_artifact_locations
         (id, artifact_id, destination_id, object_key, status, uploaded_at, last_verified_at,
          last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      artifactId,
      destinationId,
      objectKey,
      status,
      optionalText(input.uploadedAt, "uploadedAt", 40),
      optionalText(input.lastVerifiedAt, "lastVerifiedAt", 40),
      optionalText(input.lastError, "lastError", 500),
      now,
      now
    );
  }

  const stored = db
    .prepare("SELECT * FROM backup_artifact_locations WHERE id = ?")
    .get<LocationRow>(id);
  if (!stored) throw new AppDbValidationError("Failed to record artifact location");
  return rowToLocation(stored);
}

export function listArtifactLocations(db: SqliteDatabase, artifactId: string): BackupArtifactLocation[] {
  return db
    .prepare("SELECT * FROM backup_artifact_locations WHERE artifact_id = ? ORDER BY created_at")
    .all<LocationRow>(artifactId)
    .map(rowToLocation);
}

export function listDestinationLocations(
  db: SqliteDatabase,
  destinationId: string,
  options: { limit?: number } = {}
): BackupArtifactLocation[] {
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : 200;
  return db
    .prepare(
      `SELECT * FROM backup_artifact_locations
        WHERE destination_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all<LocationRow>(destinationId, limit)
    .map(rowToLocation);
}

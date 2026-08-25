import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import {
  EMPTY_ENVELOPE,
  isRecord,
  normalizeEnvelope as normalizeSharedEnvelope,
  parseEnvelope as parseSharedEnvelope,
} from "./jsonEnvelope";
import type {
  AutomationDefinition,
  AutomationExecutionMode,
  AutomationFailurePolicy,
  AutomationScheduleKind,
  JsonEnvelope,
  SqliteDatabase,
} from "./types";

/**
 * Automation definitions (RD-079 / PR-043a) — "what should run, when, as whom".
 *
 * Storage only: nothing here schedules or executes anything. The engine
 * (PR-043b) and the first job type (PR-043c) come later, so this module is
 * deliberately ignorant of what any `type` means beyond its string name.
 */

type AutomationDefinitionRow = {
  id: string;
  type: string;
  name: string;
  enabled: number;
  execution_mode: string;
  schedule_kind: string;
  interval_minutes: number | null;
  cron_expression: string | null;
  timezone: string;
  target_ref_json: string;
  credential_ref: string | null;
  config_json: string;
  failure_policy_json: string | null;
  consecutive_failures: number;
  auto_paused_at: string | null;
  auto_pause_reason: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  next_run_at: string | null;
  running_since: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_FAILURE_POLICY: AutomationFailurePolicy = {
  backoffMinutes: 5,
  backoffCeilingMinutes: 60,
  pauseAfterConsecutiveFailures: 5,
};

/**
 * How long a claim may sit before it is treated as abandoned. A process killed
 * mid-run cannot release its own claim, so without this an automation would be
 * blocked forever by a run that is no longer happening.
 */
export const CLAIM_STALE_MS = 6 * 60 * 60_000;

const EXECUTION_MODES: readonly AutomationExecutionMode[] = ["browser", "server"];
const SCHEDULE_KINDS: readonly AutomationScheduleKind[] = ["interval", "cron"];

/**
 * Configuration and target references are user input, so credential-looking
 * fields are refused outright: a secret belongs in the vault, and the definition
 * stores only `credentialRef` pointing at it.
 */
function normalizeEnvelope(value: unknown, label: string): JsonEnvelope {
  return normalizeSharedEnvelope(value, label, { rejectSecrets: true });
}

function parseEnvelope(raw: string, label: string): JsonEnvelope {
  return parseSharedEnvelope(raw, label, { rejectSecrets: true });
}

function normalizeText(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== "string") throw new AppDbValidationError(`${label} is required`);
  const text = value.trim();
  if (!text) throw new AppDbValidationError(`${label} is required`);
  if (text.length > maxLength) throw new AppDbValidationError(`${label} is too long`);
  return text;
}

function normalizeOptionalText(value: unknown, label: string, maxLength = 200): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AppDbValidationError(`${label} must be a string`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) throw new AppDbValidationError(`${label} is too long`);
  return text;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  fallback: T
): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AppDbValidationError(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

/**
 * IANA zone names are validated by asking the platform, not by pattern —
 * `Intl` is the same resolver the scheduler will compute due-times with, so a
 * zone that stores is by construction a zone that schedules.
 */
function normalizeTimezone(value: unknown): string {
  if (value === undefined || value === null) return "UTC";
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError("timezone must be an IANA time zone name");
  }
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new AppDbValidationError(`Unknown time zone: ${timezone}`);
  }
  return timezone;
}

function normalizePositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new AppDbValidationError(`${label} must be a positive integer`);
  }
  return value;
}

/**
 * A schedule is only meaningful if the field matching its kind is present, so
 * the pair is validated together rather than as two independent columns.
 */
function normalizeSchedule(input: Record<string, unknown>): {
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  cronExpression: string | null;
} {
  const scheduleKind = normalizeEnum(input.scheduleKind, SCHEDULE_KINDS, "scheduleKind", "interval");

  if (scheduleKind === "interval") {
    return {
      scheduleKind,
      intervalMinutes: normalizePositiveInt(input.intervalMinutes, "intervalMinutes"),
      cronExpression: null,
    };
  }

  // Cron *syntax* is the engine's to validate (PR-043b owns the parser); the
  // repository only guarantees an expression exists for a cron schedule.
  return {
    scheduleKind,
    intervalMinutes: null,
    cronExpression: normalizeText(input.cronExpression, "cronExpression", 120),
  };
}

function normalizeFailurePolicy(value: unknown): AutomationFailurePolicy {
  if (value === undefined || value === null) return DEFAULT_FAILURE_POLICY;
  if (!isRecord(value)) throw new AppDbValidationError("failurePolicy must be an object");

  const read = (key: keyof AutomationFailurePolicy): number =>
    value[key] === undefined
      ? DEFAULT_FAILURE_POLICY[key]
      : normalizePositiveInt(value[key], `failurePolicy.${key}`);

  const policy: AutomationFailurePolicy = {
    backoffMinutes: read("backoffMinutes"),
    backoffCeilingMinutes: read("backoffCeilingMinutes"),
    pauseAfterConsecutiveFailures: read("pauseAfterConsecutiveFailures"),
  };

  if (policy.backoffCeilingMinutes < policy.backoffMinutes) {
    throw new AppDbValidationError(
      "failurePolicy.backoffCeilingMinutes must be at least failurePolicy.backoffMinutes"
    );
  }

  return policy;
}

function parseFailurePolicy(raw: string | null): AutomationFailurePolicy {
  if (!raw) return DEFAULT_FAILURE_POLICY;
  try {
    return normalizeFailurePolicy(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof AppDbValidationError) throw error;
    throw new AppDbValidationError("failurePolicy contains invalid JSON");
  }
}

function rowToDefinition(row: AutomationDefinitionRow): AutomationDefinition {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: row.enabled === 1,
    executionMode: row.execution_mode as AutomationExecutionMode,
    scheduleKind: row.schedule_kind as AutomationScheduleKind,
    intervalMinutes: row.interval_minutes,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    targetRef: parseEnvelope(row.target_ref_json, "targetRef"),
    credentialRef: row.credential_ref,
    config: parseEnvelope(row.config_json, "config"),
    failurePolicy: parseFailurePolicy(row.failure_policy_json),
    consecutiveFailures: row.consecutive_failures,
    autoPausedAt: row.auto_paused_at,
    autoPauseReason: row.auto_pause_reason,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    nextRunAt: row.next_run_at,
    runningSince: row.running_since,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAutomations(
  db: SqliteDatabase,
  options: { type?: string } = {}
): AutomationDefinition[] {
  const rows = options.type
    ? db
        .prepare("SELECT * FROM automation_definitions WHERE type = ? ORDER BY updated_at DESC")
        .all<AutomationDefinitionRow>(options.type)
    : db
        .prepare("SELECT * FROM automation_definitions ORDER BY updated_at DESC")
        .all<AutomationDefinitionRow>();
  return rows.map(rowToDefinition);
}

export function getAutomation(db: SqliteDatabase, id: string): AutomationDefinition | null {
  const row = db
    .prepare("SELECT * FROM automation_definitions WHERE id = ?")
    .get<AutomationDefinitionRow>(id);
  return row ? rowToDefinition(row) : null;
}

export function createAutomation(db: SqliteDatabase, input: unknown): AutomationDefinition {
  if (!isRecord(input)) throw new AppDbValidationError("Automation payload must be an object");

  const now = new Date().toISOString();
  const id = input.id === undefined ? generateId() : normalizeText(input.id, "id", 64);
  const schedule = normalizeSchedule(input);

  db.prepare(
    `INSERT INTO automation_definitions (
      id, type, name, enabled, execution_mode, schedule_kind, interval_minutes,
      cron_expression, timezone, target_ref_json, credential_ref, config_json,
      failure_policy_json, consecutive_failures, auto_paused_at, auto_pause_reason,
      last_run_at, last_success_at, next_run_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?, ?)`
  ).run(
    id,
    normalizeText(input.type, "type", 64),
    normalizeText(input.name, "name"),
    input.enabled === false ? 0 : 1,
    normalizeEnum(input.executionMode, EXECUTION_MODES, "executionMode", "server"),
    schedule.scheduleKind,
    schedule.intervalMinutes,
    schedule.cronExpression,
    normalizeTimezone(input.timezone),
    JSON.stringify(
      input.targetRef === undefined ? EMPTY_ENVELOPE : normalizeEnvelope(input.targetRef, "targetRef")
    ),
    normalizeOptionalText(input.credentialRef, "credentialRef", 200),
    JSON.stringify(
      input.config === undefined ? EMPTY_ENVELOPE : normalizeEnvelope(input.config, "config")
    ),
    JSON.stringify(normalizeFailurePolicy(input.failurePolicy)),
    normalizeOptionalText(input.nextRunAt, "nextRunAt", 40),
    now,
    now
  );

  const created = getAutomation(db, id);
  if (!created) throw new AppDbValidationError("Failed to create automation");
  return created;
}

/**
 * Partial update of the user-editable fields. Health state
 * (`consecutiveFailures`, pause, run timestamps) is engine-owned and is only
 * moved by the functions below, so a config edit can never quietly clear a
 * pause the user has not resolved.
 */
export function updateAutomation(
  db: SqliteDatabase,
  id: string,
  input: unknown
): AutomationDefinition | null {
  if (!isRecord(input)) throw new AppDbValidationError("Automation payload must be an object");
  const existing = getAutomation(db, id);
  if (!existing) return null;

  const assignments: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown): void => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (input.name !== undefined) set("name", normalizeText(input.name, "name"));
  if (input.enabled !== undefined) set("enabled", input.enabled === false ? 0 : 1);
  if (input.executionMode !== undefined) {
    set("execution_mode", normalizeEnum(input.executionMode, EXECUTION_MODES, "executionMode", "server"));
  }
  if (input.scheduleKind !== undefined || input.intervalMinutes !== undefined || input.cronExpression !== undefined) {
    const schedule = normalizeSchedule({
      scheduleKind: input.scheduleKind ?? existing.scheduleKind,
      intervalMinutes: input.intervalMinutes ?? existing.intervalMinutes ?? undefined,
      cronExpression: input.cronExpression ?? existing.cronExpression ?? undefined,
    });
    set("schedule_kind", schedule.scheduleKind);
    set("interval_minutes", schedule.intervalMinutes);
    set("cron_expression", schedule.cronExpression);
    // Drop any stored "not before" floor: it was computed under the old
    // schedule, and keeping it would make a shortened interval wait out the
    // longer one it replaced.
    if (input.nextRunAt === undefined) set("next_run_at", null);
  }
  if (input.timezone !== undefined) set("timezone", normalizeTimezone(input.timezone));
  if (input.targetRef !== undefined) {
    set("target_ref_json", JSON.stringify(normalizeEnvelope(input.targetRef, "targetRef")));
  }
  if (input.credentialRef !== undefined) {
    set("credential_ref", normalizeOptionalText(input.credentialRef, "credentialRef", 200));
  }
  if (input.config !== undefined) {
    set("config_json", JSON.stringify(normalizeEnvelope(input.config, "config")));
  }
  if (input.failurePolicy !== undefined) {
    set("failure_policy_json", JSON.stringify(normalizeFailurePolicy(input.failurePolicy)));
  }
  if (input.nextRunAt !== undefined) {
    set("next_run_at", normalizeOptionalText(input.nextRunAt, "nextRunAt", 40));
  }

  if (assignments.length === 0) return existing;

  set("updated_at", new Date().toISOString());
  params.push(id);
  db.prepare(`UPDATE automation_definitions SET ${assignments.join(", ")} WHERE id = ?`).run(...params);

  return getAutomation(db, id);
}

/**
 * Record a run's outcome against the definition.
 *
 * The consecutive-failure counter lives here, in the database, rather than in a
 * module-scope Map as RD-058's scheduler kept it — that state was lost on every
 * restart, so a persistently failing flow re-armed itself after each deploy and
 * the pause threshold never really applied.
 */
export function recordAutomationOutcome(
  db: SqliteDatabase,
  id: string,
  outcome: { success: boolean; at: string; nextRunAt?: string | null }
): AutomationDefinition | null {
  const existing = getAutomation(db, id);
  if (!existing) return null;

  const consecutiveFailures = outcome.success ? 0 : existing.consecutiveFailures + 1;
  db.prepare(
    `UPDATE automation_definitions
       SET consecutive_failures = ?, last_run_at = ?, last_success_at = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    consecutiveFailures,
    outcome.at,
    outcome.success ? outcome.at : existing.lastSuccessAt,
    outcome.nextRunAt === undefined ? existing.nextRunAt : outcome.nextRunAt,
    new Date().toISOString(),
    id
  );

  return getAutomation(db, id);
}

/** Disable an automation for health reasons, with the reason a user will read. */
export function pauseAutomationForHealth(
  db: SqliteDatabase,
  id: string,
  pausedAtIso: string,
  reason: string
): AutomationDefinition | null {
  const existing = getAutomation(db, id);
  if (!existing) return null;

  db.prepare(
    `UPDATE automation_definitions
       SET enabled = 0, auto_paused_at = ?, auto_pause_reason = ?, next_run_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(pausedAtIso, normalizeText(reason, "reason", 500), new Date().toISOString(), id);

  return getAutomation(db, id);
}

/**
 * Manual resume: re-enable and clear both the pause and the failure counter, so
 * a resumed automation starts from a clean slate rather than re-pausing on its
 * next stumble.
 */
export function resumeAutomation(db: SqliteDatabase, id: string): AutomationDefinition | null {
  const existing = getAutomation(db, id);
  if (!existing) return null;

  db.prepare(
    `UPDATE automation_definitions
       SET enabled = 1, auto_paused_at = NULL, auto_pause_reason = NULL,
           consecutive_failures = 0, updated_at = ?
     WHERE id = ?`
  ).run(new Date().toISOString(), id);

  return getAutomation(db, id);
}

export function deleteAutomation(db: SqliteDatabase, id: string): boolean {
  const result = db.prepare("DELETE FROM automation_definitions WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Take the execution claim, atomically. Returns false when another run already
 * holds it.
 *
 * The claim lives in the database rather than in a module-scope Set because
 * Next may evaluate a route module separately from the server boot context: an
 * external cron hitting the trigger endpoint runs in a *different* module
 * instance from the interval loop, so an in-memory lock is invisible to it and
 * the same automation could apply its writes twice. A single `UPDATE ... WHERE`
 * decides the race in SQLite instead.
 */
export function claimAutomation(
  db: SqliteDatabase,
  id: string,
  nowIso: string,
  staleMs: number = CLAIM_STALE_MS
): boolean {
  const staleBefore = new Date(new Date(nowIso).getTime() - staleMs).toISOString();
  const result = db
    .prepare(
      `UPDATE automation_definitions
          SET running_since = ?
        WHERE id = ?
          AND (running_since IS NULL OR running_since < ?)`
    )
    .run(nowIso, id, staleBefore);
  return result.changes > 0;
}

export function releaseAutomationClaim(db: SqliteDatabase, id: string): void {
  db.prepare("UPDATE automation_definitions SET running_since = NULL WHERE id = ?").run(id);
}

/**
 * Drop every claim. Called once at server start: the engine is single-instance,
 * so any claim surviving a boot belongs to a process that no longer exists.
 */
export function clearAutomationClaims(db: SqliteDatabase): number {
  const result = db
    .prepare("UPDATE automation_definitions SET running_since = NULL WHERE running_since IS NOT NULL")
    .run();
  return result.changes;
}


import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import { isRecord, normalizeOptionalEnvelope, parseOptionalEnvelope, stringifyEnvelope } from "./jsonEnvelope";
import { clampLimit } from "./pagination";
import type {
  AutomationExecutionMode,
  AutomationRun,
  AutomationRunRollup,
  AutomationRunStatus,
  AutomationRunTrigger,
  JsonEnvelope,
  SqliteDatabase,
} from "./types";

/**
 * Automation run history (RD-079 / PR-043a).
 *
 * The engine owns status, timing, attempt and trigger. Everything about *what
 * the job did* lives in the type-owned `result` envelope, which this module
 * stores and returns without interpreting — deliberately, so a second job type
 * never has to describe itself in the first one's vocabulary. `rollup` is the
 * only cross-type reduction, and it exists purely so a list view can render a
 * mixed set of runs.
 */

type AutomationRunRow = {
  id: string;
  automation_id: string | null;
  type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  attempt: number;
  execution_mode: string;
  result_json: string | null;
  rollup_json: string | null;
  error_json: string | null;
};

export type CreateAutomationRunInput = {
  id?: string;
  automationId?: string | null;
  type: string;
  status?: AutomationRunStatus;
  startedAt?: string;
  trigger?: AutomationRunTrigger;
  attempt?: number;
  executionMode?: AutomationExecutionMode;
};

export type FinalizeAutomationRunInput = {
  status: AutomationRunStatus;
  finishedAt?: string;
  result?: JsonEnvelope | null;
  rollup?: AutomationRunRollup | null;
  error?: JsonEnvelope | null;
};

const RUN_STATUSES: readonly AutomationRunStatus[] = [
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "no_changes",
];

const TRIGGERS: readonly AutomationRunTrigger[] = ["schedule", "manual", "retry"];
const EXECUTION_MODES: readonly AutomationExecutionMode[] = ["browser", "server"];
const ROLLUP_OUTCOMES: readonly AutomationRunRollup["outcome"][] = ["ok", "partial", "failed", "no_changes"];

/** Roll-up messages are one line in a list; longer text is truncated, not refused. */
const MAX_ROLLUP_MESSAGE = 500;

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

function normalizeType(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError("type is required");
  }
  return value.trim();
}

function normalizeRollup(value: AutomationRunRollup | null | undefined): AutomationRunRollup | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new AppDbValidationError("rollup must be an object");

  const outcome = normalizeEnum(value.outcome, ROLLUP_OUTCOMES, "rollup.outcome", "ok");
  const itemCount = value.itemCount;
  if (typeof itemCount !== "number" || !Number.isInteger(itemCount) || itemCount < 0) {
    throw new AppDbValidationError("rollup.itemCount must be a non-negative integer");
  }

  const message = value.message;
  if (message !== undefined && typeof message !== "string") {
    throw new AppDbValidationError("rollup.message must be a string");
  }

  const rollup: AutomationRunRollup = { outcome, itemCount };
  // Truncated, not rejected. This message is job output — often a provider's
  // error text — not user input, and it arrives while a run is being finalized.
  // Throwing here turned a successful run into a failed one: the exception
  // escaped `finalizeAutomationRun`, the engine's catch re-finalized the same
  // run as failed, and the failure streak advanced over a long sentence.
  if (message !== undefined) rollup.message = message.slice(0, MAX_ROLLUP_MESSAGE);
  if (value.countsAsFailure === true) rollup.countsAsFailure = true;
  return rollup;
}

function parseRollup(raw: string | null): AutomationRunRollup | null {
  if (!raw) return null;
  try {
    return normalizeRollup(JSON.parse(raw) as AutomationRunRollup);
  } catch (error) {
    if (error instanceof AppDbValidationError) throw error;
    throw new AppDbValidationError("rollup contains invalid JSON");
  }
}

function rowToRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    type: row.type,
    status: row.status as AutomationRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    trigger: row.trigger as AutomationRunTrigger,
    attempt: row.attempt,
    executionMode: row.execution_mode as AutomationExecutionMode,
    // Result payloads are job output, not user input, so unlike configuration
    // they are not secret-scanned — a type must not leak secrets into its own
    // result, which PR-043b asserts over the engine's logging and result path.
    result: parseOptionalEnvelope(row.result_json, "result"),
    rollup: parseRollup(row.rollup_json),
    error: parseOptionalEnvelope(row.error_json, "error"),
  };
}

export function createAutomationRun(db: SqliteDatabase, input: CreateAutomationRunInput): AutomationRun {
  const id = input.id?.trim() || generateId();
  const attempt = input.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new AppDbValidationError("attempt must be a positive integer");
  }

  db.prepare(
    `INSERT INTO automation_runs (
      id, automation_id, type, status, started_at, finished_at, trigger, attempt,
      execution_mode, result_json, rollup_json, error_json
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL)`
  ).run(
    id,
    input.automationId ?? null,
    normalizeType(input.type),
    normalizeEnum(input.status, RUN_STATUSES, "status", "running"),
    input.startedAt ?? new Date().toISOString(),
    normalizeEnum(input.trigger, TRIGGERS, "trigger", "schedule"),
    attempt,
    normalizeEnum(input.executionMode, EXECUTION_MODES, "executionMode", "server")
  );

  const created = getAutomationRun(db, id);
  if (!created) throw new AppDbValidationError("Failed to create automation run");
  return created;
}

/**
 * Close out a run. Always called — including on failure — so history never
 * shows a run stuck in `running` because the executor threw.
 */
export function finalizeAutomationRun(
  db: SqliteDatabase,
  runId: string,
  input: FinalizeAutomationRunInput
): AutomationRun | null {
  const existing = getAutomationRun(db, runId);
  if (!existing) return null;

  db.prepare(
    `UPDATE automation_runs
       SET status = ?, finished_at = ?, result_json = ?, rollup_json = ?, error_json = ?
     WHERE id = ?`
  ).run(
    normalizeEnum(input.status, RUN_STATUSES, "status", "succeeded"),
    input.finishedAt ?? new Date().toISOString(),
    stringifyEnvelope(normalizeOptionalEnvelope(input.result, "result")),
    input.rollup === undefined || input.rollup === null
      ? null
      : JSON.stringify(normalizeRollup(input.rollup)),
    stringifyEnvelope(normalizeOptionalEnvelope(input.error, "error")),
    runId
  );

  return getAutomationRun(db, runId);
}

export function getAutomationRun(db: SqliteDatabase, runId: string): AutomationRun | null {
  const row = db.prepare("SELECT * FROM automation_runs WHERE id = ?").get<AutomationRunRow>(runId);
  return row ? rowToRun(row) : null;
}

export function listAutomationRuns(
  db: SqliteDatabase,
  options: {
    automationId?: string;
    /** Filter to particular outcomes - the question is usually "what failed". */
    statuses?: readonly AutomationRunStatus[];
    /** Filter to one job type, so "which backup ran" is one query. */
    type?: string;
    limit?: number;
  } = {}
): AutomationRun[] {
  const limit = clampLimit(options.limit, 50, 200);

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.automationId) {
    clauses.push("automation_id = ?");
    params.push(options.automationId);
  }
  if (options.type) {
    clauses.push("type = ?");
    params.push(options.type);
  }
  if (options.statuses && options.statuses.length > 0) {
    clauses.push(`status IN (${options.statuses.map(() => "?").join(", ")})`);
    params.push(...options.statuses);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM automation_runs ${where} ORDER BY started_at DESC LIMIT ?`)
    .all<AutomationRunRow>(...params, limit)
    .map(rowToRun);
}

/**
 * Retention: keep the newest `keep` runs per automation and delete the rest.
 *
 * Per automation rather than globally, so a busy hourly job cannot age out the
 * only three runs a weekly job has ever had — which is exactly the history
 * someone needs when the weekly job starts failing.
 */
export function pruneAutomationRuns(db: SqliteDatabase, keep: number): number {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new AppDbValidationError("keep must be a positive integer");
  }

  const result = db
    .prepare(
      `DELETE FROM automation_runs
        WHERE automation_id IS NOT NULL
          AND id NOT IN (
            SELECT id FROM automation_runs AS ranked
             WHERE ranked.automation_id = automation_runs.automation_id
             ORDER BY started_at DESC
             LIMIT ?
          )`
    )
    .run(keep);

  return result.changes;
}

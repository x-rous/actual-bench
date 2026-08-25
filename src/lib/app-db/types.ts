import type { ConnectionMode } from "@/store/connection";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonEnvelope = {
  version: number;
  data: JsonObject;
};

export type SqliteStatement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
};

export type SqliteDatabase = {
  readonly name: string;
  readonly open: boolean;
  prepare(source: string): SqliteStatement;
  exec(source: string): unknown;
  pragma(source: string): unknown;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
  close(): void;
};

export type AppDbHealth = {
  status: "ready" | "unavailable";
  ready: boolean;
  configuredPath: string;
  defaultPath: string;
  envOverride: boolean;
  writable: boolean;
  runtime: "node" | "vercel";
  durable: boolean;
  schemaVersion: number | null;
  latestSchemaVersion: number;
  createdAt: string | null;
  lastMigratedAt: string | null;
  checkedAt: string;
  error?: string;
};

export type SyncDomain =
  | "transaction_sync"
  | "payee_sync"
  | "category_sync"
  | "master_data_sync"
  | "consolidation_sync";

export type SyncEntityType = "transaction" | "split_line" | "payee" | "category" | "category_group";

export type SyncRunStatus =
  | "draft_preview"
  | "applying"
  | "applied"
  | "partial"
  | "failed"
  | "cancelled"
  /** An automated safe-sync that completed with nothing safe to apply. Distinct
   * from `draft_preview` so history doesn't mislabel a background run "Preview". */
  | "no_changes";

export type SyncRunTrigger =
  | "manual_preview"
  | "manual_apply"
  /**
   * A safe-only automated run (RD-054 / PR-020): the "Run safe sync now" action
   * or the client-side interval timer. Stamped on the run so history can
   * distinguish automated from hand-applied runs. (Client-side only — there is
   * no unattended server daemon; that is RD-058.)
   */
  | "interval_safe_only"
  /**
   * A safe-only run driven by the server-side scheduler with no browser open
   * (RD-058 / PR-024). Same executor as `interval_safe_only`; the distinct
   * trigger lets history/health show it ran unattended.
   */
  | "scheduled_unattended";

/**
 * Per-flow automation policy (RD-054 / PR-020). Gates how much of a run is
 * applied without a human:
 * - `manual_preview_required`: preview only; the human selects and applies (RD-053 default).
 * - `auto_apply_safe_only`: a user-initiated run auto-applies only safe classes.
 * - `auto_sync_on_interval`: a client-side interval re-runs safe sync while the app is
 *   open and the connection is unlocked (Tier 1; not a server daemon — see PR-020).
 *
 * Uncertain items are never auto-applied under any policy; they go to the review queue.
 */
export type SyncReviewPolicy =
  | "manual_preview_required"
  | "auto_apply_safe_only"
  | "auto_sync_on_interval"
  /**
   * Safe-only sync on a server-side schedule with no browser open (RD-058 /
   * PR-024). HTTP-API flows only; requires an enrolled vault credential. Same
   * safe-only application as `auto_sync_on_interval`.
   */
  | "auto_sync_unattended";

/**
 * Primary, mutually-exclusive lifecycle/dedupe state persisted for each run
 * item. Non-exclusive annotations (missing payee/category, "rules may modify",
 * split fallback key, etc.) are carried as flags in the run item's warnings
 * envelope rather than crammed into this enum — see `SyncPlanFlag`.
 */
export type SyncItemClassification =
  | "new"
  | "already_synced"
  | "target_marker_match"
  /**
   * Marker-less analogue of target_marker_match for master-data entities
   * (RD-055): no DB mapping, but a target entity matches by normalized name, so
   * apply records a mapping to it instead of creating a duplicate.
   */
  | "target_name_match"
  | "source_changed_since_sync"
  | "exact_duplicate"
  | "strong_duplicate"
  | "weak_duplicate"
  | "source_missing"
  | "blocked"
  | "warning";

export type SyncDuplicateConfidence = "none" | "exact" | "strong" | "weak";

export type SyncApplyState = "pending" | "applied" | "failed" | "skipped";

export type SyncMappingStatus = "active" | "source_missing" | "target_missing" | "disabled";

export type SyncCapabilitySet = {
  listBudgets: boolean;
  listAccounts: boolean;
  listTransactions: boolean;
  readSplitLines: boolean;
  createPayee: boolean;
  createTransaction: boolean;
  /**
   * Can create a NEW target transaction that carries a durable imported/sync
   * marker (Actual `imported_id`). This is not the ability to mutate an
   * existing transaction — that would be `updateTransaction`.
   */
  createTransactionWithImportedId: boolean;
  /** Can create a target transaction whose notes carry the visible sync marker. */
  createTransactionWithNotesMarker: boolean;
  /** Can explode source split lines into separate normal target transactions. */
  createSplitLinesAsSeparateTransactions: boolean;
  /** Can create a grouped split target (parent + child lines) in one write. */
  createTargetSplitTransaction: boolean;
  /**
   * Whether source and target budgets can be held open simultaneously in
   * isolated runtimes (Pattern B). When false, cross-budget sync must switch
   * budgets sequentially through a single runtime (Pattern A).
   */
  supportsMultiRuntimeBudgetAccess: boolean;
  updateTransaction: boolean;
  deleteTransaction: boolean;
};

export type SyncCapabilityReport = {
  mode: "http-api" | "browser-api";
  supported: boolean;
  reason: string | null;
  capabilities: SyncCapabilitySet;
};

export type SyncConnectionReference = {
  mode: "http-api" | "browser-api";
  fingerprint: string;
  label?: string;
  budgetSyncId?: string;
  budgetName?: string;
  accountId?: string;
  accountName?: string;
};

export type SyncFlowLeg = {
  id: string;
  flowId: string;
  position: number;
  sourceRef: JsonEnvelope;
  targetRef: JsonEnvelope;
  filter: JsonEnvelope;
  transform: JsonEnvelope;
  options: JsonEnvelope;
  createdAt: string;
  updatedAt: string;
};

export type SyncFlow = {
  id: string;
  name: string;
  enabled: boolean;
  flowType: SyncDomain;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  legs: SyncFlowLeg[];
};

export type SyncFlowRun = {
  id: string;
  flowId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: JsonEnvelope;
  error: JsonEnvelope | null;
  createdByTrigger: SyncRunTrigger;
  sourceSnapshotSummary: JsonEnvelope | null;
  targetSnapshotSummary: JsonEnvelope | null;
  counts: JsonEnvelope | null;
};

export type SyncFlowRunItem = {
  id: string;
  runId: string;
  flowId: string | null;
  legId: string | null;
  /** Stable render order within a run (planner output order); null on legacy rows. */
  sequence: number | null;
  sourceItemRef: JsonEnvelope;
  targetItemRef: JsonEnvelope | null;
  status: string;
  message: string | null;
  sourceEntityType: SyncEntityType | null;
  sourceItemKey: string | null;
  sourceTransactionId: string | null;
  sourceSplitId: string | null;
  sourceFingerprint: string | null;
  plannedAction: string | null;
  plannedTargetPayload: JsonEnvelope | null;
  classification: SyncItemClassification | null;
  duplicateConfidence: SyncDuplicateConfidence | null;
  warnings: JsonEnvelope | null;
  errors: JsonEnvelope | null;
  selectedForApply: boolean;
  applyState: SyncApplyState | null;
  createdTargetTransactionId: string | null;
  createdTargetMarker: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type SyncMapping = {
  id: string;
  flowId: string;
  sourceConnectionFingerprint: string;
  sourceBudgetId: string;
  sourceAccountId: string | null;
  sourceEntityType: SyncEntityType;
  sourceTransactionId: string | null;
  sourceSplitId: string | null;
  sourceItemKey: string;
  sourceFingerprint: string;
  targetConnectionFingerprint: string;
  targetBudgetId: string;
  targetAccountId: string | null;
  targetEntityType: SyncEntityType;
  targetTransactionId: string | null;
  targetItemKey: string | null;
  targetFingerprint: string | null;
  targetMarker: string | null;
  createdRunId: string | null;
  status: SyncMappingStatus;
  lastSeenAt: string | null;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncMappingInput = Omit<SyncMapping, "id" | "createdAt" | "updatedAt" | "status" | "lastSeenAt" | "lastAppliedAt"> & {
  id?: string;
  status?: SyncMappingStatus;
  lastSeenAt?: string | null;
  lastAppliedAt?: string | null;
};

export type SyncMappingPatch = Partial<
  Pick<
    SyncMapping,
    | "sourceFingerprint"
    | "targetTransactionId"
    | "targetItemKey"
    | "targetFingerprint"
    | "targetMarker"
    | "createdRunId"
    | "status"
    | "lastSeenAt"
    | "lastAppliedAt"
  >
>;

// ─── Credential vault (RD-058 / PR-024a) ────────────────────────────────────

/** The plaintext secret sealed in the vault for an unattended-sync connection. */
export type SyncCredentialSecret = {
  apiKey: string;
  encryptionPassword?: string;
};

/** Non-secret credential metadata - safe to return to the client. */
export type SyncCredentialMeta = {
  connectionFingerprint: string;
  mode: string;
  baseUrl: string;
  budgetSyncId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

/** Full credential (metadata + decrypted secret) - server-only, never sent to the client. */
export type SyncCredential = SyncCredentialMeta & { secret: SyncCredentialSecret };

export type SyncCredentialInput = {
  connectionFingerprint: string;
  mode: string;
  baseUrl: string;
  budgetSyncId: string;
  label?: string;
  secret: SyncCredentialSecret;
};

// ── Server-scoped remembered credentials (RD-063 / PR-028a) ──────────────────

/** The sealed secret for a server: an API key (HTTP) or server password (Direct). */
export type ServerCredentialSecret = {
  apiKey?: string;
  serverPassword?: string;
};

/** Non-secret server-credential metadata - safe to return to the client. */
export type ServerCredentialMeta = {
  serverFingerprint: string;
  mode: ConnectionMode;
  baseUrl: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

/** Full server credential (metadata + decrypted secret) - server-only. */
export type ServerCredential = ServerCredentialMeta & { secret: ServerCredentialSecret };

export type ServerCredentialInput = {
  mode: ConnectionMode;
  baseUrl: string;
  label?: string;
  secret: ServerCredentialSecret;
};

/** A remembered per-budget encryption password (opt-in), keyed under its server. */
export type BudgetEncryptionCredentialInput = {
  serverFingerprint: string;
  budgetSyncId: string;
  label?: string;
  encryptionPassword: string;
};

/** Non-secret record of a budget opened on a remembered server (one-click reconnect). */
export type RememberedBudget = {
  serverFingerprint: string;
  budgetSyncId: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type RememberedBudgetInput = {
  serverFingerprint: string;
  budgetSyncId: string;
  name?: string;
};

// ── Saved ActualQL queries (RD-064 / PR-029) ─────────────────────────────────
// Global (not budget-scoped). `isFavorite` is stored as an integer column and
// normalized to boolean by the repository. Shape is structurally compatible
// with the query feature's client-side `SavedQuery` type.
/**
 * A "these are not duplicates" decision, or a rejected learned affix
 * (RD-078 §14 / PR-041d).
 *
 * Suppression is a property of the *relationship*, not of a payee: marking
 * `EMIRATES` and `EMIRATES NBD` as unrelated must not hide either of them from
 * a different, well-evidenced cluster.
 */
export type PayeeCleanupSuppressionRecord = {
  id: string;
  budgetSyncId: string;
  kind: "not-duplicates" | "rejected-affix" | "rule-not-needed";
  /** Precise, but gone once the payees are merged or deleted. */
  payeeIds: string[];
  /** Outlives the ids; for an affix, the affix tokens. */
  normalizedNames: string[];
  /** Which detector or reducer produced the rejected proposal, when known. */
  detectorIds: string[];
  note?: string;
  createdAt: string;
};

export type SavedQueryRecord = {
  id: string;
  name: string;
  /** Raw ActualQL JSON string as the user wrote it. */
  query: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
};

// ── Automation engine (RD-079 / PR-043a) ─────────────────────────────────────

/**
 * Where an automation actually executes.
 *
 * `server` is unattended: the in-process scheduler runs it with an enrolled
 * vault credential whether or not anyone has Bench open. `browser` runs only
 * while Bench is open, which is a convenience, not automation — the UI has to
 * say so rather than implying a Direct-mode connection can run unattended.
 */
export type AutomationExecutionMode = "browser" | "server";

export type AutomationScheduleKind = "interval" | "cron";

export type AutomationRunStatus =
  | "running"
  | "succeeded"
  /** Completed, but part of the work failed (e.g. one account of several). */
  | "partial"
  | "failed"
  | "cancelled"
  /** Ran, nothing to do. Distinct from `succeeded` so history is honest. */
  | "no_changes";

export type AutomationRunTrigger = "schedule" | "manual" | "retry";

/**
 * Engine-derived, cross-type summary of a run — the only thing list views may
 * read. Anything richer belongs in the type-owned `result` payload, rendered by
 * the job type itself.
 */
export type AutomationRunRollup = {
  outcome: "ok" | "partial" | "failed" | "no_changes";
  /** Units of work the type processed (accounts, items, files); type-defined. */
  itemCount: number;
  /** One plain-language line for the run list. Never contains secrets. */
  message?: string;
  /**
   * Whether a **partial** run should count against the failure streak that
   * eventually auto-pauses the automation.
   *
   * This is the job type's call, not the engine's, because the same word means
   * different things: for Budget File Sync a partial apply means writes failed
   * and RD-058 rightly counted it as a failure; for a bank sync one unreachable
   * account out of twelve is a normal Tuesday, and pausing the whole automation
   * over it would be wrong. Defaults to false — reported honestly as partial,
   * but not held against the automation's health.
   */
  countsAsFailure?: boolean;
};

export type AutomationFailurePolicy = {
  /**
   * How long to wait after a failure before the schedule may fire again. The
   * delay doubles with each consecutive failure up to `backoffCeilingMinutes`,
   * so a broken automation stops hammering a provider it cannot reach.
   *
   * There is deliberately no `maxAttempts`: the engine does not retry *within*
   * one occurrence. A failed run ends, and the next scheduled occurrence — once
   * the backoff has elapsed — is the retry. Anything else would need a
   * mid-occurrence retry loop that does not exist, and a policy field that
   * describes behaviour the code does not have is worse than no field.
   */
  backoffMinutes: number;
  backoffCeilingMinutes: number;
  /** Consecutive failed runs before the automation auto-pauses. */
  pauseAfterConsecutiveFailures: number;
};

export type AutomationDefinition = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  executionMode: AutomationExecutionMode;
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  cronExpression: string | null;
  /** IANA timezone name. */
  timezone: string;
  targetRef: JsonEnvelope;
  /** Vault reference (RD-063 server fingerprint) — never a secret. */
  credentialRef: string | null;
  config: JsonEnvelope;
  failurePolicy: AutomationFailurePolicy;
  consecutiveFailures: number;
  autoPausedAt: string | null;
  autoPauseReason: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  /** Set while a run holds the execution claim; null when free. */
  runningSince: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRun = {
  id: string;
  automationId: string | null;
  type: string;
  status: AutomationRunStatus;
  startedAt: string;
  finishedAt: string | null;
  trigger: AutomationRunTrigger;
  attempt: number;
  executionMode: AutomationExecutionMode;
  /** Type-owned payload. The engine stores and returns it without inspecting it. */
  result: JsonEnvelope | null;
  rollup: AutomationRunRollup | null;
  error: JsonEnvelope | null;
};

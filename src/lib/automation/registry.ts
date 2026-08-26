import type {
  AutomationDefinition,
  AutomationRunRollup,
  JsonEnvelope,
  SqliteDatabase,
} from "@/lib/app-db/types";

/**
 * The job-type registry (RD-079 / PR-043a).
 *
 * A feature becomes an automation by registering `{ type, validateConfig, run,
 * summarize }` and inheriting scheduling, locking, retries, history and health.
 * This module is the contract only — the engine that calls it is PR-043b, and
 * the first real registration (Budget File Sync) is PR-043c.
 *
 * The acceptance criterion this shape exists to satisfy: *a second job type can
 * be registered without touching scheduler internals.* Two consequences follow,
 * and both are deliberate:
 *
 *   * `classification` is **optional**. Job types that construct writes through
 *     Bench opt in to the shared Safe/Review/Blocked pipeline and the review
 *     queue. Job types that merely trigger an operation Actual owns — RD-080's
 *     bank sync being the first — construct nothing, and must not be made to
 *     synthesize empty preview records to satisfy a universal contract.
 *
 *   * `TResult` is the type's own. The engine stores it verbatim and asks the
 *     type to `summarize` it for cross-type list views; nothing in the engine
 *     reads inside it.
 */

/** Structured log line from a running job. Never carries secret material. */
export type AutomationLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

/** Coarse progress for long runs; the engine decides whether to surface it. */
export type AutomationProgressReporter = (progress: {
  completed: number;
  total: number;
  message?: string;
}) => void;

export type AutomationSecret = {
  apiKey: string;
  encryptionPassword?: string;
};

/**
 * Credentials resolved for this run, or the reason there are none.
 *
 * A discriminated union rather than a nullable secret, so a job type cannot
 * proceed on a missing credential by forgetting a null check: there is nothing
 * to read until `status` is `"resolved"`. The engine also fails closed before
 * it gets here, but the type makes the mistake unrepresentable rather than
 * merely unlikely.
 *
 * `reveal()` is lazy on purpose. Most job types never need the raw secret —
 * they hand the reference to a transport that opens it — so the decrypted value
 * should not be sitting in a context object that a job might log or serialize
 * into its result.
 */
export type AutomationCredentials =
  | { status: "resolved"; serverFingerprint: string; reveal(): AutomationSecret }
  | { status: "not-required" }
  | { status: "unavailable"; reason: string };

export type AutomationRunContext<TConfig> = {
  definition: AutomationDefinition;
  config: TConfig;
  credentials: AutomationCredentials;
  /** Attempt number for this occurrence, starting at 1. */
  attempt: number;
  /** Aborted on shutdown or user cancellation; honor it between steps. */
  signal: AbortSignal;
  logger: AutomationLogger;
  reportProgress: AutomationProgressReporter;
};

/**
 * Declared by job types that construct writes through Bench, so the engine
 * knows to route their output into the shared review queue. Absent means the
 * type produces nothing reviewable.
 */
export type AutomationClassificationSupport = {
  /** Queue items this type can contribute, for filtering the shared queue. */
  reviewSubjects: readonly string[];
  /** May automation policy apply items classified safe without a human? */
  supportsAutoApply: boolean;
};

export type AutomationJobType<TConfig = unknown, TResult = unknown> = {
  /** Stable identifier persisted on every definition and run row. */
  type: string;
  /** Human-readable name for the Automations UI. */
  label: string;
  /**
   * Parse and validate a stored config envelope into the type's own shape.
   * Throws on invalid config — the engine turns that into a failed run with a
   * readable reason rather than attempting to run on nonsense.
   */
  validateConfig(raw: JsonEnvelope): TConfig;
  run(ctx: AutomationRunContext<TConfig>): Promise<TResult>;
  /** Reduce a type-owned result to the engine's cross-type roll-up. */
  summarize(result: TResult): AutomationRunRollup;
  /** Persist the result for history. Separate from `summarize` so the stored
   * payload keeps its full detail while the roll-up stays small. */
  serializeResult(result: TResult): JsonEnvelope;
  classification?: AutomationClassificationSupport;
  /**
   * Bring this type's automations in line with the feature's own configuration.
   *
   * Called on every engine tick, before anything is selected to run. It exists
   * because a feature's configuration lives outside the engine and changes
   * while the server is up: Budget File Sync flows are created and switched to
   * unattended from the Sync UI at any time, and running the reconciliation
   * only at boot meant a flow enrolled after startup silently never ran until
   * the next restart.
   *
   * Must be idempotent and cheap — it runs once a minute. Errors are logged and
   * swallowed; a type that cannot reconcile must not stop other automations
   * from running.
   */
  reconcile?(db: SqliteDatabase): void | Promise<void>;
};

const registry = new Map<string, AutomationJobType<never, never>>();

/**
 * Register a job type. Duplicate registration of the same `type` is a
 * programming error, not a recoverable condition — two implementations behind
 * one identifier would make stored runs ambiguous.
 */
export function registerAutomationJobType<TConfig, TResult>(
  jobType: AutomationJobType<TConfig, TResult>
): void {
  if (!jobType.type.trim()) {
    throw new Error("Automation job type must have a non-empty type identifier");
  }
  if (registry.has(jobType.type)) {
    throw new Error(`Automation job type "${jobType.type}" is already registered`);
  }
  registry.set(jobType.type, jobType as unknown as AutomationJobType<never, never>);
}

export function getAutomationJobType(type: string): AutomationJobType<never, never> | undefined {
  return registry.get(type);
}

export function listAutomationJobTypes(): AutomationJobType<never, never>[] {
  return [...registry.values()];
}

/** Test-only: drop every registration between cases. */
export function __resetAutomationRegistryForTests(): void {
  registry.clear();
}

import { getAppDb } from "@/lib/app-db/connection";
import { verifyConnection, sealEnrolmentSecret, type VerifyConnectionResult } from "@/lib/actual/verifyConnection";
import { getAutomationExecutor } from "@/lib/automation/executor";
import { logger } from "@/lib/logger";
import { generateId } from "@/lib/uuid";
import { runWorkerTask, workerAvailability } from "@/lib/workers/supervisor";
import type { SyncCredentialInput, SyncCredentialMeta } from "@/lib/app-db/types";
import type { ActualErrorCode } from "@/lib/actual/runtime/errors";
import { upsertSyncCredential } from "./unattendedCredentials";

/**
 * Enrolling a connection for unattended use: checked first, stored only if
 * the check passes (RD-095 M4).
 *
 * The check opens the budget the way a run would, which can take tens of
 * seconds - longer than some reverse proxies let a request wait. So an
 * enrolment is started, answered with an id, and followed by polling, like
 * Run now. The server stores the credential itself when the check passes; the
 * page only watches.
 *
 * What is kept here is the outcome, never the secret: the secret is sealed
 * into the check's input and dropped when the check ends. Outcomes live on
 * `globalThis` for a few minutes (a route module and the one that started the
 * check may be different instances) and are gone after a restart - which
 * loses nothing, because nothing was stored before the check passed.
 *
 * Server-only.
 */

export type EnrolmentStatus =
  | { status: "verifying" }
  | { status: "enrolled"; credential: SyncCredentialMeta }
  | { status: "failed"; code: ActualErrorCode | "BUSY" | "NEEDS_WORKERS" | null; message: string };

type Entry = EnrolmentStatus & { at: number };

/** Enough for the check's deadline and a page to read the answer afterwards. */
const KEEP_MS = 10 * 60_000;
/** A cold open of a budget with a very stale snapshot took 54 s in M0. */
export const VERIFY_DEADLINE_MS = 3 * 60_000;

const REGISTRY_KEY = Symbol.for("actual-bench.enrolments");
type Holder = { [REGISTRY_KEY]?: Map<string, Entry> };

function registry(): Map<string, Entry> {
  const holder = globalThis as Holder;
  holder[REGISTRY_KEY] ??= new Map();
  return holder[REGISTRY_KEY];
}

function prune(now: number): void {
  for (const [id, entry] of registry()) {
    if (entry.status !== "verifying" && now - entry.at > KEEP_MS) registry().delete(id);
  }
}

export class EnrolmentRefusedError extends Error {
  constructor(
    message: string,
    readonly code: "BUSY" | "NEEDS_WORKERS"
  ) {
    super(message);
    this.name = "EnrolmentRefusedError";
  }
}

/** Run the check where it can run: in a worker, or in-thread for HTTP when workers are off. */
async function check(input: SyncCredentialInput, signal: AbortSignal): Promise<VerifyConnectionResult> {
  const taskInput = {
    connectionFingerprint: input.connectionFingerprint,
    mode: input.mode as "http-api" | "browser-api",
    baseUrl: input.baseUrl,
    budgetSyncId: input.budgetSyncId,
    label: input.label ?? "",
    sealed: sealEnrolmentSecret(input.secret),
  };

  if (getAutomationExecutor().name !== "worker") return verifyConnection(taskInput);

  const outcome = await runWorkerTask("connection.verify", taskInput, { signal });
  switch (outcome.status) {
    case "result": {
      const result = outcome.output as VerifyConnectionResult | null;
      return result && typeof result.ok === "boolean"
        ? result
        : { ok: false, code: null, message: "The check returned an answer Bench could not read." };
    }
    case "error":
      return { ok: false, code: null, message: outcome.message };
    case "stopped":
      return {
        ok: false,
        code: null,
        message:
          outcome.code === "TIMEOUT"
            ? "The check took too long. Try again."
            : outcome.code === "NO_CAPACITY"
              ? "Bench is busy running automations. Try again in a minute."
              : outcome.message,
      };
  }
}

/**
 * Start enrolling. Refuses at once when the check cannot run now; otherwise
 * answers with an id to follow and carries on in the background.
 */
export function startEnrolment(input: SyncCredentialInput): string {
  const worker = getAutomationExecutor().name === "worker";
  if (!worker && input.mode === "browser-api") {
    throw new EnrolmentRefusedError(
      "Direct connections need worker threads. Remove ACTUAL_BENCH_AUTOMATION_EXECUTOR=in-thread to enrol one.",
      "NEEDS_WORKERS"
    );
  }
  if (worker) {
    const availability = workerAvailability();
    if (!availability.ok) {
      throw new EnrolmentRefusedError(
        availability.code === "NO_CAPACITY"
          ? "Bench is busy running automations. Try again in a minute."
          : availability.message,
        "BUSY"
      );
    }
  }

  const now = Date.now();
  prune(now);
  const id = generateId();
  registry().set(id, { status: "verifying", at: now });

  const finish = (entry: EnrolmentStatus): void => {
    registry().set(id, { ...entry, at: Date.now() });
  };

  void check(input, AbortSignal.timeout(VERIFY_DEADLINE_MS))
    .then((result) => {
      if (!result.ok) {
        finish({ status: "failed", code: result.code, message: result.message });
        return;
      }
      finish({ status: "enrolled", credential: upsertSyncCredential(getAppDb(), input) });
    })
    .catch((error: unknown) => {
      // Not the check failing - something around it. Said plainly, never with
      // the secret: nothing here has it in a message.
      logger.warn(`[enrolment] ${error instanceof Error ? error.message : String(error)}`);
      finish({ status: "failed", code: null, message: "The enrolment could not be completed. Try again." });
    });

  return id;
}

/** How an enrolment is going, or `null` for an id this process does not know. */
export function getEnrolment(id: string): EnrolmentStatus | null {
  prune(Date.now());
  const entry = registry().get(id);
  if (!entry) return null;
  const status: Partial<Entry> = { ...entry };
  delete status.at;
  return status as EnrolmentStatus;
}

/** Test seam: settle every enrolment still being checked. */
export async function __waitForEnrolmentsForTests(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (![...registry().values()].some((entry) => entry.status === "verifying")) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function __resetEnrolmentsForTests(): void {
  registry().clear();
}

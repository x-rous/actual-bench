import { getAutomationExecutor } from "@/lib/automation/executor";
import { logger } from "@/lib/logger";
import { runWorkerTask } from "@/lib/workers/supervisor";
import { actualErrorMessage, classifyActualError, type ActualErrorCode } from "./runtime/errors";

/**
 * A read about an enrolled connection that a page asks for - its bank
 * accounts, the other budgets on its server - run where it can run (RD-095).
 *
 * A Direct budget opens only in a worker, so the work goes to one by
 * reference: the worker reveals the credential itself. An HTTP API one can
 * run in this thread when workers are turned off. Either way the page gets a
 * fixed, plain message for a failure, never the worker's own text, which can
 * carry internal detail; that goes to the server log.
 *
 * A worker handler answers `{ value }`, or `{ failed: code }` for a failure
 * Actual reported in a way Bench knows how to explain.
 *
 * Server-only.
 */

export type ConnectionTaskOutput<T> = { value: T } | { failed: ActualErrorCode };

export type ConnectionTaskResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

type Messages = {
  /** For a failure Bench cannot explain. */
  failed: string;
  /** When the deadline passed. */
  timedOut: string;
};

function knownFailure(code: ActualErrorCode, mode: string): string {
  // Actual's own wording is about a password; an HTTP API connection has a key.
  if (code === "AUTH_FAILED" && mode === "http-api") return "The server did not accept the API key.";
  return actualErrorMessage(code);
}

export async function runConnectionTask<T>(input: {
  kind: string;
  taskInput: object;
  mode: string;
  deadlineMs: number;
  messages: Messages;
  /** The same work, in this thread, for an HTTP API connection when workers are off. */
  inThread: () => Promise<T>;
}): Promise<ConnectionTaskResult<T>> {
  const { kind, mode, messages } = input;

  if (getAutomationExecutor().name !== "worker") {
    if (mode === "browser-api") {
      return {
        ok: false,
        status: 400,
        message: "Direct connections need worker threads. Remove ACTUAL_BENCH_AUTOMATION_EXECUTOR=in-thread.",
      };
    }
    try {
      return { ok: true, value: await input.inThread() };
    } catch (error) {
      const code = classifyActualError(error);
      if (!code) logger.warn(`[${kind}] ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, status: 502, message: code ? knownFailure(code, mode) : messages.failed };
    }
  }

  const outcome = await runWorkerTask(kind, input.taskInput, { signal: AbortSignal.timeout(input.deadlineMs) });
  const output = outcome.status === "result" ? (outcome.output as ConnectionTaskOutput<T> | null) : null;
  if (output && "value" in output) return { ok: true, value: output.value };
  if (output && "failed" in output) return { ok: false, status: 502, message: knownFailure(output.failed, mode) };

  if (outcome.status === "stopped" && outcome.code === "NO_CAPACITY") {
    return { ok: false, status: 503, message: "Bench is busy running automations. Try again in a minute." };
  }
  if (outcome.status === "stopped" && outcome.code === "TIMEOUT") {
    return { ok: false, status: 504, message: messages.timedOut };
  }
  logger.warn(`[${kind}] worker ${outcome.status}: ${outcome.status === "result" ? "unreadable answer" : outcome.message}`);
  return { ok: false, status: 502, message: messages.failed };
}

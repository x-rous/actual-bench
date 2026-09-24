import { z } from "zod";
import { closeNodeRuntime } from "@/lib/actual/runtime/nodeHost";
import { listAccountsForBankSync } from "@/lib/actual/bankSyncAccounts";
import { openServerTransport, resolveServerConnection } from "@/lib/actual/serverTransport";
import { verifyConnection, verifyConnectionInput } from "@/lib/actual/verifyConnection";
import { getAppDb } from "@/lib/app-db/connection";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { executeJob } from "@/lib/automation/jobExecution";
import { redactSecrets } from "@/lib/automation/runLogger";
import type { AutomationRunPhase } from "@/lib/automation/registry";
import {
  parentToWorkerMessage,
  type WorkerToParentMessage,
} from "./protocol";

/**
 * What a worker thread does with the messages it is sent (RD-095).
 *
 * Kept apart from `bench.worker.ts` so it is an ordinary module: the worker
 * entry wires it to `parentPort`, and tests call it directly, in-thread, with
 * the same code a worker runs. The registry of task kinds lives here; adding a
 * kind - `connection.verify`, and later AI's `tool.call` - is adding an entry,
 * not changing the protocol or the supervisor.
 */

type TaskContext = {
  signal: AbortSignal;
  enterPhase(phase: AutomationRunPhase): void;
};

type TaskHandler = (input: unknown, ctx: TaskContext) => Promise<unknown>;

const automationRunInput = z.object({
  automationId: z.string().min(1),
  runId: z.string().min(1),
  attempt: z.number().int().min(1),
  input: z.object({ version: z.number(), data: z.record(z.string(), z.unknown()) }).nullable(),
});

function abortedSignal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

const handlers: Record<string, TaskHandler> = {
  /**
   * Prove a worker can do real work, not merely start: load every job type,
   * and make one request through the same `fetch` a job uses - Next patches
   * it in server code, and a worker missing Next's environment fails there,
   * not at startup. A `data:` URL keeps it off the network.
   */
  preflight: async () => {
    ensureAutomationJobTypesRegistered();
    const response = await fetch("data:text/plain,ok");
    const body = await response.text();
    if (body !== "ok") throw new Error(`The self-test request returned "${body.slice(0, 40)}"`);
    return { ok: true };
  },

  /**
   * Check an enrolment against its Actual server before it is stored. The
   * secret arrives sealed and is opened only here.
   */
  "connection.verify": async (raw) => verifyConnection(verifyConnectionInput.parse(raw)),

  /**
   * The accounts of an enrolled budget and their bank links, for the bank-sync
   * dialog. By reference, like a run: the credential is revealed here.
   */
  "connection.bankAccounts": async (raw) => {
    const { connectionFingerprint } = z.object({ connectionFingerprint: z.string().min(1) }).parse(raw);
    const connection = resolveServerConnection(getAppDb(), connectionFingerprint);
    if (!connection) throw new Error("That connection has no stored credentials.");
    const secrets = [
      connection.encryptionPassword,
      connection.mode === "http-api" ? connection.apiKey : connection.serverPassword,
    ].filter((value): value is string => !!value);
    try {
      const transport = openServerTransport(connection);
      return await listAccountsForBankSync((body) => transport.runQuery(body));
    } catch (error) {
      throw new Error(redactSecrets(error instanceof Error ? error.message : String(error), secrets));
    }
  },

  /** Run one automation job, exactly as the engine would in-thread. */
  "automation.run": async (raw, ctx) => {
    const request = automationRunInput.parse(raw);
    ensureAutomationJobTypesRegistered();
    const outcome = await executeJob(
      getAppDb(),
      { ...request, input: request.input as Parameters<typeof executeJob>[1]["input"] },
      { signal: ctx.signal, onPhase: ctx.enterPhase }
    );
    // A Direct budget the job opened is closed before the answer goes back,
    // and its snapshot refreshed only when the job finished cleanly. The job
    // is done by now: a cancel or deadline ends the wait for the upload rather
    // than holding the answer back until the worker is ended without one.
    const refreshSnapshot = outcome.kind === "completed" && !outcome.aborted && !ctx.signal.aborted;
    await Promise.race([closeNodeRuntime({ refreshSnapshot }).catch(() => undefined), abortedSignal(ctx.signal)]);
    return outcome;
  },
};

export type TaskHost = {
  /** Handle one message from the parent. Resolves once a task has settled. */
  handle(raw: unknown): Promise<void>;
};

export function createTaskHost(post: (message: WorkerToParentMessage) => void): TaskHost {
  const controllers = new Map<string, AbortController>();

  return {
    async handle(raw) {
      const parsed = parentToWorkerMessage.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;

      if (message.type === "cancel") {
        controllers.get(message.taskId)?.abort();
        return;
      }

      const handler = handlers[message.kind];
      if (!handler) {
        post({ type: "error", taskId: message.taskId, message: `Unknown task kind "${message.kind}"` });
        return;
      }

      const controller = new AbortController();
      controllers.set(message.taskId, controller);
      try {
        const output = await handler(message.input, {
          signal: controller.signal,
          enterPhase: (phase) => post({ type: "phase", taskId: message.taskId, phase }),
        });
        post({ type: "result", taskId: message.taskId, output });
      } catch (error) {
        // A task that could not run at all. Redacted by pattern: this side
        // knows no run's secrets here, and the message is about to leave.
        post({
          type: "error",
          taskId: message.taskId,
          message: redactSecrets(error instanceof Error ? error.message : String(error)),
        });
      } finally {
        controllers.delete(message.taskId);
        // Whatever the task did, no budget and no downloaded copy outlives it.
        await closeNodeRuntime().catch(() => undefined);
      }
    },
  };
}

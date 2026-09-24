/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { claimAutomation, createAutomation, getAutomation } from "@/lib/app-db/automationRepository";
import { getAutomationRun, listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";
import { __configureWorkerSupervisorForTests } from "@/lib/workers/supervisor";
import { hostBackedSpawn, scriptedSpawn } from "@/lib/workers/testing/fakeWorker";
import { buildAutomationHealth } from "./health";
import {
  __resetEngineStateForTests,
  cancelRun,
  executeAutomation,
  settleBackgroundRuns,
  startAutomationRun,
} from "./engine";
import {
  __resetAutomationRegistryForTests,
  registerAutomationJobType,
  type AutomationJobType,
  type AutomationRunContext,
} from "./registry";
import type { AutomationRunRollup, JsonEnvelope, SqliteDatabase } from "@/lib/app-db/types";

/**
 * The engine running jobs through worker threads (RD-095 M2).
 *
 * The worker is the host-backed fake: the real task host - the code a worker
 * runs - reached through the real protocol, every message structured-cloned
 * as a thread boundary would. The engine, the executor, the supervisor, the
 * job execution and the database are all real.
 */

const SECRET = "sk-live-0123456789abcdef";

type Result = { ok: boolean; note?: string };

function jobType(overrides: Partial<AutomationJobType<{ label: string }, Result>> = {}): AutomationJobType<{ label: string }, Result> {
  return {
    type: "worker-test",
    label: "Worker test",
    validateConfig: (raw: JsonEnvelope) => ({ label: String(raw.data.label ?? "") }),
    run: async () => ({ ok: true, note: "done" }),
    summarize: (result): AutomationRunRollup => ({ outcome: result.ok ? "ok" : "failed", itemCount: 1, message: result.note }),
    serializeResult: (result) => ({ version: 1, data: { ok: result.ok } }),
    ...overrides,
  };
}

/** A job that never finishes and ignores its signal - a hang the worker must end. */
const hang = () => new Promise<Result>(() => {});

describe("automations in worker threads", () => {
  let root: string;
  let db: SqliteDatabase;
  const saved = {
    executor: process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR,
    dbPath: process.env.ACTUAL_BENCH_DB_PATH,
    vault: process.env.SYNC_VAULT_KEY,
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-engine-worker-"));
    // The task host opens the app database by its configured path, as a
    // worker would; the test's handle must be the same file.
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    db = getAppDb();
  });

  afterEach(async () => {
    await settleBackgroundRuns();
    __resetEngineStateForTests();
    __resetAutomationRegistryForTests();
    __configureWorkerSupervisorForTests();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of [
      ["ACTUAL_BENCH_AUTOMATION_EXECUTOR", saved.executor],
      ["ACTUAL_BENCH_DB_PATH", saved.dbPath],
      ["SYNC_VAULT_KEY", saved.vault],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function automation(extra: Record<string, unknown> = {}): string {
    return createAutomation(db, {
      type: "worker-test",
      name: "Worker test",
      scheduleKind: "interval",
      intervalMinutes: 60,
      config: { version: 1, data: { label: "x" } },
      ...extra,
    }).id;
  }

  it("records the same run through a worker as in the server's own thread", async () => {
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn().spawn });
    registerAutomationJobType(jobType());
    const id = automation();

    const viaWorker = await executeAutomation(db, id, { trigger: "manual" });

    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "in-thread";
    const inThread = await executeAutomation(db, id, { trigger: "manual" });

    const strip = (runId: string | null) => {
      const run = getAutomationRun(db, runId!)!;
      // The log lines carry timestamps; everything else must match exactly.
      const data = { ...(run.result!.data as Record<string, unknown>) };
      delete data.log;
      return { status: run.status, rollup: run.rollup, data };
    };
    expect(viaWorker.status).toBe("succeeded");
    expect(strip(viaWorker.runId)).toEqual(strip(inThread.runId));
    expect(getAutomation(db, id)).toMatchObject({ consecutiveFailures: 0, runningSince: null });
  });

  it("never lets a secret cross the thread boundary, even in an error", async () => {
    process.env.SYNC_VAULT_KEY = "test-operator-key";
    upsertSyncCredential(db, {
      connectionFingerprint: "conn-1",
      mode: "http-api",
      baseUrl: "https://api.example.com",
      budgetSyncId: "budget-1",
      secret: { apiKey: SECRET },
    });
    const { spawn, crossings } = hostBackedSpawn();
    __configureWorkerSupervisorForTests({ spawn });
    registerAutomationJobType(
      jobType({
        run: async (ctx: AutomationRunContext<{ label: string }>) => {
          if (ctx.credentials.status !== "resolved") throw new Error("no credential");
          const secret = ctx.credentials.reveal();
          ctx.logger.info(`using ${secret.apiKey}`);
          throw new Error(`upstream rejected key ${secret.apiKey}`);
        },
      })
    );
    const id = automation({ credentialRef: "conn-1" });

    const outcome = await executeAutomation(db, id, { trigger: "manual" });

    expect(outcome.status).toBe("failed");
    expect(JSON.stringify(crossings)).not.toContain(SECRET);
    expect(JSON.stringify(getAutomationRun(db, outcome.runId!))).not.toContain(SECRET);
  });

  it("fails a run that hangs while still reading, and counts it", async () => {
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn().spawn, graceMs: 10 });
    registerAutomationJobType(jobType({ run: hang, deadlineMs: 30 }));
    const id = automation();

    const outcome = await executeAutomation(db, id);

    expect(outcome).toMatchObject({ status: "failed", code: "TIMEOUT" });
    const run = getAutomationRun(db, outcome.runId!)!;
    expect(run.error?.data).toMatchObject({ code: "TIMEOUT" });
    expect(getAutomation(db, id)).toMatchObject({ consecutiveFailures: 1, runningSince: null });
  });

  it("marks a run stopped after it may have written as indeterminate, and does not count it", async () => {
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn().spawn, graceMs: 10 });
    registerAutomationJobType(
      jobType({
        deadlineMs: 30,
        run: async (ctx) => {
          ctx.enterPhase("mutating");
          return hang();
        },
      })
    );
    const id = automation();

    const outcome = await executeAutomation(db, id);

    expect(outcome.status).toBe("indeterminate");
    const run = getAutomationRun(db, outcome.runId!)!;
    expect(run.status).toBe("indeterminate");
    expect(run.rollup?.message).toMatch(/may have made changes/);
    // Not a failure: no streak, so no backoff and no auto-pause.
    expect(getAutomation(db, id)).toMatchObject({ consecutiveFailures: 0, autoPausedAt: null, runningSince: null });
    const [health] = buildAutomationHealth(db).automations;
    expect(health.status).toBe("warning");
  });

  it("cancels a run that honours its signal", async () => {
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn().spawn });
    registerAutomationJobType(
      jobType({
        run: (ctx) =>
          new Promise<Result>((resolve) => {
            ctx.signal.addEventListener("abort", () => resolve({ ok: true, note: "stopped cleanly" }));
          }),
      })
    );
    const id = automation();

    const start = startAutomationRun(db, id, { trigger: "manual" });
    if (!start.started) throw new Error("expected a started run");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelRun(start.runId)).toBe(true);

    await expect(start.done).resolves.toMatchObject({ status: "cancelled" });
    expect(getAutomation(db, id)).toMatchObject({ consecutiveFailures: 0, runningSince: null });
  });

  it("ends a cancelled run that will not stop, after the grace period", async () => {
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn().spawn, graceMs: 10 });
    registerAutomationJobType(jobType({ run: hang }));
    const id = automation();

    const start = startAutomationRun(db, id, { trigger: "manual" });
    if (!start.started) throw new Error("expected a started run");
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRun(start.runId);

    await expect(start.done).resolves.toMatchObject({ status: "cancelled" });
    expect(getAutomationRun(db, start.runId)?.error?.data).toMatchObject({ code: "CANCELLED" });
  });

  it("reports a worker that ran out of memory as a failure of that run only", async () => {
    const { spawn } = scriptedSpawn((worker) => {
      setImmediate(() =>
        worker.emit("error", Object.assign(new Error("heap limit"), { code: "ERR_WORKER_OUT_OF_MEMORY" }))
      );
    });
    __configureWorkerSupervisorForTests({ spawn });
    registerAutomationJobType(jobType());
    const id = automation();

    const outcome = await executeAutomation(db, id);

    expect(outcome).toMatchObject({ status: "failed", code: "OUT_OF_MEMORY" });
    expect(getAutomation(db, id)?.runningSince).toBeNull();
  });

  it("skips, without counting or claiming, when every worker slot is busy", async () => {
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn().spawn, maxSlots: 1, graceMs: 10 });
    registerAutomationJobType(jobType({ run: hang }));
    const busy = automation();
    const waiting = automation();

    const first = startAutomationRun(db, busy);
    if (!first.started) throw new Error("expected a started run");
    const second = startAutomationRun(db, waiting);

    expect(second).toMatchObject({ started: false, outcome: { status: "skipped", code: "NO_CAPACITY" } });
    expect(listAutomationRuns(db, { automationId: waiting })).toHaveLength(0);
    expect(getAutomation(db, waiting)).toMatchObject({ consecutiveFailures: 0, autoPausedAt: null, runningSince: null });

    cancelRun(first.runId);
    await first.done;
  });

  it("still refuses a second run of the same automation, whatever the executor", async () => {
    __configureWorkerSupervisorForTests({ spawn: hostBackedSpawn().spawn });
    registerAutomationJobType(jobType());
    const id = automation();
    claimAutomation(db, id, new Date().toISOString());

    expect(startAutomationRun(db, id)).toMatchObject({
      started: false,
      outcome: { message: "A run is already in progress" },
    });
  });
});

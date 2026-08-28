import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createAutomation, getAutomation, listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { upsertSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import {
  __resetEngineStateForTests,
  backoffDelayMinutes,
  cancelAutomation,
  executeAutomation,
  isAutomationRunning,
  resumeAutomationsAwaitingTheirJobType,
  runEngineTick,
  selectDueAutomations,
} from "./engine";
import {
  claimAutomation,
  pauseAutomationForHealth,
  releaseAutomationClaim,
} from "@/lib/app-db/automationRepository";
import { __resetBankSyncRegistrationForTests, registerBankSyncJobType } from "./jobs/bankSync";
import {
  __resetBudgetFileSyncRegistrationForTests,
  registerBudgetFileSyncJobType,
} from "./jobs/budgetFileSync";
import {
  __resetAutomationRegistryForTests,
  registerAutomationJobType,
  type AutomationJobType,
  type AutomationRunContext,
} from "./registry";
import type { AutomationRunRollup, JsonEnvelope, SqliteDatabase } from "@/lib/app-db/types";

const VAULT_KEY = "0".repeat(64);

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-engine-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

type TestConfig = { label: string };

/**
 * A job type registered only in this test file — the acceptance criterion
 * "a second job type can be registered without touching scheduler internals",
 * exercised before any real second type exists.
 */
function testJobType(
  overrides: Partial<AutomationJobType<TestConfig, { ok: boolean; note?: string }>> = {}
): AutomationJobType<TestConfig, { ok: boolean; note?: string }> {
  return {
    type: "test-job",
    label: "Test job",
    validateConfig(raw: JsonEnvelope): TestConfig {
      return { label: String(raw.data.label ?? "unnamed") };
    },
    async run(): Promise<{ ok: boolean; note?: string }> {
      return { ok: true };
    },
    summarize(result): AutomationRunRollup {
      return { outcome: result.ok ? "ok" : "failed", itemCount: 1, message: result.note };
    },
    serializeResult(result): JsonEnvelope {
      return { version: 1, data: { ok: result.ok } };
    },
    ...overrides,
  };
}

function definition(db: SqliteDatabase, extra: Record<string, unknown> = {}): string {
  return createAutomation(db, {
    type: "test-job",
    name: "Test automation",
    scheduleKind: "interval",
    intervalMinutes: 30,
    targetRef: { version: 1, data: {} },
    config: { version: 1, data: { label: "nightly" } },
    ...extra,
  }).id;
}

describe("a pause that outlived its cause", () => {
  it("gives back an automation once its job type is registered", async () => {
    // The engine paused every backup and bank sync in one install because a
    // startup hook registered one type. Clearing that by hand, one automation
    // at a time, is work Bench created for a fault of its own.
    const { root, db } = tempDb();
    try {
      const id = createAutomation(db, {
        type: "arrives-later",
        name: "Backup",
        executionMode: "server",
        scheduleKind: "interval",
        intervalMinutes: 60,
        config: { version: 1, data: {} },
      }).id;

      await executeAutomation(db, id);
      expect(getAutomation(db, id)?.autoPauseReason).toMatch(/No job type registered/);

      registerAutomationJobType({
        type: "arrives-later",
        label: "Arrives later",
        validateConfig: () => ({}),
        run: async () => ({}),
        summarize: () => ({ outcome: "ok" as const, itemCount: 0 }),
        serializeResult: () => ({ version: 1, data: {} }),
      });

      expect(resumeAutomationsAwaitingTheirJobType(db)).toEqual([id]);
      expect(getAutomation(db, id)?.autoPausedAt).toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves a pause that a person still needs to look at", async () => {
    // Repeated genuine failures are not fixed by a restart, so that pause
    // stays until someone deals with the cause.
    const { root, db } = tempDb();
    try {
      const id = createAutomation(db, {
        type: "arrives-later",
        name: "Backup",
        executionMode: "server",
        scheduleKind: "interval",
        intervalMinutes: 60,
        config: { version: 1, data: {} },
      }).id;

      pauseAutomationForHealth(db, id, new Date().toISOString(), "Failed 5 times in a row");

      expect(resumeAutomationsAwaitingTheirJobType(db)).toEqual([]);
      expect(getAutomation(db, id)?.autoPausedAt).not.toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("automation engine", () => {
  afterEach(() => {
    __resetEngineStateForTests();
    __resetAutomationRegistryForTests();
    resetAppDbForTests();
    delete process.env.SYNC_VAULT_KEY;
  });

  it("runs a registered job type end to end and records the run", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(testJobType());
      const id = definition(db);

      const outcome = await executeAutomation(db, id, { trigger: "manual" });

      expect(outcome.status).toBe("succeeded");
      const [run] = listAutomationRuns(db, { automationId: id });
      expect(run.status).toBe("succeeded");
      expect(run.finishedAt).not.toBeNull();
      expect(run.trigger).toBe("manual");
      expect(run.result?.data.ok).toBe(true);
      expect(run.rollup).toEqual({ outcome: "ok", itemCount: 1 });

      const updated = getAutomation(db, id);
      expect(updated?.consecutiveFailures).toBe(0);
      expect(updated?.lastSuccessAt).not.toBeNull();
      expect(updated?.nextRunAt).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finalizes a run that throws, rather than leaving it stuck in running", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          async run(): Promise<never> {
            throw new Error("provider unreachable");
          },
        })
      );
      const id = definition(db);

      const outcome = await executeAutomation(db, id);

      expect(outcome.status).toBe("failed");
      const [run] = listAutomationRuns(db, { automationId: id });
      expect(run.status).toBe("failed");
      expect(run.finishedAt).not.toBeNull();
      expect(run.error?.data.message).toBe("provider unreachable");
      expect(getAutomation(db, id)?.consecutiveFailures).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports invalid configuration as a failed run with a readable reason", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          validateConfig(): TestConfig {
            throw new Error("label is required");
          },
        })
      );
      const id = definition(db);

      const outcome = await executeAutomation(db, id);
      expect(outcome.status).toBe("failed");
      expect(listAutomationRuns(db, { automationId: id })[0].error?.data.message).toBe("label is required");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never runs one automation twice at once", async () => {
    const { root, db } = tempDb();
    try {
      let started = 0;
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      registerAutomationJobType(
        testJobType({
          async run(): Promise<{ ok: boolean }> {
            started += 1;
            await gate;
            return { ok: true };
          },
        })
      );
      const id = definition(db);

      const first = executeAutomation(db, id);
      // Second call while the first is still awaiting: must be refused, not queued.
      const second = await executeAutomation(db, id);

      expect(second.status).toBe("skipped");
      expect(second.message).toMatch(/already in progress/);

      release();
      await first;
      expect(started).toBe(1);
      expect(listAutomationRuns(db, { automationId: id })).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pauses, fails closed, when a named credential cannot be resolved", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(testJobType());
      const id = definition(db, { credentialRef: "server-1" });

      // Vault disabled: no run at all, and the reason is on the automation.
      const outcome = await executeAutomation(db, id);

      expect(outcome.status).toBe("skipped");
      expect(listAutomationRuns(db, { automationId: id })).toHaveLength(0);
      const paused = getAutomation(db, id);
      expect(paused?.enabled).toBe(false);
      expect(paused?.autoPauseReason).toMatch(/vault is disabled/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pauses an automation whose job type is not registered", async () => {
    const { root, db } = tempDb();
    try {
      const id = definition(db); // nothing registered
      const outcome = await executeAutomation(db, id);

      expect(outcome.status).toBe("skipped");
      expect(getAutomation(db, id)?.autoPauseReason).toMatch(/No job type registered/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a revealed secret out of the run log and the stored error", async () => {
    const { root, db } = tempDb();
    process.env.SYNC_VAULT_KEY = VAULT_KEY;
    try {
      upsertSyncCredential(db, {
        connectionFingerprint: "server-1",
        mode: "http-api",
        baseUrl: "https://budget.example.com",
        budgetSyncId: "budget-1",
        secret: { apiKey: "super-secret-api-key-value" },
      });

      registerAutomationJobType(
        testJobType({
          async run(ctx: AutomationRunContext<TestConfig>): Promise<never> {
            if (ctx.credentials.status !== "resolved") throw new Error("expected credentials");
            const secret = ctx.credentials.reveal();
            ctx.logger.info(`connecting with ${secret.apiKey}`);
            // A provider error that echoes the key back — the realistic leak.
            throw new Error(`401 from https://budget.example.com?key=${secret.apiKey}`);
          },
        })
      );
      const id = definition(db, { credentialRef: "server-1" });

      await executeAutomation(db, id);

      const [run] = listAutomationRuns(db, { automationId: id });
      const serialized = JSON.stringify(run);
      expect(serialized).not.toContain("super-secret-api-key-value");
      expect(run.error?.data.message).toContain("[redacted]");
      expect(JSON.stringify(run.result?.data.log)).toContain("[redacted]");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("auto-pauses after the configured failure streak and says why", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          async run(): Promise<never> {
            throw new Error("still broken");
          },
        })
      );
      const id = definition(db, { failurePolicy: { pauseAfterConsecutiveFailures: 3 } });

      for (let i = 0; i < 3; i += 1) {
        await executeAutomation(db, id);
      }

      const paused = getAutomation(db, id);
      expect(paused?.enabled).toBe(false);
      expect(paused?.autoPausedAt).not.toBeNull();
      expect(paused?.autoPauseReason).toMatch(/3 consecutive failures/);
      expect(paused?.autoPauseReason).toMatch(/still broken/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("backs off further with each consecutive failure, up to the ceiling", () => {
    const policy = { backoffMinutes: 5, backoffCeilingMinutes: 60 };
    expect(backoffDelayMinutes(1, policy)).toBe(5);
    expect(backoffDelayMinutes(2, policy)).toBe(10);
    expect(backoffDelayMinutes(3, policy)).toBe(20);
    // Capped, so a long outage never schedules a run days away.
    expect(backoffDelayMinutes(10, policy)).toBe(60);
  });

  it("defers the next run by the backoff after a failure", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          async run(): Promise<never> {
            throw new Error("nope");
          },
        })
      );
      const nowMs = Date.parse("2026-08-25T10:00:00Z");
      const id = definition(db, { intervalMinutes: 15, failurePolicy: { backoffMinutes: 30 } });

      await executeAutomation(db, id, { nowMs });

      const next = getAutomation(db, id)?.nextRunAt;
      // The 15-minute schedule would say 10:15; the backoff pushes it to 10:30.
      expect(next).toBe("2026-08-25T10:30:00.000Z");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets the job type decide whether a partial run counts against health", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          async run(): Promise<{ ok: boolean; note?: string }> {
            return { ok: true, note: "1 of 3 accounts failed" };
          },
          summarize(): AutomationRunRollup {
            return { outcome: "partial", itemCount: 3, message: "1 of 3 accounts failed" };
          },
        })
      );
      const id = definition(db);

      const outcome = await executeAutomation(db, id);

      expect(outcome.status).toBe("partial");
      // Default: reported as partial, but not held against the automation —
      // one unreachable account out of three is not an outage.
      const updated = getAutomation(db, id);
      expect(updated?.consecutiveFailures).toBe(0);
      expect(updated?.enabled).toBe(true);
      expect(updated?.lastSuccessAt).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("counts a partial run as a failure when the job type says it is one", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          async run(): Promise<{ ok: boolean }> {
            return { ok: true };
          },
          summarize(): AutomationRunRollup {
            // Budget File Sync's rule (RD-058): a partial apply means writes
            // failed, and repeated partials should still auto-pause.
            return { outcome: "partial", itemCount: 2, message: "1 item failed", countsAsFailure: true };
          },
        })
      );
      const id = definition(db);

      await executeAutomation(db, id);

      const updated = getAutomation(db, id);
      expect(updated?.consecutiveFailures).toBe(1);
      expect(updated?.lastSuccessAt).toBeNull();
      // Still reported honestly as partial, not relabelled as failed.
      expect(listAutomationRuns(db, { automationId: id })[0].status).toBe("partial");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("selects only due, server-mode automations", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(testJobType());
      const nowMs = Date.parse("2026-08-25T10:00:00Z");

      const server = definition(db);
      const browser = definition(db, { executionMode: "browser", name: "Browser-owned" });

      const due = selectDueAutomations(db, nowMs).map((d) => d.id);
      expect(due).toContain(server);
      // Browser-owned automations are the user's tab's job, never the server's.
      expect(due).not.toContain(browser);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs due automations on a tick and skips ones that are not due yet", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(testJobType());
      const id = definition(db, { intervalMinutes: 30 });
      const nowMs = Date.parse("2026-08-25T10:00:00Z");

      const first = await runEngineTick(db, { nowMs });
      expect(first.due).toBe(1);
      expect(first.ran[0].status).toBe("succeeded");

      // Ten minutes later the 30-minute interval has not elapsed.
      const second = await runEngineTick(db, { nowMs: nowMs + 10 * 60_000 });
      expect(second.due).toBe(0);
      expect(listAutomationRuns(db, { automationId: id })).toHaveLength(1);

      const third = await runEngineTick(db, { nowMs: nowMs + 31 * 60_000 });
      expect(third.due).toBe(1);
      expect(listAutomationRuns(db, { automationId: id })).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a run whose claim is already held, even from another module instance", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(testJobType());
      const id = definition(db);

      // Simulate the other module instance: the claim exists in the database,
      // but this instance's in-memory set knows nothing about it. Before the
      // claim existed, the run went ahead and could double-apply its writes.
      expect(claimAutomation(db, id, new Date().toISOString())).toBe(true);

      const outcome = await executeAutomation(db, id, { trigger: "manual" });

      expect(outcome.status).toBe("skipped");
      expect(outcome.message).toMatch(/already in progress/);
      expect(listAutomationRuns(db, { automationId: id })).toHaveLength(0);

      // Once released, the same call runs normally.
      releaseAutomationClaim(db, id);
      expect((await executeAutomation(db, id, { trigger: "manual" })).status).toBe("succeeded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("takes over a claim left behind by a process that died mid-run", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(testJobType());
      const id = definition(db);

      // A claim from long ago: nothing is holding it, and the automation must
      // not stay blocked forever.
      claimAutomation(db, id, "2026-08-01T00:00:00.000Z");

      expect((await executeAutomation(db, id, { trigger: "manual" })).status).toBe("succeeded");
      expect(getAutomation(db, id)?.runningSince).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a revealed secret out of the pause reason as well as the log", async () => {
    const { root, db } = tempDb();
    process.env.SYNC_VAULT_KEY = VAULT_KEY;
    try {
      upsertSyncCredential(db, {
        connectionFingerprint: "server-1",
        mode: "http-api",
        baseUrl: "https://budget.example.com",
        budgetSyncId: "budget-1",
        secret: { apiKey: "super-secret-api-key-value" },
      });

      registerAutomationJobType(
        testJobType({
          async run(ctx: AutomationRunContext<TestConfig>): Promise<never> {
            if (ctx.credentials.status !== "resolved") throw new Error("expected credentials");
            const secret = ctx.credentials.reveal();
            throw new Error(`401 rejected key ${secret.apiKey}`);
          },
        })
      );
      const id = definition(db, {
        credentialRef: "server-1",
        failurePolicy: { pauseAfterConsecutiveFailures: 1 },
      });

      await executeAutomation(db, id);

      const paused = getAutomation(db, id);
      expect(paused?.autoPausedAt).not.toBeNull();
      // The pause reason is shown in the UI and returned by the health route.
      expect(paused?.autoPauseReason).not.toContain("super-secret-api-key-value");
      expect(paused?.autoPauseReason).toContain("[redacted]");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not fail a good run because its message was long", async () => {
    const { root, db } = tempDb();
    try {
      const longMessage = "provider said: ".padEnd(2000, "x");
      registerAutomationJobType(
        testJobType({
          summarize(): AutomationRunRollup {
            return { outcome: "ok", itemCount: 1, message: longMessage };
          },
        })
      );
      const id = definition(db);

      const outcome = await executeAutomation(db, id);

      // Previously the over-length message threw inside finalize, the catch
      // re-finalized the run as failed, and the failure streak advanced.
      expect(outcome.status).toBe("succeeded");
      const [run] = listAutomationRuns(db, { automationId: id });
      expect(run.status).toBe("succeeded");
      expect(run.rollup?.message?.length).toBe(500);
      expect(getAutomation(db, id)?.consecutiveFailures).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("holds a failing automation back for its backoff before selecting it again", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          async run(): Promise<never> {
            throw new Error("down");
          },
        })
      );
      const nowMs = Date.parse("2026-08-25T10:00:00Z");
      const id = definition(db, { intervalMinutes: 15, failurePolicy: { backoffMinutes: 30 } });

      await executeAutomation(db, id, { nowMs });

      // The 15-minute schedule alone would make it due at 10:15.
      expect(selectDueAutomations(db, nowMs + 16 * 60_000).map((d) => d.id)).not.toContain(id);
      expect(selectDueAutomations(db, nowMs + 31 * 60_000).map((d) => d.id)).toContain(id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not count a cancelled run against the failure streak", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          async run(ctx: AutomationRunContext<TestConfig>): Promise<{ ok: boolean }> {
            cancelAutomation(ctx.definition.id);
            return { ok: true };
          },
        })
      );
      const id = definition(db, { failurePolicy: { pauseAfterConsecutiveFailures: 2 } });

      await executeAutomation(db, id, { trigger: "manual" });
      await executeAutomation(db, id, { trigger: "manual" });

      // Stopping a run is the user's decision, not a fault: it must not pause
      // the automation with a message about consecutive failures.
      const after = getAutomation(db, id);
      expect(after?.consecutiveFailures).toBe(0);
      expect(after?.enabled).toBe(true);
      expect(after?.autoPausedAt).toBeNull();
      expect(listAutomationRuns(db, { automationId: id })[0].status).toBe("cancelled");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("frees the claim and the lock when the run row cannot be opened", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(testJobType());
      const id = definition(db);

      // An invalid attempt makes `createAutomationRun` throw — standing in for
      // any write failure between taking the claim and entering the try block.
      const failed = await executeAutomation(db, id, { attempt: 0 });
      expect(failed.status).toBe("skipped");

      // Neither lock may be left behind: the in-memory one would strand the
      // automation as "already in progress" until the process restarted.
      expect(getAutomation(db, id)?.runningSince).toBeNull();
      expect(isAutomationRunning(id)).toBe(false);
      expect((await executeAutomation(db, id)).status).toBe("succeeded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("redacts a secret-shaped value the job never revealed", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          async run(): Promise<never> {
            // No credential was revealed, so there is no known secret to match:
            // only pattern redaction can catch this.
            throw new Error("POST failed: apiKey=abcd1234efgh5678 rejected");
          },
        })
      );
      const id = definition(db);

      await executeAutomation(db, id);

      const [run] = listAutomationRuns(db, { automationId: id });
      expect(JSON.stringify(run)).not.toContain("abcd1234efgh5678");
      expect(String(run.error?.data.message)).toContain("[redacted]");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets a job type pick up work enrolled since the last tick", async () => {
    const { root, db } = tempDb();
    try {
      let created = false;
      registerAutomationJobType(
        testJobType({
          reconcile: (database) => {
            // Stands in for a sync flow switched to unattended while the server
            // was already running: without a per-tick reconcile it would not
            // exist as an automation until the next restart.
            if (created) return;
            createAutomation(database, {
              type: "test-job",
              name: "Enrolled after boot",
              scheduleKind: "interval",
              intervalMinutes: 30,
              targetRef: { version: 1, data: {} },
              config: { version: 1, data: { label: "late" } },
            });
            created = true;
          },
        })
      );

      const summary = await runEngineTick(db, { nowMs: Date.parse("2026-08-26T10:00:00Z") });

      expect(listAutomations(db)).toHaveLength(1);
      // And it is not merely registered: it ran on the very same tick.
      expect(summary.ran).toHaveLength(1);
      expect(summary.ran[0].status).toBe("succeeded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps running automations when a job type's reconcile throws", async () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(
        testJobType({
          reconcile: () => {
            throw new Error("reconcile exploded");
          },
        })
      );
      const id = definition(db);

      const summary = await runEngineTick(db, { nowMs: Date.parse("2026-08-26T10:00:00Z") });

      // A reconciliation problem is not a reason to stop work that is already
      // configured and due.
      expect(summary.ran).toHaveLength(1);
      expect(listAutomationRuns(db, { automationId: id })).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers a second real job type without the engine knowing anything about it", async () => {
    const { root, db } = tempDb();
    try {
      // The claim the whole engine exists to support, tested with the real
      // second type rather than a stand-in: registering it touches no engine
      // file, and the engine runs it without understanding what a bank is.
      registerBudgetFileSyncJobType();
      registerBankSyncJobType();

      const id = createAutomation(db, {
        type: "bank-sync",
        name: "Pull from banks",
        scheduleKind: "cron",
        cronExpression: "0 6 * * *",
        timezone: "UTC",
        targetRef: { version: 1, data: {} },
        // The vault reference the engine checks, and the same fingerprint in
        // the type's own config: the engine fails closed on `credentialRef`
        // without knowing what the config means.
        credentialRef: "srv-1",
        config: { version: 1, data: { connectionFingerprint: "srv-1" } },
      }).id;

      // No vault credential exists, so the engine fails closed — which is
      // itself the engine treating an unfamiliar type exactly like a familiar
      // one, with no branch anywhere that names "bank-sync".
      const outcome = await executeAutomation(db, id, { trigger: "manual" });

      expect(outcome.status).toBe("skipped");
      expect(getAutomation(db, id)?.autoPauseReason).toMatch(/vault is disabled|stored credential/);
    } finally {
      __resetBudgetFileSyncRegistrationForTests();
      __resetBankSyncRegistrationForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps pause state and failure counts across a restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "actual-bench-engine-restart-"));
    const path = join(root, "metadata.sqlite");
    try {
      registerAutomationJobType(
        testJobType({
          async run(): Promise<never> {
            throw new Error("broken");
          },
        })
      );

      const db = getAppDb(path);
      const id = definition(db, { failurePolicy: { pauseAfterConsecutiveFailures: 2 } });
      await executeAutomation(db, id);
      await executeAutomation(db, id);

      // Restart: new process state, same database file.
      __resetEngineStateForTests();
      resetAppDbForTests();
      const reopened = getAppDb(path);

      const after = getAutomation(reopened, id);
      expect(after?.enabled).toBe(false);
      expect(after?.autoPauseReason).toMatch(/consecutive failures/);
      // And it stays out of the due set rather than re-arming itself.
      expect(selectDueAutomations(reopened, Date.now())).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

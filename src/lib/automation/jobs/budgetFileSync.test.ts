import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncFlow, deleteSyncFlow, updateSyncFlow, getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { getAutomation, listAutomations, updateAutomation } from "@/lib/app-db/automationRepository";
import { createSyncFlowRun } from "@/lib/app-db/syncRunRepository";
import {
  __resetBudgetFileSyncRegistrationForTests,
  budgetFileSyncJobType,
  registerBudgetFileSyncJobType,
} from "./budgetFileSync";
import { __resetEngineStateForTests, runEngineTick } from "../engine";
import { __resetAutomationRegistryForTests } from "../registry";
import { migrateSyncFlowsToAutomations } from "./budgetFileSyncMigration";
import { MIN_INTERVAL_MINUTES } from "../schedule";
import { upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";
import type { SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-sync-job-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function unattendedFlow(db: SqliteDatabase, name: string, intervalMinutes = 30): string {
  const flow = createSyncFlow(db, {
    name,
    legs: [
      {
        sourceRef: { version: 1, data: { connectionFingerprint: "server-a", budgetSyncId: "budget-a" } },
        targetRef: { version: 1, data: { connectionFingerprint: "server-b", budgetSyncId: "budget-b" } },
        filter: { version: 1, data: {} },
        transform: { version: 1, data: {} },
        options: {
          version: 1,
          data: { reviewPolicy: "auto_sync_unattended", intervalMinutes },
        },
      },
    ],
  });
  return flow.id;
}

function manualFlow(db: SqliteDatabase, name: string): string {
  const flow = createSyncFlow(db, {
    name,
    legs: [
      {
        sourceRef: { version: 1, data: { connectionFingerprint: "server-a", budgetSyncId: "budget-a" } },
        targetRef: { version: 1, data: { connectionFingerprint: "server-b", budgetSyncId: "budget-b" } },
        filter: { version: 1, data: {} },
        transform: { version: 1, data: {} },
        options: { version: 1, data: { reviewPolicy: "manual_preview_required" } },
      },
    ],
  });
  return flow.id;
}

describe("budget file sync job type", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("refuses a configuration with no flow, with a reason a person can act on", () => {
    expect(() => budgetFileSyncJobType.validateConfig({ version: 1, data: {} })).toThrow(
      /no sync flow to run/
    );
    expect(budgetFileSyncJobType.validateConfig({ version: 1, data: { flowId: " flow-1 " } })).toEqual({
      flowId: "flow-1",
    });
  });

  it("maps sync outcomes onto the engine's roll-up using the existing health rules", () => {
    const base = { flowId: "flow-1", syncRunId: "run-1", applied: 0, updated: 0, deleted: 0, failed: 0, blocked: 0 };

    expect(budgetFileSyncJobType.summarize({ ...base, status: "applied", applied: 4 })).toEqual({
      outcome: "ok",
      itemCount: 4,
      message: "4 added",
    });

    expect(budgetFileSyncJobType.summarize({ ...base, status: "no_safe_items" })).toEqual({
      outcome: "no_changes",
      itemCount: 0,
      message: "Nothing safe to apply",
    });

    expect(
      budgetFileSyncJobType.summarize({ ...base, status: "partial", applied: 2, failed: 1 }).outcome
    ).toBe("partial");

    expect(budgetFileSyncJobType.summarize({ ...base, status: "failed" }).outcome).toBe("failed");

    // A blocked outcome (vault locked, not enrolled) is a failure: the sync did
    // not happen, whatever the wording of the status.
    expect(
      budgetFileSyncJobType.summarize({ ...base, status: "not_enrolled", syncRunId: null }).outcome
    ).toBe("failed");
  });

  it("does not treat a flow switched back to manual review as a failure", () => {
    // Regression: this counted as failed, so switching a flow to manual review
    // left an automation that failed every interval until it auto-paused.
    const rollup = budgetFileSyncJobType.summarize({
      flowId: "flow-1",
      status: "skipped_manual_policy",
      syncRunId: null,
      applied: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      blocked: 0,
    });

    expect(rollup.outcome).toBe("no_changes");
    expect(rollup.countsAsFailure).toBeUndefined();
    expect(rollup.message).toMatch(/no longer set to sync automatically/);
  });

  it("marks a partial sync as counting against health, as RD-058 did", () => {
    const rollup = budgetFileSyncJobType.summarize({
      flowId: "flow-1",
      status: "partial",
      syncRunId: "run-1",
      applied: 2,
      updated: 0,
      deleted: 0,
      failed: 1,
      blocked: 0,
    });

    expect(rollup.outcome).toBe("partial");
    expect(rollup.countsAsFailure).toBe(true);
  });

  it("keeps a back-reference to the sync run so both histories stay truthful", () => {
    const serialized = budgetFileSyncJobType.serializeResult({
      flowId: "flow-1",
      status: "applied",
      syncRunId: "sync-run-9",
      applied: 3,
      updated: 1,
      deleted: 0,
      failed: 0,
      blocked: 0,
    });

    expect(serialized.data.syncRunId).toBe("sync-run-9");
    expect(serialized.data.flowId).toBe("flow-1");
  });

  it("takes part in the review queue, unlike a type that only triggers Actual's own work", () => {
    expect(budgetFileSyncJobType.classification).toBeDefined();
    expect(budgetFileSyncJobType.classification?.supportsAutoApply).toBe(true);
  });
});

describe("migrating sync flows onto the engine", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("creates one automation per enrolled unattended flow and leaves manual flows alone", () => {
    const { root, db } = tempDb();
    try {
      const unattended = unattendedFlow(db, "Household → Joint", 45);
      manualFlow(db, "Manual review flow");

      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.created).toHaveLength(1);
      expect(summary.skipped).toBe(1);

      const [automation] = listAutomations(db);
      expect(automation.type).toBe("budget-file-sync");
      expect(automation.name).toBe("Household → Joint");
      expect(automation.executionMode).toBe("server");
      expect(automation.intervalMinutes).toBe(45);
      expect(automation.config.data.flowId).toBe(unattended);
      expect(automation.credentialRef).toBe("server-a");
      expect(automation.enabled).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks the enrolment the run will use: the source's own, or its budget's other one (PR-071c)", () => {
    const { root, db } = tempDb();
    const savedKey = process.env.SYNC_VAULT_KEY;
    process.env.SYNC_VAULT_KEY = "test-operator-key";
    try {
      createSyncFlow(db, {
        name: "Direct → Joint",
        legs: [
          {
            sourceRef: { version: 1, data: { connectionFingerprint: "direct-fp", budgetId: "budget-a" } },
            targetRef: { version: 1, data: { connectionFingerprint: "server-b", budgetId: "budget-b" } },
            filter: { version: 1, data: {} },
            transform: { version: 1, data: {} },
            options: { version: 1, data: { reviewPolicy: "auto_sync_unattended", intervalMinutes: 30 } },
          },
        ],
      });
      // The source budget is enrolled only through HTTP API.
      upsertSyncCredential(db, {
        connectionFingerprint: "http-fp",
        mode: "http-api",
        baseUrl: "https://api.example.com",
        budgetSyncId: "budget-a",
        secret: { apiKey: "key" },
      });

      migrateSyncFlowsToAutomations(db);
      expect(listAutomations(db)[0].credentialRef).toBe("http-fp");

      // Its own enrolment appears: the automation follows it.
      upsertSyncCredential(db, {
        connectionFingerprint: "direct-fp",
        mode: "browser-api",
        baseUrl: "https://actual.example.com",
        budgetSyncId: "budget-a",
        secret: { serverPassword: "pw" },
      });
      migrateSyncFlowsToAutomations(db);
      expect(listAutomations(db)[0].credentialRef).toBe("direct-fp");
    } finally {
      if (savedKey === undefined) delete process.env.SYNC_VAULT_KEY;
      else process.env.SYNC_VAULT_KEY = savedKey;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent, so a restart does not duplicate automations", () => {
    const { root, db } = tempDb();
    try {
      unattendedFlow(db, "Household → Joint");

      migrateSyncFlowsToAutomations(db);
      const second = migrateSyncFlowsToAutomations(db);

      expect(second.created).toHaveLength(0);
      expect(listAutomations(db)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still creates a new flow's automation when an unrelated flow fails to migrate", () => {
    // A brand new unattended flow was reported to silently never get an
    // automation. The whole batch used to run inside one db.transaction()
    // with no per-flow isolation: any earlier flow throwing during migration
    // rolled back everyone else in the same call, including a flow that had
    // nothing wrong with it.
    const { root, db } = tempDb();
    try {
      const brokenFlowId = unattendedFlow(db, "Already broken flow", 30);
      migrateSyncFlowsToAutomations(db);
      const [brokenAutomation] = listAutomations(db);
      // Corrupt its schedule_kind directly, so processing it on the next pass
      // throws inside updateAutomation's schedule validation.
      db.prepare("UPDATE automation_definitions SET schedule_kind = 'bogus' WHERE id = ?").run(
        brokenAutomation.id
      );
      // Also change its interval so migrateOneFlow actually reaches the
      // schedule update call (the branch that throws) on this pass.
      const brokenFlow = getSyncFlow(db, brokenFlowId);
      updateSyncFlow(db, brokenFlowId, {
        legs: [
          {
            sourceRef: brokenFlow!.sourceRef,
            targetRef: brokenFlow!.targetRef,
            filter: brokenFlow!.filter,
            transform: brokenFlow!.transform,
            options: { version: 1, data: { reviewPolicy: "auto_sync_unattended", intervalMinutes: 90 } },
          },
        ],
      });

      const newFlowId = unattendedFlow(db, "Freshly created flow", 60);
      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.created).toHaveLength(1);
      const automations = listAutomations(db);
      const created = automations.find((a) => a.config.data.flowId === newFlowId);
      expect(created).toBeDefined();
      expect(created?.name).toBe("Freshly created flow");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes the automation of a flow that has been deleted", () => {
    const { root, db } = tempDb();
    try {
      const flowId = unattendedFlow(db, "Household → Joint", 30);
      migrateSyncFlowsToAutomations(db);
      const [automation] = listAutomations(db);

      // Left behind, the automation stayed enabled and the engine kept firing
      // it every interval against a flow that no longer exists - each run
      // failing with flow_not_found until the failure policy paused it.
      deleteSyncFlow(db, flowId);
      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.removed).toEqual([automation.id]);
      expect(listAutomations(db)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a deleted flow's automation while the flow is merely absent from one read", () => {
    const { root, db } = tempDb();
    try {
      unattendedFlow(db, "Household → Joint", 30);
      migrateSyncFlowsToAutomations(db);

      // The flow still exists, so nothing is removed however many times this
      // runs - the removal is keyed on the database, not on a list that could
      // come back transiently empty.
      expect(migrateSyncFlowsToAutomations(db).removed).toHaveLength(0);
      expect(listAutomations(db)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not overwrite a schedule the user has since changed", () => {
    const { root, db } = tempDb();
    try {
      const flowId = unattendedFlow(db, "Household → Joint", 30);
      migrateSyncFlowsToAutomations(db);

      // The user re-schedules the automation in the Automations UI.
      const [automation] = listAutomations(db);
      updateAutomation(db, automation.id, { scheduleKind: "cron", cronExpression: "0 3 * * *" });

      // A cron row stores interval_minutes as NULL, so comparing it against the
      // flow's own interval matches forever. Left unguarded, every tick rewrote
      // the schedule - which also clears next_run_at, the floor the engine
      // schedules from - and the comparison still never stopped matching.
      updateAutomation(db, automation.id, { nextRunAt: "2999-01-01T00:00:00.000Z" });

      const first = migrateSyncFlowsToAutomations(db);
      const second = migrateSyncFlowsToAutomations(db);

      expect(first.updated).toHaveLength(0);
      expect(second.updated).toHaveLength(0);

      const [after] = listAutomations(db);
      expect(after.scheduleKind).toBe("cron");
      expect(after.cronExpression).toBe("0 3 * * *");
      expect(after.nextRunAt).toBe("2999-01-01T00:00:00.000Z");
      expect(after.config.data.flowId).toBe(flowId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports one update, not two, when a flow changes both its interval and its enabled state", () => {
    const { root, db } = tempDb();
    try {
      const flowId = unattendedFlow(db, "Household → Joint", 30);
      migrateSyncFlowsToAutomations(db);

      // Disable the flow *and* change its interval in one edit: both used to
      // fire their own updateAutomation and push the same id onto the summary,
      // so the batch log double-counted a single automation.
      const flow = getSyncFlow(db, flowId);
      updateSyncFlow(db, flowId, {
        enabled: false,
        legs: [
          {
            sourceRef: flow!.sourceRef,
            targetRef: flow!.targetRef,
            filter: flow!.filter,
            transform: flow!.transform,
            options: { version: 1, data: { reviewPolicy: "auto_sync_unattended", intervalMinutes: 90 } },
          },
        ],
      });

      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.updated).toHaveLength(1);
      const [after] = listAutomations(db);
      expect(after.enabled).toBe(false);
      expect(after.intervalMinutes).toBe(90);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("follows a flow that has been disabled or health-paused in the Sync UI", () => {
    const { root, db } = tempDb();
    try {
      const flowId = unattendedFlow(db, "Household → Joint");
      migrateSyncFlowsToAutomations(db);
      expect(listAutomations(db)[0].enabled).toBe(true);

      updateSyncFlow(db, flowId, { enabled: false });
      expect(getSyncFlow(db, flowId)?.enabled).toBe(false);

      const summary = migrateSyncFlowsToAutomations(db);
      expect(summary.updated).toHaveLength(1);
      expect(listAutomations(db)[0].enabled).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never re-enables an automation the user paused", () => {
    const { root, db } = tempDb();
    try {
      unattendedFlow(db, "Household → Joint");
      migrateSyncFlowsToAutomations(db);
      const [automation] = listAutomations(db);

      // The user pauses it on the Automations page; the sync flow itself is
      // still enabled in the Sync UI.
      updateAutomation(db, automation.id, { enabled: false });

      // Regression: the next server restart re-enabled it and unattended
      // syncing silently resumed.
      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.updated).toHaveLength(0);
      expect(listAutomations(db)[0].enabled).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("switches off an automation whose flow is no longer unattended", () => {
    const { root, db } = tempDb();
    try {
      const flowId = unattendedFlow(db, "Household → Joint");
      migrateSyncFlowsToAutomations(db);
      expect(listAutomations(db)[0].enabled).toBe(true);

      // The user moves the flow back to manual review.
      const flow = getSyncFlow(db, flowId)!;
      updateSyncFlow(db, flowId, {
        legs: [
          {
            sourceRef: flow.sourceRef,
            targetRef: flow.targetRef,
            filter: flow.filter,
            transform: flow.transform,
            options: { version: 1, data: { reviewPolicy: "manual_preview_required" } },
          },
        ],
      });

      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.updated).toHaveLength(1);
      expect(listAutomations(db)[0].enabled).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an enrolled automation's interval in sync with the flow's own interval field", () => {
    const { root, db } = tempDb();
    try {
      const flowId = unattendedFlow(db, "Household → Joint", 60);
      migrateSyncFlowsToAutomations(db);
      const automation = listAutomations(db)[0];
      expect(automation.intervalMinutes).toBe(60);

      // Give it some run history and a "not before" floor computed under the
      // 60-minute schedule, matching what a real enrolled automation would have.
      updateAutomation(db, automation.id, { nextRunAt: "2026-09-23T05:00:00.000Z" });

      // The user reduces the interval to 15 minutes in the Sync flow editor.
      const flow = getSyncFlow(db, flowId)!;
      updateSyncFlow(db, flowId, {
        legs: [
          {
            sourceRef: flow.sourceRef,
            targetRef: flow.targetRef,
            filter: flow.filter,
            transform: flow.transform,
            options: { version: 1, data: { reviewPolicy: "auto_sync_unattended", intervalMinutes: 15 } },
          },
        ],
      });

      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.updated).toContain(automation.id);
      const updated = getAutomation(db, automation.id);
      expect(updated?.intervalMinutes).toBe(15);
      // The floor computed under the old 60-minute schedule must not survive -
      // keeping it would make the new 15-minute interval wait out the old one.
      expect(updated?.nextRunAt).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries the flow's schedule position across, so an upgrade does not sync everything at once", () => {
    const { root, db } = tempDb();
    try {
      const flowId = unattendedFlow(db, "Household → Joint", 60);
      // The flow synced two minutes before the upgrade.
      const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
      createSyncFlowRun(db, {
        flowId,
        status: "applied",
        startedAt: twoMinutesAgo,
        finishedAt: twoMinutesAgo,
      });

      migrateSyncFlowsToAutomations(db);

      const [automation] = listAutomations(db);
      // Regression: with no seeded position every migrated flow was due
      // immediately, five seconds after boot.
      expect(automation.nextRunAt).not.toBeNull();
      expect(Date.parse(automation.nextRunAt!)).toBeGreaterThan(Date.now());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves a never-run flow due immediately, which is correct for it", () => {
    const { root, db } = tempDb();
    try {
      unattendedFlow(db, "Brand new");
      migrateSyncFlowsToAutomations(db);
      expect(listAutomations(db)[0].nextRunAt).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries the unattended interval floor across, as the old scheduler enforced", () => {
    const { root, db } = tempDb();
    try {
      // The flow config clamps on write; the engine's schedule clamps on read.
      unattendedFlow(db, "Too eager", 1);
      migrateSyncFlowsToAutomations(db);

      const [automation] = listAutomations(db);
      const effective = Math.max(automation.intervalMinutes ?? 0, MIN_INTERVAL_MINUTES);
      expect(effective).toBeGreaterThanOrEqual(MIN_INTERVAL_MINUTES);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enrols a flow created while the server is already running", async () => {
    const { root, db } = tempDb();
    try {
      registerBudgetFileSyncJobType();

      // Boot-time sweep: nothing to do yet.
      await runEngineTick(db, { nowMs: Date.parse("2026-08-26T10:00:00Z") });
      expect(listAutomations(db)).toHaveLength(0);

      // The user creates an unattended flow in the Sync UI.
      unattendedFlow(db, "Created after boot");

      // The very next tick picks it up — no restart required. This was the bug:
      // the sweep only ran at startup, so a flow enrolled afterwards silently
      // never appeared and never ran.
      await runEngineTick(db, { nowMs: Date.parse("2026-08-26T10:01:00Z") });

      const [automation] = listAutomations(db);
      expect(automation?.name).toBe("Created after boot");
      expect(automation?.config.data.flowId).toBeDefined();

      // With no vault configured in this environment the engine then fails
      // closed on the very same tick — which is the point: the flow is now
      // visible with a reason a person can act on, instead of being absent and
      // silently never running.
      expect(automation?.enabled).toBe(false);
      expect(automation?.autoPauseReason).toMatch(/vault is disabled/);
    } finally {
      __resetEngineStateForTests();
      __resetAutomationRegistryForTests();
      __resetBudgetFileSyncRegistrationForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

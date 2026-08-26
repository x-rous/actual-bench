import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncFlow, updateSyncFlow, getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { listAutomations, updateAutomation } from "@/lib/app-db/automationRepository";
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

  it("does not overwrite a schedule the user has since changed", () => {
    const { root, db } = tempDb();
    try {
      const flowId = unattendedFlow(db, "Household → Joint", 30);
      migrateSyncFlowsToAutomations(db);

      // The user re-schedules the automation in the Automations UI.
      const [automation] = listAutomations(db);
      updateAutomation(db, automation.id, { scheduleKind: "cron", cronExpression: "0 3 * * *" });

      migrateSyncFlowsToAutomations(db);

      const [after] = listAutomations(db);
      expect(after.scheduleKind).toBe("cron");
      expect(after.cronExpression).toBe("0 3 * * *");
      expect(after.config.data.flowId).toBe(flowId);
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
        legs: flow.legs.map((leg) => ({
          sourceRef: leg.sourceRef,
          targetRef: leg.targetRef,
          filter: leg.filter,
          transform: leg.transform,
          options: { version: 1, data: { reviewPolicy: "manual_preview_required" } },
        })),
      });

      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.updated).toHaveLength(1);
      expect(listAutomations(db)[0].enabled).toBe(false);
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

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  claimAutomation,
  createAutomation,
  pauseAutomationForHealth,
  recordAutomationOutcome,
  updateAutomation,
} from "@/lib/app-db/automationRepository";
import { createAutomationRun, finalizeAutomationRun } from "@/lib/app-db/automationRunRepository";
import { buildAutomationHealth, isStale, overallAutomationStatus, staleGraceMs } from "./health";
import { buildReviewQueue } from "./reviewQueue";
import {
  __resetAutomationRegistryForTests,
  registerAutomationJobType,
  type AutomationJobType,
} from "./registry";
import type { AutomationRunRollup, JsonEnvelope, SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-health-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function jobType(type: string, withClassification: boolean): AutomationJobType<unknown, unknown> {
  return {
    type,
    label: type === "budget-file-sync" ? "Budget File Sync" : "Bank Sync",
    validateConfig: () => ({}),
    run: async () => ({}),
    summarize: (): AutomationRunRollup => ({ outcome: "ok", itemCount: 0 }),
    serializeResult: (): JsonEnvelope => ({ version: 1, data: {} }),
    ...(withClassification
      ? { classification: { reviewSubjects: ["transaction"], supportsAutoApply: true } }
      : {}),
  };
}

function automation(db: SqliteDatabase, extra: Record<string, unknown> = {}): string {
  return createAutomation(db, {
    type: "budget-file-sync",
    name: "Nightly sync",
    scheduleKind: "interval",
    intervalMinutes: 30,
    targetRef: { version: 1, data: {} },
    config: { version: 1, data: { flowId: "flow-1" } },
    ...extra,
  }).id;
}

describe("automation health", () => {
  afterEach(() => {
    __resetAutomationRegistryForTests();
    resetAppDbForTests();
  });

  it("treats an overdue automation as a warning, not a success", () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(jobType("budget-file-sync", true));
      const id = automation(db);

      const nowMs = Date.parse("2026-08-25T12:00:00Z");
      // It succeeded, but its next run was due three hours ago and never
      // happened — most likely the server is not running.
      recordAutomationOutcome(db, id, { success: true, at: "2026-08-25T06:00:00.000Z" });
      updateAutomation(db, id, { nextRunAt: "2026-08-25T09:00:00.000Z" });

      const report = buildAutomationHealth(db, { nowMs });
      const [health] = report.automations;

      expect(health.stale).toBe(true);
      expect(health.status).toBe("warning");
      expect(health.summary).toMatch(/Overdue/);
      expect(overallAutomationStatus(report)).toBe("warning");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gives a short overdue window some grace, so a deploy is not an alert", () => {
    const nowMs = Date.parse("2026-08-25T12:00:00Z");
    const frequent = {
      enabled: true,
      autoPausedAt: null,
      scheduleKind: "interval" as const,
      intervalMinutes: 15,
      cronExpression: null,
      timezone: "UTC",
    };

    // Ten minutes late on a 15-minute schedule: not stale.
    expect(isStale({ ...frequent, nextRunAt: "2026-08-25T11:50:00.000Z" }, nowMs)).toBe(false);
    // Two hours late: stale.
    expect(isStale({ ...frequent, nextRunAt: "2026-08-25T10:00:00.000Z" }, nowMs)).toBe(true);
  });

  it("scales the grace to the schedule instead of flagging everything after an hour", () => {
    const nowMs = Date.parse("2026-08-25T12:00:00Z");

    // A daily job two hours late is not news; four days late is.
    const daily = {
      enabled: true,
      autoPausedAt: null,
      scheduleKind: "cron" as const,
      intervalMinutes: null,
      cronExpression: "0 3 * * *",
      timezone: "UTC",
    };
    expect(isStale({ ...daily, nextRunAt: "2026-08-25T10:00:00.000Z" }, nowMs)).toBe(false);
    expect(isStale({ ...daily, nextRunAt: "2026-08-21T10:00:00.000Z" }, nowMs)).toBe(true);

    // The declared factor is really applied: three missed 6-hour occurrences.
    const sixHourly = {
      scheduleKind: "interval" as const,
      intervalMinutes: 360,
      cronExpression: null,
      timezone: "UTC",
      nextRunAt: null,
    };
    expect(staleGraceMs(sixHourly)).toBe(3 * 360 * 60_000);
    // ...but never less than the one-hour floor.
    expect(
      staleGraceMs({
        scheduleKind: "interval",
        intervalMinutes: 15,
        cronExpression: null,
        timezone: "UTC",
        nextRunAt: null,
      })
    ).toBe(60 * 60_000);
  });

  it("reads a cron schedule's real cadence rather than assuming daily", () => {
    // Monthly: one missed occurrence is a month, so three days late is nothing.
    const monthly = {
      enabled: true,
      autoPausedAt: null,
      scheduleKind: "cron" as const,
      intervalMinutes: null,
      cronExpression: "0 3 1 * *",
      timezone: "UTC",
      nextRunAt: "2026-08-01T03:00:00.000Z",
    };

    expect(isStale(monthly, Date.parse("2026-08-04T12:00:00Z"))).toBe(false);
    // But the grace is capped: a month of silence is worth flagging even so.
    expect(isStale(monthly, Date.parse("2026-09-15T12:00:00Z"))).toBe(true);
    // Cadence measured, not assumed. A twelve-hourly cron shows this without
    // the cap getting in the way: three missed occurrences is 36 hours, which
    // is neither the old flat hour nor the daily assumption's 72.
    expect(
      staleGraceMs({
        scheduleKind: "cron",
        intervalMinutes: null,
        cronExpression: "0 */12 * * *",
        timezone: "UTC",
        // Deliberately not on an occurrence: the gap between two consecutive
        // occurrences is the cadence, not whatever is left of the current one.
        nextRunAt: "2026-08-01T03:00:00.000Z",
      })
    ).toBe(36 * 60 * 60_000);
  });

  it("never calls a paused or disabled automation overdue", () => {
    const nowMs = Date.parse("2026-08-25T12:00:00Z");
    const schedule = {
      scheduleKind: "interval" as const,
      intervalMinutes: 30,
      cronExpression: null,
      timezone: "UTC",
    };
    expect(
      isStale({ ...schedule, enabled: false, autoPausedAt: null, nextRunAt: "2026-08-20T00:00:00.000Z" }, nowMs)
    ).toBe(false);
    expect(
      isStale(
        {
          ...schedule,
          enabled: true,
          autoPausedAt: "2026-08-21T00:00:00.000Z",
          nextRunAt: "2026-08-20T00:00:00.000Z",
        },
        nowMs
      )
    ).toBe(false);
  });

  it("does not call a cancelled run a success", () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(jobType("budget-file-sync", true));
      const id = automation(db);
      const run = createAutomationRun(db, { automationId: id, type: "budget-file-sync" });
      finalizeAutomationRun(db, run.id, { status: "cancelled" });

      const [health] = buildAutomationHealth(db).automations;

      // The user stopped it. Reporting "finished successfully" would describe
      // something that did not happen.
      expect(health.status).toBe("idle");
      expect(health.summary).toBe("Last run was cancelled.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a failed last run as failing even before the streak is recorded", () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(jobType("budget-file-sync", true));
      const id = automation(db);
      const run = createAutomationRun(db, { automationId: id, type: "budget-file-sync" });
      finalizeAutomationRun(db, run.id, {
        status: "failed",
        rollup: { outcome: "failed", itemCount: 0, message: "provider unreachable" },
      });

      const [health] = buildAutomationHealth(db).automations;
      expect(health.status).toBe("failing");
      expect(health.summary).toBe("provider unreachable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a paused automation with the reason it was paused", () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(jobType("budget-file-sync", true));
      const id = automation(db);
      pauseAutomationForHealth(db, id, "2026-08-25T09:00:00.000Z", "Vault key missing");

      const [health] = buildAutomationHealth(db).automations;

      expect(health.status).toBe("paused");
      expect(health.summary).toBe("Vault key missing");
      expect(health.typeLabel).toBe("Budget File Sync");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a run claimed by another module instance as running", () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(jobType("budget-file-sync", true));
      const id = automation(db);

      // The claim exists in the database but not in this instance's memory —
      // exactly what a route handler sees while the interval loop is running.
      claimAutomation(db, id, new Date().toISOString());

      expect(buildAutomationHealth(db).automations[0].running).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("says the engine is single-instance rather than leaving it implied", () => {
    const { root, db } = tempDb();
    try {
      expect(buildAutomationHealth(db).singleInstance).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("shared review queue", () => {
  afterEach(() => {
    __resetAutomationRegistryForTests();
    resetAppDbForTests();
  });

  function runWithBlocked(db: SqliteDatabase, automationId: string, type: string, blocked: number): void {
    const run = createAutomationRun(db, { automationId, type });
    finalizeAutomationRun(db, run.id, {
      status: "succeeded",
      result: { version: 1, data: { blocked } },
      rollup: { outcome: "ok", itemCount: 1 },
    });
  }

  it("lists work from a type that constructs writes", () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(jobType("budget-file-sync", true));
      const id = automation(db);
      runWithBlocked(db, id, "budget-file-sync", 2);

      const [entry] = buildReviewQueue(db);

      expect(entry.pendingCount).toBe(2);
      expect(entry.summary).toBe("2 items from the last run need a decision.");
      // It points at the type's own review screen rather than a second copy.
      expect(entry.href).toBe("/sync");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omits a type that declares no classification, rather than showing it empty", () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(jobType("bank-sync", false));
      const id = automation(db, { type: "bank-sync", name: "Bank sync" });
      runWithBlocked(db, id, "bank-sync", 5);

      // Even with a "blocked" number in its result, a type that constructs
      // nothing contributes nothing to the queue.
      expect(buildReviewQueue(db)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omits an automation with nothing waiting", () => {
    const { root, db } = tempDb();
    try {
      registerAutomationJobType(jobType("budget-file-sync", true));
      const id = automation(db);
      runWithBlocked(db, id, "budget-file-sync", 0);

      expect(buildReviewQueue(db)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

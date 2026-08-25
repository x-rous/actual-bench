import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { AppDbValidationError } from "./errors";
import { createAutomation, deleteAutomation } from "./automationRepository";
import {
  createAutomationRun,
  finalizeAutomationRun,
  getAutomationRun,
  listAutomationRuns,
  pruneAutomationRuns,
} from "./automationRunRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-automation-run-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function automation(db: SqliteDatabase, type = "budget-file-sync"): string {
  return createAutomation(db, {
    type,
    name: `${type} automation`,
    scheduleKind: "interval",
    intervalMinutes: 30,
    targetRef: { version: 1, data: {} },
    config: { version: 1, data: {} },
  }).id;
}

describe("automation run repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("opens a run as running and finalizes it with a type-owned result", () => {
    const { root, db } = tempDb();
    try {
      const automationId = automation(db);
      const run = createAutomationRun(db, { automationId, type: "budget-file-sync" });

      expect(run.status).toBe("running");
      expect(run.finishedAt).toBeNull();
      expect(run.attempt).toBe(1);
      expect(run.trigger).toBe("schedule");

      const finalized = finalizeAutomationRun(db, run.id, {
        status: "partial",
        result: { version: 1, data: { accounts: [{ id: "acct-1", status: "ok", newTransactions: 3 }] } },
        rollup: { outcome: "partial", itemCount: 1, message: "1 of 2 accounts synced" },
      });

      expect(finalized?.status).toBe("partial");
      expect(finalized?.finishedAt).not.toBeNull();
      expect(finalized?.result?.data.accounts).toEqual([
        { id: "acct-1", status: "ok", newTransactions: 3 },
      ]);
      expect(finalized?.rollup).toEqual({
        outcome: "partial",
        itemCount: 1,
        message: "1 of 2 accounts synced",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores any job type's result shape without interpreting it", () => {
    const { root, db } = tempDb();
    try {
      const bankSyncId = automation(db, "bank-sync");
      const run = createAutomationRun(db, { automationId: bankSyncId, type: "bank-sync" });

      // Deliberately nothing like sync's discovered/applied/review vocabulary.
      finalizeAutomationRun(db, run.id, {
        status: "succeeded",
        result: {
          version: 1,
          data: { triggeredAccounts: 4, failedAccounts: [], observedNewRows: null },
        },
        rollup: { outcome: "ok", itemCount: 4 },
      });

      const stored = getAutomationRun(db, run.id);
      expect(stored?.result?.data).toEqual({
        triggeredAccounts: 4,
        failedAccounts: [],
        observedNewRows: null,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists runs newest first, optionally scoped to one automation", () => {
    const { root, db } = tempDb();
    try {
      const first = automation(db, "budget-file-sync");
      const second = automation(db, "bank-sync");

      createAutomationRun(db, { automationId: first, type: "budget-file-sync", startedAt: "2026-08-25T01:00:00.000Z" });
      createAutomationRun(db, { automationId: second, type: "bank-sync", startedAt: "2026-08-25T03:00:00.000Z" });
      createAutomationRun(db, { automationId: first, type: "budget-file-sync", startedAt: "2026-08-25T02:00:00.000Z" });

      expect(listAutomationRuns(db).map((run) => run.startedAt)).toEqual([
        "2026-08-25T03:00:00.000Z",
        "2026-08-25T02:00:00.000Z",
        "2026-08-25T01:00:00.000Z",
      ]);
      expect(listAutomationRuns(db, { automationId: second })).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a run readable after its automation is deleted", () => {
    const { root, db } = tempDb();
    try {
      const automationId = automation(db);
      const run = createAutomationRun(db, { automationId, type: "budget-file-sync" });
      finalizeAutomationRun(db, run.id, { status: "succeeded", rollup: { outcome: "ok", itemCount: 0 } });

      deleteAutomation(db, automationId);

      // The row cascades away with its definition; the type stays denormalized
      // on any run that outlives it (e.g. an orphaned run kept for history).
      expect(getAutomationRun(db, run.id)).toBeNull();

      const orphan = createAutomationRun(db, { automationId: null, type: "bank-sync" });
      expect(getAutomationRun(db, orphan.id)?.type).toBe("bank-sync");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prunes per automation, so a busy job cannot age out a quiet job's history", () => {
    const { root, db } = tempDb();
    try {
      const busy = automation(db, "budget-file-sync");
      const quiet = automation(db, "bank-sync");

      for (let i = 0; i < 6; i += 1) {
        createAutomationRun(db, {
          automationId: busy,
          type: "budget-file-sync",
          startedAt: `2026-08-25T0${i}:00:00.000Z`,
        });
      }
      createAutomationRun(db, {
        automationId: quiet,
        type: "bank-sync",
        startedAt: "2026-08-20T00:00:00.000Z",
      });

      const deleted = pruneAutomationRuns(db, 2);

      expect(deleted).toBe(4);
      expect(listAutomationRuns(db, { automationId: busy })).toHaveLength(2);
      // The quiet automation's single, much older run survives.
      expect(listAutomationRuns(db, { automationId: quiet })).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an invalid status, trigger, or roll-up", () => {
    const { root, db } = tempDb();
    try {
      const automationId = automation(db);
      expect(() =>
        createAutomationRun(db, { automationId, type: "budget-file-sync", status: "weird" as never })
      ).toThrow(AppDbValidationError);

      const run = createAutomationRun(db, { automationId, type: "budget-file-sync" });
      expect(() =>
        finalizeAutomationRun(db, run.id, {
          status: "succeeded",
          rollup: { outcome: "ok", itemCount: -1 },
        })
      ).toThrow(/itemCount must be a non-negative integer/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

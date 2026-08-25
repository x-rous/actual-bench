import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { AppDbValidationError } from "./errors";
import {
  DEFAULT_FAILURE_POLICY,
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  pauseAutomationForHealth,
  recordAutomationOutcome,
  resumeAutomation,
  updateAutomation,
} from "./automationRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-automation-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const baseInput = {
  type: "budget-file-sync",
  name: "Nightly household sync",
  scheduleKind: "interval" as const,
  intervalMinutes: 30,
  timezone: "Europe/Berlin",
  targetRef: { version: 1, data: { flowId: "flow-1" } },
  config: { version: 1, data: { reviewPolicy: "auto_sync_unattended" } },
};

describe("automation repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("creates, lists, updates and deletes automation definitions", () => {
    const { root, db } = tempDb();
    try {
      const created = createAutomation(db, baseInput);

      expect(created.type).toBe("budget-file-sync");
      expect(created.enabled).toBe(true);
      expect(created.executionMode).toBe("server");
      expect(created.intervalMinutes).toBe(30);
      expect(created.cronExpression).toBeNull();
      expect(created.timezone).toBe("Europe/Berlin");
      expect(created.failurePolicy).toEqual(DEFAULT_FAILURE_POLICY);
      expect(created.consecutiveFailures).toBe(0);

      expect(listAutomations(db)).toHaveLength(1);
      expect(listAutomations(db, { type: "bank-sync" })).toHaveLength(0);

      const updated = updateAutomation(db, created.id, { name: "Renamed", intervalMinutes: 90 });
      expect(updated?.name).toBe("Renamed");
      expect(updated?.intervalMinutes).toBe(90);

      expect(deleteAutomation(db, created.id)).toBe(true);
      expect(getAutomation(db, created.id)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores a cron schedule with its expression and no interval", () => {
    const { root, db } = tempDb();
    try {
      const created = createAutomation(db, {
        ...baseInput,
        scheduleKind: "cron",
        cronExpression: "0 6 * * *",
        intervalMinutes: undefined,
      });

      expect(created.scheduleKind).toBe("cron");
      expect(created.cronExpression).toBe("0 6 * * *");
      expect(created.intervalMinutes).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a schedule whose kind and fields disagree", () => {
    const { root, db } = tempDb();
    try {
      expect(() => createAutomation(db, { ...baseInput, intervalMinutes: undefined })).toThrow(
        AppDbValidationError
      );
      expect(() =>
        createAutomation(db, { ...baseInput, scheduleKind: "cron", cronExpression: undefined })
      ).toThrow(AppDbValidationError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an unknown time zone, since the scheduler could not resolve it", () => {
    const { root, db } = tempDb();
    try {
      expect(() => createAutomation(db, { ...baseInput, timezone: "Mars/Olympus" })).toThrow(
        /Unknown time zone/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to store a secret in config or target metadata", () => {
    const { root, db } = tempDb();
    try {
      expect(() =>
        createAutomation(db, {
          ...baseInput,
          config: { version: 1, data: { apiKey: "super-secret" } },
        })
      ).toThrow(/cannot store credential field/);

      expect(() =>
        createAutomation(db, {
          ...baseInput,
          targetRef: { version: 1, data: { server: { encryptionPassword: "hunter2" } } },
        })
      ).toThrow(/cannot store credential field/);

      // A vault *reference* is not a secret and is stored as-is.
      const created = createAutomation(db, { ...baseInput, credentialRef: "server-fingerprint-1" });
      expect(created.credentialRef).toBe("server-fingerprint-1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("counts consecutive failures and resets them on success", () => {
    const { root, db } = tempDb();
    try {
      const created = createAutomation(db, baseInput);

      recordAutomationOutcome(db, created.id, { success: false, at: "2026-08-25T01:00:00.000Z" });
      const afterTwo = recordAutomationOutcome(db, created.id, {
        success: false,
        at: "2026-08-25T02:00:00.000Z",
      });
      expect(afterTwo?.consecutiveFailures).toBe(2);
      expect(afterTwo?.lastSuccessAt).toBeNull();

      const afterSuccess = recordAutomationOutcome(db, created.id, {
        success: true,
        at: "2026-08-25T03:00:00.000Z",
      });
      expect(afterSuccess?.consecutiveFailures).toBe(0);
      expect(afterSuccess?.lastSuccessAt).toBe("2026-08-25T03:00:00.000Z");
      expect(afterSuccess?.lastRunAt).toBe("2026-08-25T03:00:00.000Z");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps pause state across a reopened database, unlike the in-memory scheduler it replaces", () => {
    const root = mkdtempSync(join(tmpdir(), "actual-bench-automation-restart-"));
    const path = join(root, "metadata.sqlite");
    try {
      const db = getAppDb(path);
      const created = createAutomation(db, baseInput);
      recordAutomationOutcome(db, created.id, { success: false, at: "2026-08-25T01:00:00.000Z" });
      pauseAutomationForHealth(db, created.id, "2026-08-25T01:00:00.000Z", "5 consecutive failures");

      // Simulate a server restart: drop the connection and reopen the file.
      resetAppDbForTests();
      const reopened = getAppDb(path);

      const afterRestart = getAutomation(reopened, created.id);
      expect(afterRestart?.enabled).toBe(false);
      expect(afterRestart?.autoPausedAt).toBe("2026-08-25T01:00:00.000Z");
      expect(afterRestart?.autoPauseReason).toBe("5 consecutive failures");
      expect(afterRestart?.consecutiveFailures).toBe(1);

      const resumed = resumeAutomation(reopened, created.id);
      expect(resumed?.enabled).toBe(true);
      expect(resumed?.autoPausedAt).toBeNull();
      expect(resumed?.consecutiveFailures).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not let a configuration edit clear an unresolved health pause", () => {
    const { root, db } = tempDb();
    try {
      const created = createAutomation(db, baseInput);
      pauseAutomationForHealth(db, created.id, "2026-08-25T01:00:00.000Z", "vault key missing");

      const edited = updateAutomation(db, created.id, { intervalMinutes: 45 });
      expect(edited?.intervalMinutes).toBe(45);
      expect(edited?.autoPausedAt).toBe("2026-08-25T01:00:00.000Z");
      expect(edited?.autoPauseReason).toBe("vault key missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates the failure policy as a whole", () => {
    const { root, db } = tempDb();
    try {
      expect(() =>
        createAutomation(db, {
          ...baseInput,
          failurePolicy: { backoffMinutes: 30, backoffCeilingMinutes: 10 },
        })
      ).toThrow(/backoffCeilingMinutes must be at least/);

      const created = createAutomation(db, {
        ...baseInput,
        failurePolicy: { backoffMinutes: 2 },
      });
      expect(created.failurePolicy.backoffMinutes).toBe(2);
      // Unspecified fields keep their defaults rather than becoming undefined.
      expect(created.failurePolicy.backoffCeilingMinutes).toBe(
        DEFAULT_FAILURE_POLICY.backoffCeilingMinutes
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

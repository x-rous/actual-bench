/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { listAutomations } from "@/lib/app-db/automationRepository";
import {
  createBackupDestination,
  createBackupPolicy,
  updateBackupPolicy,
  type BackupPolicy,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { backupJobType } from "./backup";
import { reconcileBackupAutomations } from "./backupReconcile";
import { BACKUP_JOB_TYPE, BACKUP_SCRUB_JOB_TYPE } from "./backupType";
import { backupScrubJobType } from "./backupScrub";

describe("backup rules become automations", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-backup-job-"));
    db = getAppDb(join(root, "metadata.sqlite"));
    mkdirSync(join(root, "volume"), { recursive: true });
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  function policy(overrides: Record<string, unknown> = {}): BackupPolicy {
    const destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: join(root, "volume") } },
    });
    return createBackupPolicy(db, {
      name: "Nightly",
      destinationIds: [destination.id],
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
      ...overrides,
    });
  }

  it("creates one automation per rule, with the rule's own schedule", () => {
    const created = policy({ cronExpression: "0 3 * * *", timezone: "Asia/Dubai" });

    reconcileBackupAutomations(db, [created]);

    const [automation] = listAutomations(db, { type: BACKUP_JOB_TYPE });
    expect(automation).toMatchObject({
      name: "Nightly",
      scheduleKind: "cron",
      cronExpression: "0 3 * * *",
      timezone: "Asia/Dubai",
      enabled: true,
      credentialRef: "conn-1",
    });
    expect(automation.config.data.policyId).toBe(created.id);
  });

  it("is idempotent, because it runs every tick", () => {
    const created = policy();
    reconcileBackupAutomations(db, [created]);
    reconcileBackupAutomations(db, [created]);
    reconcileBackupAutomations(db, [created]);

    expect(listAutomations(db, { type: BACKUP_JOB_TYPE })).toHaveLength(1);
  });

  it("follows a schedule change made on the Backups page", () => {
    const created = policy();
    reconcileBackupAutomations(db, [created]);

    const changed = updateBackupPolicy(db, created.id, { cronExpression: "30 4 * * *" })!;
    reconcileBackupAutomations(db, [changed]);

    expect(listAutomations(db, { type: BACKUP_JOB_TYPE })[0].cronExpression).toBe("30 4 * * *");
  });

  it("turns an automation off with its rule but never back on", () => {
    // Someone who pressed Pause on the Automations page must not have it undone
    // by the next reconcile.
    const created = policy();
    reconcileBackupAutomations(db, [created]);
    const [automation] = listAutomations(db, { type: BACKUP_JOB_TYPE });

    const disabled = updateBackupPolicy(db, created.id, { enabled: false })!;
    reconcileBackupAutomations(db, [disabled]);
    expect(listAutomations(db, { type: BACKUP_JOB_TYPE })[0].enabled).toBe(false);

    const reEnabled = updateBackupPolicy(db, created.id, { enabled: true })!;
    reconcileBackupAutomations(db, [reEnabled]);
    const after = listAutomations(db, { type: BACKUP_JOB_TYPE }).find(
      (entry) => entry.id === automation.id
    );
    expect(after?.enabled).toBe(false);
  });

  it("disables the automation of a rule that no longer exists rather than deleting its history", () => {
    const created = policy();
    reconcileBackupAutomations(db, [created]);

    reconcileBackupAutomations(db, []);

    const [automation] = listAutomations(db, { type: BACKUP_JOB_TYPE });
    expect(automation.enabled).toBe(false);
  });

  it("creates one scrub automation for the whole install, not one per rule", () => {
    // Rules usually share destinations; a scrub per rule would re-read the same
    // objects several times a week, which on metered storage costs money for no
    // extra confidence.
    reconcileBackupAutomations(db, [policy(), policy({ name: "Weekly off-site" })]);

    expect(listAutomations(db, { type: BACKUP_SCRUB_JOB_TYPE })).toHaveLength(1);
    expect(listAutomations(db, { type: BACKUP_SCRUB_JOB_TYPE })[0].cronExpression).toBe("0 4 * * 0");
  });

  it("does not create a scrub automation when no rule wants one", () => {
    reconcileBackupAutomations(db, [policy({ scrubEnabled: false })]);
    expect(listAutomations(db, { type: BACKUP_SCRUB_JOB_TYPE })).toHaveLength(0);
  });
});

describe("how a backup run is reported", () => {
  const base = {
    policyId: "pol-1",
    startedAt: "2026-08-27T02:00:00.000Z",
    finishedAt: "2026-08-27T02:01:00.000Z",
    trigger: "scheduled" as const,
  };

  const artifact = (overrides: Record<string, unknown> = {}) => ({
    kind: "budget" as const,
    artifactId: "art-1",
    status: "stored" as const,
    sizeBytes: 1024,
    verification: { level: "data" as const, status: "passed" as const, findings: [], content: {}, checksumSha256: "x" },
    destinations: [
      { destinationId: "d1", destinationName: "Volume", status: "stored" as const, objectKey: "k", sizeBytes: 1024 },
    ],
    ...overrides,
  });

  it("counts a run that stored nothing as a failure", () => {
    const rollup = backupJobType.summarize({
      policyId: "pol-1",
      prune: null,
      run: { ...base, artifacts: [artifact({ status: "failed", destinations: [] })], stored: false, verified: false, message: "Volume is full" },
    });

    expect(rollup.outcome).toBe("failed");
    expect(rollup.message).toBe("Volume is full");
  });

  it("does not hold a failed destination against the automation's health", () => {
    // Pausing a backup because one of two destinations is unreachable would
    // stop the copies that were still working.
    const rollup = backupJobType.summarize({
      policyId: "pol-1",
      prune: null,
      run: {
        ...base,
        stored: true,
        verified: true,
        artifacts: [
          artifact({
            destinations: [
              { destinationId: "d1", destinationName: "Volume", status: "stored", objectKey: "k", sizeBytes: 1 },
              { destinationId: "d2", destinationName: "Off-site", status: "failed", objectKey: null, sizeBytes: null, error: "timeout" },
            ],
          }),
        ],
      },
    });

    expect(rollup.outcome).toBe("partial");
    expect(rollup.countsAsFailure).toBe(false);
  });

  it("reports a stored-but-unverified copy as partial, not as success", () => {
    const rollup = backupJobType.summarize({
      policyId: "pol-1",
      prune: null,
      run: {
        ...base,
        stored: true,
        verified: false,
        message: "The archive does not contain db.sqlite.",
        artifacts: [
          artifact({
            verification: {
              level: "data" as const,
              status: "failed" as const,
              findings: ["The archive does not contain db.sqlite."],
              content: {},
              checksumSha256: "x",
            },
          }),
        ],
      },
    });

    expect(rollup.outcome).toBe("partial");
    expect(rollup.message).toMatch(/db\.sqlite/);
  });

  it("mentions retention only when it removed something", () => {
    const clean = backupJobType.summarize({
      policyId: "pol-1",
      prune: null,
      run: { ...base, stored: true, verified: true, artifacts: [artifact()] },
    });
    expect(clean.message).toBe("Verified 1 copy(ies).");

    const pruned = backupJobType.summarize({
      policyId: "pol-1",
      prune: { dryRun: false, kept: 7, failed: 0, freedBytes: 2048, pruned: [{ artifactId: "old", reason: "r", createdAt: "", kind: "budget", sizeBytes: 2048, locations: [], removed: true }] },
      run: { ...base, stored: true, verified: true, artifacts: [artifact()] },
    });
    expect(pruned.message).toMatch(/removed 1 older/);
  });
});

describe("how a scrub is reported", () => {
  const destination = (overrides: Record<string, unknown> = {}) => ({
    destinationId: "d1",
    destinationName: "Volume",
    checked: 3,
    passed: 3,
    failed: 0,
    missing: 0,
    artifacts: [],
    ...overrides,
  });

  it("fails outright when damage is found, and means it", () => {
    // Unlike a failed backup, repeating the scrub will not improve matters —
    // the copies that exist are bad. Health should go red and stay red.
    const rollup = backupScrubJobType.summarize({
      destinations: [destination({ failed: 1, passed: 2 })],
    });

    expect(rollup.outcome).toBe("failed");
    expect(rollup.countsAsFailure).toBeUndefined();
  });

  it("treats an unreachable destination as partial, since it says nothing about the copies", () => {
    const rollup = backupScrubJobType.summarize({
      destinations: [destination({ checked: 0, passed: 0, error: "Could not reach minio.lan" })],
    });

    expect(rollup.outcome).toBe("partial");
    expect(rollup.countsAsFailure).toBe(false);
  });

  it("says there is nothing to verify rather than claiming success", () => {
    const rollup = backupScrubJobType.summarize({
      destinations: [destination({ checked: 0, passed: 0 })],
    });

    expect(rollup.outcome).toBe("no_changes");
  });
});

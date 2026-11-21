/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  createBackupArtifact,
  createBackupDestination,
  createBackupPolicy,
  recordArtifactLocation,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { buildBackupReadiness } from "./readiness";

describe("backup readiness", () => {
  let root: string;
  let db: SqliteDatabase;
  const now = new Date("2026-11-20T12:00:00.000Z");

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-readiness-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  function storedCopy(
    policyId: string,
    kind: "budget" | "app-db",
    hoursAgo: number,
    destinationId: string,
    sourceBudgetId: string | null = null
  ) {
    const artifact = createBackupArtifact(db, {
      policyId,
      kind,
      sourceBudgetId,
      createdAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
      checksumSha256: "a".repeat(64),
      sizeBytes: 10,
      verificationStatus: "passed",
      sourceBudgetName: kind === "budget" ? "Household" : null,
    });
    recordArtifactLocation(db, {
      artifactId: artifact.id,
      destinationId,
      objectKey: `${artifact.id}.zip`,
      status: "stored",
      uploadedAt: artifact.createdAt,
    });
  }

  it("does not let one healthy rule hide a budget whose backups stopped", () => {
    // Worked out across everything, a fresh copy of one budget made the page
    // say "protected" while another had not been backed up for weeks.
    const destination = createBackupDestination(db, { name: "Volume", kind: "local", config: { version: 1, data: { path: root } } });
    const fresh = createBackupPolicy(db, { name: "Household", contents: "budget", destinationIds: [destination.id] });
    const stale = createBackupPolicy(db, { name: "Business", contents: "budget", destinationIds: [destination.id] });
    storedCopy(fresh.id, "budget", 2, destination.id);
    storedCopy(stale.id, "budget", 24 * 20, destination.id);

    const readiness = buildBackupReadiness(db, now);

    expect(readiness.status).toBe("at-risk");
    expect(readiness.headline).toMatch(/Business/);
    expect(readiness.rules.find((rule) => rule.policyId === stale.id)?.status).toBe("at-risk");
    expect(readiness.rules.find((rule) => rule.policyId === fresh.id)?.status).toBe("protected");
  });

  it("judges a budget rule on its budget, not on a fresh copy of Bench's settings", () => {
    const destination = createBackupDestination(db, { name: "Volume", kind: "local", config: { version: 1, data: { path: root } } });
    const rule = createBackupPolicy(db, { name: "Nightly", contents: "both", destinationIds: [destination.id] });
    storedCopy(rule.id, "app-db", 1, destination.id);
    storedCopy(rule.id, "budget", 24 * 10, destination.id);

    expect(buildBackupReadiness(db, now).rules[0]).toMatchObject({ subject: "budget", status: "at-risk" });
  });

  it("never calls a manual rule late", () => {
    const destination = createBackupDestination(db, { name: "Volume", kind: "local", config: { version: 1, data: { path: root } } });
    const rule = createBackupPolicy(db, { name: "By hand", contents: "budget", scheduleKind: "manual", destinationIds: [destination.id] });
    storedCopy(rule.id, "budget", 24 * 60, destination.id);

    expect(buildBackupReadiness(db, now).rules[0].status).toBe("protected");
  });
  it("does not count a copy of another budget attached to a rule", () => {
    // A fresh copy of budget B on budget A's rule made A look protected.
    const destination = createBackupDestination(db, { name: "Volume", kind: "local", config: { version: 1, data: { path: root } } });
    const rule = createBackupPolicy(db, { name: "Household", contents: "budget", destinationIds: [destination.id] });
    storedCopy(rule.id, "budget", 24 * 20, destination.id, "budget-a");
    storedCopy(rule.id, "budget", 1, destination.id, "budget-b");

    const readiness = buildBackupReadiness(db, now);

    expect(readiness.rules[0].status).toBe("at-risk");
    expect(readiness.rules[0].ageHours).toBeGreaterThan(24 * 19);
  });
});

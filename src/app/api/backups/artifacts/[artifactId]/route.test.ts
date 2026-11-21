/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createBackupArtifact, createBackupPolicy, getBackupArtifact } from "@/lib/app-db/backupRepository";
import { PATCH } from "./route";

describe("PATCH /api/backups/artifacts/[artifactId] attaching a copy to a rule", () => {
  let root: string;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-artifact-patch-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
  });

  const patch = (artifactId: string, body: unknown) =>
    PATCH(
      new Request("http://bench.test", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ artifactId }) }
    );

  function setup() {
    const db = getAppDb();
    const rule = createBackupPolicy(db, { name: "Household", contents: "budget" });
    // The rule's first copy fixes its budget.
    createBackupArtifact(db, {
      policyId: rule.id,
      kind: "budget",
      checksumSha256: "a".repeat(64),
      sizeBytes: 1,
      sourceBudgetId: "budget-a",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const orphan = (sourceBudgetId: string) =>
      createBackupArtifact(db, {
        policyId: null,
        kind: "budget",
        checksumSha256: "b".repeat(64),
        sizeBytes: 1,
        sourceBudgetId,
        sourceBudgetName: sourceBudgetId === "budget-a" ? "Household" : "Business",
      });
    return { db, rule, orphan };
  }

  it("refuses a copy of another budget", async () => {
    const { db, rule, orphan } = setup();
    const copy = orphan("budget-b");

    const response = await patch(copy.id, { policyId: rule.id });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/Business/);
    expect(getBackupArtifact(db, copy.id)?.policyId).toBeNull();
  });

  it("attaches a copy of the rule's own budget", async () => {
    const { db, rule, orphan } = setup();
    const copy = orphan("budget-a");

    const response = await patch(copy.id, { policyId: rule.id });

    expect(response.status).toBe(200);
    expect(getBackupArtifact(db, copy.id)?.policyId).toBe(rule.id);
  });
});

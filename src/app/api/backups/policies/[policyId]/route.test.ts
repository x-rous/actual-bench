/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createBackupDestination, createBackupPolicy } from "@/lib/app-db/backupRepository";
import { getBackupCredential } from "@/lib/credentials/backupSecrets";
import { PATCH } from "./route";

/**
 * A rule's encryption passphrase is stored under the rule's id, which comes
 * from the URL; nothing may be stored before the rule is known to exist.
 */
describe("PATCH /api/backups/policies/[policyId]", () => {
  let root: string;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  const previousVaultKey = process.env.SYNC_VAULT_KEY;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-policy-patch-"));
    mkdirSync(join(root, "volume"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.SYNC_VAULT_KEY = "test-operator-key";
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
    if (previousVaultKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousVaultKey;
  });

  const patch = (policyId: string, body: unknown) =>
    PATCH(
      new Request("http://bench.test", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ policyId }) }
    );

  it("stores nothing for a rule that does not exist", async () => {
    const response = await patch("missing", { passphrase: "correct horse" });

    expect(response.status).toBe(404);
    expect(getBackupCredential(getAppDb(), "missing")).toBeNull();
    expect(getAppDb().prepare("SELECT COUNT(*) AS n FROM credentials").get<{ n: number }>()?.n).toBe(0);
  });

  it("stores the passphrase for a rule that exists", async () => {
    const db = getAppDb();
    const destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: join(root, "volume") } },
    });
    const policy = createBackupPolicy(db, {
      name: "Settings",
      contents: "app-db",
      scheduleKind: "manual",
      destinationIds: [destination.id],
      verificationLevel: "data",
    });

    const response = await patch(policy.id, { encryption: "passphrase", passphrase: "correct horse" });

    expect(response.status).toBe(200);
    expect(getBackupCredential(db, policy.id)).toEqual({ passphrase: "correct horse" });
  });
});

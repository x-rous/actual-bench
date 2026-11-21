/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  createBackupArtifact,
  createBackupDestination,
  createBackupPolicy,
  getBackupPolicy,
} from "@/lib/app-db/backupRepository";
import { getBackupCredential } from "@/lib/credentials/backupSecrets";
import { PATCH } from "./route";

/**
 * A rule's encryption passphrase is stored under the rule's id, which comes
 * from the URL; nothing may be stored before the rule is known to exist.
 */
describe("PATCH /api/backups/policies/[policyId]", () => {
  let root: string;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  const previousVaultKey = process.env.ACTUAL_BENCH_VAULT_KEY;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-policy-patch-"));
    mkdirSync(join(root, "volume"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-operator-key";
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
    if (previousVaultKey === undefined) delete process.env.ACTUAL_BENCH_VAULT_KEY;
    else process.env.ACTUAL_BENCH_VAULT_KEY = previousVaultKey;
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

  it("keeps the old passphrase for the copies it encrypted when the passphrase changes", async () => {
    // Overwriting it under the same ref made every older encrypted copy
    // resolve to a passphrase that cannot open it.
    const db = getAppDb();
    const policy = createBackupPolicy(db, { name: "Off-site", contents: "app-db", scheduleKind: "manual" });
    await patch(policy.id, { encryption: "passphrase", passphrase: "first passphrase" });
    const oldRef = getBackupPolicy(db, policy.id)?.encryptionCredentialRef;
    expect(oldRef).toBe(policy.id);
    createBackupArtifact(db, {
      policyId: policy.id,
      kind: "app-db",
      checksumSha256: "a".repeat(64),
      sizeBytes: 10,
      encrypted: true,
      encryptionCredentialRef: oldRef,
    });

    const response = await patch(policy.id, { encryption: "passphrase", passphrase: "second passphrase" });

    expect(response.status).toBe(200);
    const newRef = getBackupPolicy(db, policy.id)?.encryptionCredentialRef;
    expect(newRef).not.toBe(oldRef);
    expect(getBackupCredential(db, oldRef as string)).toEqual({ passphrase: "first passphrase" });
    expect(getBackupCredential(db, newRef as string)).toEqual({ passphrase: "second passphrase" });
  });
  it("keeps a rule's budget fixed even after it is switched to settings only", async () => {
    // Switching to settings first used to skip the check, and a second change
    // could then point the rule at another budget.
    const db = getAppDb();
    const rule = createBackupPolicy(db, {
      name: "Household",
      contents: "budget",
      sourceRef: { version: 1, data: { connectionFingerprint: "fp-a" } },
    });
    createBackupArtifact(db, { policyId: rule.id, kind: "budget", checksumSha256: "a".repeat(64), sizeBytes: 1 });
    expect((await patch(rule.id, { contents: "app-db" })).status).toBe(200);

    const response = await patch(rule.id, {
      contents: "budget",
      sourceRef: { version: 1, data: { connectionFingerprint: "fp-b" } },
    });

    expect(response.status).toBe(409);
    expect(getBackupPolicy(db, rule.id)?.sourceRef.data.connectionFingerprint).toBe("fp-a");
  });
});

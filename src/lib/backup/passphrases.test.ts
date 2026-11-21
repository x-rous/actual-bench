/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  getBackupCredential,
  upsertBackupCredential,
} from "@/lib/credentials/backupSecrets";
import {
  createBackupArtifact,
  createBackupPolicy,
  deleteBackupArtifact,
  deleteBackupPolicy,
  getBackupArtifact,
  setArtifactPolicy,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { collectUnusedPassphrases, forgetPassphrase, listHeldPassphrases } from "./passphrases";

describe("passphrases Bench is holding", () => {
  let root: string;
  let db: SqliteDatabase;
  const previousKey = process.env.ACTUAL_BENCH_VAULT_KEY;

  beforeEach(() => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-passphrases-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.ACTUAL_BENCH_VAULT_KEY;
    else process.env.ACTUAL_BENCH_VAULT_KEY = previousKey;
  });

  function encryptedRule() {
    const policy = createBackupPolicy(db, { name: "Off-site", encryption: "passphrase" });
    upsertBackupCredential(db, {
      ref: policy.id,
      kind: "passphrase",
      label: policy.name,
      secret: { passphrase: "correct horse" },
    });
    const artifact = createBackupArtifact(db, {
      policyId: policy.id,
      kind: "budget",
      checksumSha256: "a".repeat(64),
      sizeBytes: 10,
      encrypted: true,
      encryptionCredentialRef: policy.id,
    });
    return { policy, artifact };
  }

  it("keeps the passphrase when its rule is deleted, so old backups still open", () => {
    // Deleting the secret with the rule would quietly make every encrypted
    // backup it took unopenable — data loss caused by tidying a setting.
    const { policy } = encryptedRule();

    deleteBackupPolicy(db, policy.id);
    collectUnusedPassphrases(db);

    expect(getBackupCredential(db, policy.id)).toEqual({ passphrase: "correct horse" });
  });

  it("says what still depends on it", () => {
    const { policy } = encryptedRule();
    deleteBackupPolicy(db, policy.id);

    const [held] = listHeldPassphrases(db);
    expect(held).toMatchObject({ ref: policy.id, ruleExists: false, artifactCount: 1 });
    // Never the secret itself.
    expect(JSON.stringify(held)).not.toContain("correct horse");
  });

  it("collects it once the last backup that needed it is gone", () => {
    const { policy, artifact } = encryptedRule();
    deleteBackupPolicy(db, policy.id);
    deleteBackupArtifact(db, artifact.id);

    expect(collectUnusedPassphrases(db)).toEqual([policy.id]);
    expect(getBackupCredential(db, policy.id)).toBeNull();
  });

  it("never collects a live rule's passphrase, even before its first backup", () => {
    const policy = createBackupPolicy(db, { name: "Nightly", encryption: "passphrase" });
    upsertBackupCredential(db, { ref: policy.id, kind: "passphrase", secret: { passphrase: "shh" } });

    expect(collectUnusedPassphrases(db)).toEqual([]);
    expect(getBackupCredential(db, policy.id)).not.toBeNull();
  });

  it("can be forgotten deliberately", () => {
    const { policy } = encryptedRule();
    forgetPassphrase(db, policy.id);
    expect(getBackupCredential(db, policy.id)).toBeNull();
  });

  it("leaves destination credentials alone", () => {
    // Bucket keys are a different kind of secret with a different lifecycle.
    upsertBackupCredential(db, {
      ref: "dest-1",
      kind: "s3",
      secret: { accessKeyId: "AKIA", secretAccessKey: "shh" },
    });

    expect(collectUnusedPassphrases(db)).toEqual([]);
    expect(listHeldPassphrases(db)).toHaveLength(0);
    expect(getBackupCredential(db, "dest-1")).not.toBeNull();
  });

  it("keeps a passphrase whose copies are older than the newest few hundred", async () => {
    // Deciding "unused" from a capped list deleted secrets that old encrypted
    // copies still needed once there were more than 500 newer artifacts.
    const { policy } = encryptedRule();
    const other = createBackupPolicy(db, { name: "Hourly" });
    const insert = db.transaction(() => {
      for (let index = 0; index < 600; index += 1) {
        createBackupArtifact(db, {
          policyId: other.id,
          kind: "budget",
          checksumSha256: "b".repeat(64),
          sizeBytes: 10,
          createdAt: new Date(Date.UTC(2030, 0, 1, 0, index)).toISOString(),
        });
      }
    });
    insert();
    deleteBackupPolicy(db, policy.id);

    collectUnusedPassphrases(db);

    expect(getBackupCredential(db, policy.id)).toEqual({ passphrase: "correct horse" });
    expect(listHeldPassphrases(db).find((entry) => entry.ref === policy.id)?.artifactCount).toBe(1);
  });
  it("keeps an older copy's passphrase when the copy is attached to another rule", () => {
    // A copy from before copies recorded their own ref is opened with its
    // rule's. Attached to a new rule, clean-up looked for the new rule's
    // passphrase and deleted the one this copy needs.
    const { policy, artifact } = encryptedRule();
    db.prepare("UPDATE backup_artifacts SET encryption_credential_ref = NULL WHERE id = ?").run(artifact.id);
    const next = createBackupPolicy(db, { name: "Replacement" });

    setArtifactPolicy(db, artifact.id, next.id);
    collectUnusedPassphrases(db);

    expect(getBackupArtifact(db, artifact.id)?.encryptionCredentialRef).toBe(policy.id);
    expect(getBackupCredential(db, policy.id)).toEqual({ passphrase: "correct horse" });
  });
  it("keeps an older copy's passphrase when its rule is deleted", () => {
    // A copy with no ref of its own is opened with its rule's id; deleting
    // the rule cleared that link, and clean-up then removed the passphrase.
    const { policy, artifact } = encryptedRule();
    db.prepare("UPDATE backup_artifacts SET encryption_credential_ref = NULL WHERE id = ?").run(artifact.id);

    deleteBackupPolicy(db, policy.id);
    collectUnusedPassphrases(db);

    expect(getBackupArtifact(db, artifact.id)?.encryptionCredentialRef).toBe(policy.id);
    expect(getBackupCredential(db, policy.id)).toEqual({ passphrase: "correct horse" });
  });
});

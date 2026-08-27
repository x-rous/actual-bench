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
} from "@/lib/app-db/backupCredentialRepository";
import {
  createBackupArtifact,
  createBackupPolicy,
  deleteBackupArtifact,
  deleteBackupPolicy,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { collectUnusedPassphrases, forgetPassphrase, listHeldPassphrases } from "./passphrases";

describe("passphrases Bench is holding", () => {
  let root: string;
  let db: SqliteDatabase;
  const previousKey = process.env.SYNC_VAULT_KEY;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-passphrases-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousKey;
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
});

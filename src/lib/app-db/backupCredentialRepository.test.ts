import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  deleteBackupCredential,
  getBackupCredential,
  getBackupCredentialMeta,
  hasBackupCredential,
  listBackupCredentialMeta,
  upsertBackupCredential,
} from "./backupCredentialRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-backup-vault-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

describe("backup credentials", () => {
  let root: string;
  let db: SqliteDatabase;
  const previousKey = process.env.SYNC_VAULT_KEY;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    ({ root, db } = tempDb());
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousKey;
  });

  it("round-trips an S3 secret", () => {
    upsertBackupCredential(db, {
      ref: "dest-1",
      kind: "s3",
      label: "Off-site",
      secret: { accessKeyId: "AKIA", secretAccessKey: "shh", sessionToken: "temp" },
    });

    expect(getBackupCredential(db, "dest-1")).toEqual({
      accessKeyId: "AKIA",
      secretAccessKey: "shh",
      sessionToken: "temp",
    });
  });

  it("never stores the secret in readable form", () => {
    upsertBackupCredential(db, {
      ref: "dest-1",
      kind: "s3",
      secret: { accessKeyId: "AKIA", secretAccessKey: "super-secret-value" },
    });

    const row = db
      .prepare("SELECT * FROM backup_credentials WHERE ref = ?")
      .get<Record<string, string>>("dest-1");
    expect(JSON.stringify(row)).not.toContain("super-secret-value");
    expect(JSON.stringify(row)).not.toContain("AKIA");
  });

  it("returns metadata without the secret, so it is safe to send to the browser", () => {
    upsertBackupCredential(db, {
      ref: "pol-1",
      kind: "passphrase",
      label: "Nightly encryption",
      secret: { passphrase: "correct horse" },
    });

    const meta = getBackupCredentialMeta(db, "pol-1");
    expect(meta).toMatchObject({ ref: "pol-1", kind: "passphrase", label: "Nightly encryption" });
    expect(JSON.stringify(meta)).not.toContain("correct horse");
    expect(listBackupCredentialMeta(db)).toHaveLength(1);
  });

  it("replaces a secret in place when it is re-entered", () => {
    upsertBackupCredential(db, { ref: "dest-1", kind: "s3", secret: { accessKeyId: "old", secretAccessKey: "old" } });
    upsertBackupCredential(db, { ref: "dest-1", kind: "s3", secret: { accessKeyId: "new", secretAccessKey: "new" } });

    expect(getBackupCredential(db, "dest-1")).toEqual({ accessKeyId: "new", secretAccessKey: "new" });
    expect(listBackupCredentialMeta(db)).toHaveLength(1);
  });

  it("reports absence rather than inventing an empty secret", () => {
    expect(hasBackupCredential(db, "missing")).toBe(false);
    expect(getBackupCredential(db, "missing")).toBeNull();
    expect(getBackupCredentialMeta(db, "missing")).toBeNull();
  });

  it("forgets a secret when its destination is deleted", () => {
    upsertBackupCredential(db, { ref: "dest-1", kind: "s3", secret: { accessKeyId: "a", secretAccessKey: "b" } });
    deleteBackupCredential(db, "dest-1");
    expect(hasBackupCredential(db, "dest-1")).toBe(false);
  });

  it("refuses to store anything when the vault key is not configured", () => {
    // Fail closed: writing a credential in the clear because the operator
    // forgot an env var would be the worst possible fallback.
    delete process.env.SYNC_VAULT_KEY;
    expect(() =>
      upsertBackupCredential(db, { ref: "dest-2", kind: "s3", secret: { accessKeyId: "a", secretAccessKey: "b" } })
    ).toThrow();
  });

  it("cannot open a secret sealed under a different key", () => {
    upsertBackupCredential(db, { ref: "dest-1", kind: "s3", secret: { accessKeyId: "a", secretAccessKey: "b" } });
    process.env.SYNC_VAULT_KEY = "a-different-key";
    expect(() => getBackupCredential(db, "dest-1")).toThrow();
  });
});

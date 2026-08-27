import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { upsertBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import { createBackupDestination } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { createDestinationAdapter } from "./index";

describe("choosing an adapter", () => {
  let root: string;
  let db: SqliteDatabase;
  const previousKey = process.env.SYNC_VAULT_KEY;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-dest-factory-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousKey;
  });

  it("builds a local adapter with no credentials at all", () => {
    const destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: join(root, "backups") } },
    });

    expect(createDestinationAdapter(db, destination).kind).toBe("local");
  });

  it("builds an S3 adapter from the sealed credential", () => {
    upsertBackupCredential(db, {
      ref: "dest-s3",
      kind: "s3",
      secret: { accessKeyId: "AKIA", secretAccessKey: "shh" },
    });
    const destination = createBackupDestination(db, {
      id: "dest-s3",
      name: "Off-site",
      kind: "s3",
      credentialRef: "dest-s3",
      config: { version: 1, data: { bucket: "bench", region: "eu-west-1" } },
    });

    expect(createDestinationAdapter(db, destination).kind).toBe("s3");
  });

  it("refuses to try unauthenticated when the credential is gone", () => {
    // Fail closed. Attempting anyway would turn a vault problem into a pile of
    // 403s that read like a broken bucket, and the user would go looking in the
    // wrong place.
    const destination = createBackupDestination(db, {
      name: "Off-site",
      kind: "s3",
      credentialRef: "vanished",
      config: { version: 1, data: { bucket: "bench" } },
    });

    expect(() => createDestinationAdapter(db, destination)).toThrow(/Re-enter its access key/);
  });

  it("says the vault key changed rather than blaming the bucket", () => {
    upsertBackupCredential(db, {
      ref: "dest-s3",
      kind: "s3",
      secret: { accessKeyId: "AKIA", secretAccessKey: "shh" },
    });
    const destination = createBackupDestination(db, {
      id: "dest-s3",
      name: "Off-site",
      kind: "s3",
      credentialRef: "dest-s3",
      config: { version: 1, data: { bucket: "bench" } },
    });

    process.env.SYNC_VAULT_KEY = "rotated";
    expect(() => createDestinationAdapter(db, destination)).toThrow(/SYNC_VAULT_KEY/);
  });
});

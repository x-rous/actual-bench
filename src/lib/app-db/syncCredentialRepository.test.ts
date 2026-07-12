import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  deleteSyncCredential,
  getSyncCredential,
  hasSyncCredential,
  listSyncCredentialMeta,
  upsertSyncCredential,
} from "./syncCredentialRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-vault-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const input = (fp: string) => ({
  connectionFingerprint: fp,
  mode: "http-api",
  baseUrl: "https://api.example.com",
  budgetSyncId: "budget-1",
  label: "Family",
  secret: { apiKey: "key-" + fp, encryptionPassword: "enc" },
});

describe("syncCredentialRepository (RD-058 / PR-024a)", () => {
  let root: string;
  let db: SqliteDatabase;
  const original = process.env.SYNC_VAULT_KEY;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-operator-key";
    ({ root, db } = tempDb());
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (original === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = original;
  });

  it("enrolls, reads back the decrypted secret, and lists metadata without secrets", () => {
    upsertSyncCredential(db, input("fp-a"));
    const got = getSyncCredential(db, "fp-a");
    expect(got?.secret).toEqual({ apiKey: "key-fp-a", encryptionPassword: "enc" });
    expect(got?.budgetSyncId).toBe("budget-1");

    const meta = listSyncCredentialMeta(db);
    expect(meta).toHaveLength(1);
    // Metadata must not carry the secret.
    expect(JSON.stringify(meta)).not.toContain("key-fp-a");
    expect(hasSyncCredential(db, "fp-a")).toBe(true);
  });

  it("does not persist the plaintext secret in the row", () => {
    upsertSyncCredential(db, input("fp-b"));
    const row = db.prepare("SELECT ciphertext, iv, auth_tag FROM sync_credentials WHERE connection_fingerprint = ?").get<{ ciphertext: string }>("fp-b");
    expect(row?.ciphertext).toBeTruthy();
    expect(row?.ciphertext).not.toContain("key-fp-b");
  });

  it("upsert replaces on the same fingerprint (no duplicate)", () => {
    upsertSyncCredential(db, input("fp-c"));
    upsertSyncCredential(db, { ...input("fp-c"), secret: { apiKey: "rotated" } });
    expect(listSyncCredentialMeta(db)).toHaveLength(1);
    expect(getSyncCredential(db, "fp-c")?.secret.apiKey).toBe("rotated");
  });

  it("returns null for an unknown fingerprint and removes on delete", () => {
    expect(getSyncCredential(db, "missing")).toBeNull();
    upsertSyncCredential(db, input("fp-d"));
    deleteSyncCredential(db, "fp-d");
    expect(hasSyncCredential(db, "fp-d")).toBe(false);
  });
});

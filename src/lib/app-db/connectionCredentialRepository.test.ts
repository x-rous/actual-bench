import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { CONNECTION_KDF_PARAMS, deriveKeyFromPassphrase } from "@/lib/sync/vault";
import { setAppMeta } from "./appMetaRepository";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  deleteConnectionCredential,
  deriveConnectionVaultKey,
  getConnectionCredential,
  getConnectionVaultSalt,
  getOrCreateConnectionVaultSalt,
  hasConnectionCredential,
  hasConnectionPassphrase,
  listConnectionCredentialMeta,
  resealConnectionCredentials,
  upsertConnectionCredential,
} from "./connectionCredentialRepository";
import type { ConnectionCredentialInput, SqliteDatabase } from "./types";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

function tempDb(): { root: string; dbPath: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-conncred-"));
  const dbPath = join(root, "metadata.sqlite");
  return { root, dbPath, db: getAppDb(dbPath) };
}

const input = (fp: string): ConnectionCredentialInput => ({
  connectionFingerprint: fp,
  mode: "http-api",
  baseUrl: "https://api.example.com",
  budgetSyncId: "budget-1",
  label: "Family",
  secret: { apiKey: "key-" + fp, encryptionPassword: "enc" },
});

describe("connectionCredentialRepository (RD-061 / PR-026a)", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    ({ root, db } = tempDb());
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("creates the connection_credentials table at schema v6", () => {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name=?")
      .get<{ count: number }>("connection_credentials");
    expect(row?.count).toBe(1);
  });

  it("establishes a per-install salt lazily and reports passphrase presence", () => {
    expect(hasConnectionPassphrase(db)).toBe(false);
    expect(getConnectionVaultSalt(db)).toBeNull();
    const salt = getOrCreateConnectionVaultSalt(db);
    expect(salt.length).toBe(16);
    expect(hasConnectionPassphrase(db)).toBe(true);
    // Idempotent: same salt on subsequent reads.
    expect(getOrCreateConnectionVaultSalt(db).equals(salt)).toBe(true);
  });

  it("seals, stores, and decrypts a credential under a passphrase key", () => {
    const key = deriveConnectionVaultKey(db, "unlock-me");
    upsertConnectionCredential(db, input("fp1"), key);

    expect(hasConnectionCredential(db, "fp1")).toBe(true);
    const got = getConnectionCredential(db, "fp1", key);
    expect(got?.secret).toEqual({ apiKey: "key-fp1", encryptionPassword: "enc" });
    expect(got?.label).toBe("Family");
    expect(getConnectionCredential(db, "missing", key)).toBeNull();
  });

  it("stores only ciphertext — no plaintext secret on disk", () => {
    const key = deriveConnectionVaultKey(db, "unlock-me");
    upsertConnectionCredential(db, input("fp1"), key);
    const raw = db
      .prepare("SELECT ciphertext, iv, auth_tag FROM connection_credentials WHERE connection_fingerprint=?")
      .get<{ ciphertext: string; iv: string; auth_tag: string }>("fp1");
    expect(raw?.ciphertext).not.toContain("key-fp1");
    expect(JSON.stringify(raw)).not.toContain("key-fp1");
  });

  it("listMeta returns metadata only — never secrets or ciphertext", () => {
    const key = deriveConnectionVaultKey(db, "unlock-me");
    upsertConnectionCredential(db, input("fp1"), key);
    const meta = listConnectionCredentialMeta(db);
    expect(meta).toHaveLength(1);
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("key-fp1");
    expect(serialized).not.toContain("ciphertext");
    expect(meta[0]).toMatchObject({ connectionFingerprint: "fp1", mode: "http-api", label: "Family" });
  });

  it("fails to decrypt under a wrong passphrase", () => {
    const key = deriveConnectionVaultKey(db, "right");
    upsertConnectionCredential(db, input("fp1"), key);
    const wrong = deriveConnectionVaultKey(db, "wrong");
    expect(() => getConnectionCredential(db, "fp1", wrong)).toThrow();
  });

  it("re-seals all credentials under a new key (passphrase change)", () => {
    const oldKey = deriveConnectionVaultKey(db, "old-pass");
    upsertConnectionCredential(db, input("fp1"), oldKey);
    upsertConnectionCredential(db, input("fp2"), oldKey);

    const salt = getOrCreateConnectionVaultSalt(db);
    const newKey = deriveKeyFromPassphrase("new-pass", salt);

    expect(resealConnectionCredentials(db, oldKey, newKey)).toBe(2);
    // Old key no longer opens; new key does.
    expect(() => getConnectionCredential(db, "fp1", oldKey)).toThrow();
    expect(getConnectionCredential(db, "fp1", newKey)?.secret).toEqual({ apiKey: "key-fp1", encryptionPassword: "enc" });
    expect(getConnectionCredential(db, "fp2", newKey)?.secret).toEqual({ apiKey: "key-fp2", encryptionPassword: "enc" });
  });

  it("rolls back a re-seal when a blob can't be opened under the old key", () => {
    const oldKey = deriveConnectionVaultKey(db, "old-pass");
    upsertConnectionCredential(db, input("fp1"), oldKey);
    const wrongOld = randomBytes(32);
    const newKey = randomBytes(32);
    expect(() => resealConnectionCredentials(db, wrongOld, newKey)).toThrow();
    // Original ciphertext is intact — still opens under the real old key.
    expect(getConnectionCredential(db, "fp1", oldKey)?.secret).toEqual({ apiKey: "key-fp1", encryptionPassword: "enc" });
  });

  it("deletes a remembered credential", () => {
    const key = deriveConnectionVaultKey(db, "unlock-me");
    upsertConnectionCredential(db, input("fp1"), key);
    deleteConnectionCredential(db, "fp1");
    expect(hasConnectionCredential(db, "fp1")).toBe(false);
    expect(listConnectionCredentialMeta(db)).toHaveLength(0);
  });

  it("still unlocks a pre-versioning vault (salt with no stored KDF version → legacy params)", () => {
    // Simulate an older build: a salt exists but no KDF version was stamped, and
    // the data was sealed with the legacy (v0) scrypt defaults.
    const salt = randomBytes(16);
    setAppMeta(db, "connection_vault_salt", salt.toString("base64"));
    const legacyKey = deriveKeyFromPassphrase("correct-pass", salt, CONNECTION_KDF_PARAMS[0]);
    upsertConnectionCredential(db, input("legacy"), legacyKey);

    // deriveConnectionVaultKey must reproduce the legacy key, not the current one.
    const derived = deriveConnectionVaultKey(db, "correct-pass");
    expect(derived.equals(legacyKey)).toBe(true);
    expect(derived.equals(deriveKeyFromPassphrase("correct-pass", salt, CONNECTION_KDF_PARAMS[1]))).toBe(false);
    // The pre-versioning credential opens again.
    expect(getConnectionCredential(db, "legacy", derived)?.secret).toEqual({ apiKey: "key-legacy", encryptionPassword: "enc" });
  });
});

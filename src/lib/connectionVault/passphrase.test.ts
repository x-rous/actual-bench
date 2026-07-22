import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { deriveConnectionVaultKey } from "@/lib/app-db/connectionCredentialRepository";
import { getServerCredential, upsertServerCredential } from "@/lib/app-db/serverCredentialRepository";
import type { ServerCredentialInput, SqliteDatabase } from "@/lib/app-db/types";
import { changePassphrase, isPassphraseSet, resetVault, setPassphrase, verifyPassphrase } from "./passphrase";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-passphrase-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const server: ServerCredentialInput = {
  mode: "http-api",
  baseUrl: "https://api.example.com",
  label: "Family",
  secret: { apiKey: "key-fp1" },
};

describe("connection vault passphrase lifecycle (RD-061 / RD-063)", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    ({ root, db } = tempDb());
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("sets a passphrase and verifies it via the sealed verifier", () => {
    expect(isPassphraseSet(db)).toBe(false);
    setPassphrase(db, "correct horse");
    expect(isPassphraseSet(db)).toBe(true);
    expect(verifyPassphrase(db, "correct horse")).not.toBeNull();
    expect(verifyPassphrase(db, "wrong horse")).toBeNull();
  });

  it("verify returns null when no passphrase is set", () => {
    expect(verifyPassphrase(db, "anything")).toBeNull();
  });

  it("refuses to set a passphrase twice", () => {
    setPassphrase(db, "first-pass");
    expect(() => setPassphrase(db, "second-pass")).toThrow();
  });

  it("does not store the passphrase or a usable key — only salt + verifier blob", () => {
    setPassphrase(db, "super secret pass");
    const meta = db.prepare("SELECT key, value FROM app_meta").all<{ key: string; value: string }>();
    const dump = JSON.stringify(meta);
    expect(dump).not.toContain("super secret pass");
    // A salt and a verifier exist; nothing else leaks the passphrase.
    expect(meta.some((r) => r.key === "connection_vault_salt")).toBe(true);
    expect(meta.some((r) => r.key === "connection_vault_verifier")).toBe(true);
  });

  it("changes the passphrase, re-sealing credentials and the verifier", () => {
    setPassphrase(db, "old-passphrase");
    const oldKey = deriveConnectionVaultKey(db, "old-passphrase");
    const meta = upsertServerCredential(db, server, oldKey);

    // Wrong current passphrase is rejected.
    expect(changePassphrase(db, "not-it", "new-passphrase")).toBe(false);

    expect(changePassphrase(db, "old-passphrase", "new-passphrase")).toBe(true);
    // Old passphrase no longer verifies; new one does.
    expect(verifyPassphrase(db, "old-passphrase")).toBeNull();
    const newKey = verifyPassphrase(db, "new-passphrase");
    expect(newKey).not.toBeNull();
    // The remembered server decrypts under the new key.
    expect(getServerCredential(db, meta.serverFingerprint, newKey!)?.secret).toEqual({ apiKey: "key-fp1" });
  });

  it("resets the vault — clears the passphrase and saved servers", () => {
    setPassphrase(db, "old-passphrase");
    const key = deriveConnectionVaultKey(db, "old-passphrase");
    const meta = upsertServerCredential(db, server, key);

    resetVault(db);

    expect(isPassphraseSet(db)).toBe(false);
    expect(verifyPassphrase(db, "old-passphrase")).toBeNull();
    // A fresh passphrase can be set, and the old server is gone.
    setPassphrase(db, "brand-new-pass");
    const freshKey = verifyPassphrase(db, "brand-new-pass");
    expect(freshKey).not.toBeNull();
    expect(getServerCredential(db, meta.serverFingerprint, freshKey!)).toBeNull();
  });
});

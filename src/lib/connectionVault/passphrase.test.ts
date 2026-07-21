import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  deriveConnectionVaultKey,
  getConnectionCredential,
  upsertConnectionCredential,
} from "@/lib/app-db/connectionCredentialRepository";
import type { ConnectionCredentialInput, SqliteDatabase } from "@/lib/app-db/types";
import { changePassphrase, isPassphraseSet, setPassphrase, verifyPassphrase } from "./passphrase";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-passphrase-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const cred = (fp: string): ConnectionCredentialInput => ({
  connectionFingerprint: fp,
  mode: "http-api",
  baseUrl: "https://api.example.com",
  budgetSyncId: "budget-1",
  secret: { apiKey: "key-" + fp },
});

describe("connection vault passphrase lifecycle (RD-061 / PR-026b)", () => {
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
    upsertConnectionCredential(db, cred("fp1"), oldKey);

    // Wrong current passphrase is rejected.
    expect(changePassphrase(db, "not-it", "new-passphrase")).toBe(false);

    expect(changePassphrase(db, "old-passphrase", "new-passphrase")).toBe(true);
    // Old passphrase no longer verifies; new one does.
    expect(verifyPassphrase(db, "old-passphrase")).toBeNull();
    const newKey = verifyPassphrase(db, "new-passphrase");
    expect(newKey).not.toBeNull();
    // The remembered credential decrypts under the new key.
    expect(getConnectionCredential(db, "fp1", newKey!)?.secret).toEqual({ apiKey: "key-fp1" });
  });
});

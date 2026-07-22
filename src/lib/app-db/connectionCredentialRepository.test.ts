import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  deriveConnectionVaultKey,
  getConnectionVaultSalt,
  getOrCreateConnectionVaultSalt,
  hasConnectionPassphrase,
} from "./connectionCredentialRepository";
import type { SqliteDatabase } from "./types";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-conncred-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

describe("connection vault key material (RD-061 / RD-063)", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    ({ root, db } = tempDb());
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
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

  it("derives a stable key from the same passphrase + salt, and a different key for a different passphrase", () => {
    const a1 = deriveConnectionVaultKey(db, "unlock-me");
    const a2 = deriveConnectionVaultKey(db, "unlock-me");
    const b = deriveConnectionVaultKey(db, "different");
    expect(a1.equals(a2)).toBe(true);
    expect(a1.equals(b)).toBe(false);
  });
});

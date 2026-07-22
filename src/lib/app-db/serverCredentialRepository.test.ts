import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { deriveKeyFromPassphrase } from "@/lib/sync/vault";
import { serverFingerprint, connectionFingerprint } from "@/lib/sync/connectionRef";
import { getAppDb, resetAppDbForTests } from "./connection";
import { getOrCreateConnectionVaultSalt } from "./connectionCredentialRepository";
import {
  deleteAllServerVaultCredentials,
  deleteBudgetEncryptionCredential,
  deleteServerCredential,
  getBudgetEncryptionPassword,
  getServerCredential,
  hasServerCredential,
  listServerCredentialMeta,
  resealServerVault,
  upsertBudgetEncryptionCredential,
  upsertServerCredential,
} from "./serverCredentialRepository";
import type { ServerCredentialInput, SqliteDatabase } from "./types";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-servercred-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const httpServer = { mode: "http-api" as const, baseUrl: "https://api.example.com", label: "Family API", secret: { apiKey: "k-abc" } } satisfies ServerCredentialInput;
const directServer = { mode: "browser-api" as const, baseUrl: "https://actual.example.com", label: "Home", secret: { serverPassword: "pw" } } satisfies ServerCredentialInput;

function key(db: SqliteDatabase, pass = "unlock-me"): Buffer {
  return deriveKeyFromPassphrase(pass, getOrCreateConnectionVaultSalt(db));
}

describe("serverFingerprint (RD-063)", () => {
  it("is server-scoped — same for different budgets on one server, differs across servers/modes", () => {
    const a = { mode: "http-api" as const, baseUrl: "https://api.example.com" };
    expect(serverFingerprint(a)).toBe(serverFingerprint({ ...a, baseUrl: "https://api.example.com/" }));
    // Independent of budget: connectionFingerprint varies by budget, serverFingerprint doesn't.
    expect(connectionFingerprint({ ...a, budgetSyncId: "b1" })).not.toBe(connectionFingerprint({ ...a, budgetSyncId: "b2" }));
    expect(serverFingerprint(a)).not.toBe(serverFingerprint({ ...a, baseUrl: "https://other.example.com" }));
    expect(serverFingerprint(a)).not.toBe(serverFingerprint({ ...a, mode: "browser-api" }));
  });
});

describe("serverCredentialRepository (RD-063 / PR-028a)", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    ({ root, db } = tempDb());
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("creates the new tables at schema v7", () => {
    for (const name of ["server_credentials", "budget_encryption_credentials"]) {
      const row = db.prepare("SELECT COUNT(*) AS c FROM sqlite_schema WHERE type='table' AND name=?").get<{ c: number }>(name);
      expect(row?.c).toBe(1);
    }
  });

  it("seals + decrypts a server credential; one server serves any budget", () => {
    const k = key(db);
    const meta = upsertServerCredential(db, httpServer, k);
    expect(meta.serverFingerprint).toBe(serverFingerprint(httpServer));
    expect(hasServerCredential(db, meta.serverFingerprint)).toBe(true);
    expect(getServerCredential(db, meta.serverFingerprint, k)?.secret).toEqual({ apiKey: "k-abc" });
    // No budgetSyncId anywhere on the row — it's server-scoped.
    const raw = db.prepare("SELECT * FROM server_credentials WHERE server_fingerprint=?").get(meta.serverFingerprint);
    expect(JSON.stringify(raw)).not.toContain("k-abc");
    expect(JSON.stringify(raw)).not.toContain("budget");
  });

  it("lists metadata only and forgets a server (cascading its budget encryption passwords)", () => {
    const k = key(db);
    const s = upsertServerCredential(db, directServer, k);
    upsertBudgetEncryptionCredential(db, { serverFingerprint: s.serverFingerprint, budgetSyncId: "b1", encryptionPassword: "enc1" }, k);

    const meta = listServerCredentialMeta(db);
    expect(meta).toHaveLength(1);
    expect(JSON.stringify(meta)).not.toContain("pw");

    deleteServerCredential(db, s.serverFingerprint);
    expect(hasServerCredential(db, s.serverFingerprint)).toBe(false);
    expect(getBudgetEncryptionPassword(db, s.serverFingerprint, "b1", k)).toBeNull();
  });

  it("stores + reveals per-budget encryption passwords, and deletes them", () => {
    const k = key(db);
    const s = upsertServerCredential(db, httpServer, k);
    upsertBudgetEncryptionCredential(db, { serverFingerprint: s.serverFingerprint, budgetSyncId: "b1", encryptionPassword: "enc1" }, k);
    expect(getBudgetEncryptionPassword(db, s.serverFingerprint, "b1", k)).toBe("enc1");
    expect(getBudgetEncryptionPassword(db, s.serverFingerprint, "b2", k)).toBeNull();
    deleteBudgetEncryptionCredential(db, s.serverFingerprint, "b1");
    expect(getBudgetEncryptionPassword(db, s.serverFingerprint, "b1", k)).toBeNull();
  });

  it("fails to decrypt under a wrong key", () => {
    const k = key(db);
    const s = upsertServerCredential(db, httpServer, k);
    expect(() => getServerCredential(db, s.serverFingerprint, randomBytes(32))).toThrow();
  });

  it("re-seals server + budget credentials on passphrase change; rolls back on a bad old key", () => {
    const oldKey = key(db, "old-pass");
    const s = upsertServerCredential(db, httpServer, oldKey);
    upsertBudgetEncryptionCredential(db, { serverFingerprint: s.serverFingerprint, budgetSyncId: "b1", encryptionPassword: "enc1" }, oldKey);
    const newKey = deriveKeyFromPassphrase("new-pass", getOrCreateConnectionVaultSalt(db));

    expect(resealServerVault(db, oldKey, newKey)).toBe(2);
    expect(getServerCredential(db, s.serverFingerprint, newKey)?.secret).toEqual({ apiKey: "k-abc" });
    expect(getBudgetEncryptionPassword(db, s.serverFingerprint, "b1", newKey)).toBe("enc1");
    expect(() => getServerCredential(db, s.serverFingerprint, oldKey)).toThrow();

    // A wrong old key rolls the whole re-seal back.
    expect(() => resealServerVault(db, randomBytes(32), randomBytes(32))).toThrow();
    expect(getServerCredential(db, s.serverFingerprint, newKey)?.secret).toEqual({ apiKey: "k-abc" });
  });

  it("clears the whole server vault on reset", () => {
    const k = key(db);
    const s = upsertServerCredential(db, httpServer, k);
    upsertBudgetEncryptionCredential(db, { serverFingerprint: s.serverFingerprint, budgetSyncId: "b1", encryptionPassword: "enc1" }, k);
    deleteAllServerVaultCredentials(db);
    expect(listServerCredentialMeta(db)).toHaveLength(0);
    expect(getBudgetEncryptionPassword(db, s.serverFingerprint, "b1", k)).toBeNull();
  });
});

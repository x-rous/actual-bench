/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  deriveConnectionVaultKey,
  upsertConnectionCredential,
} from "@/lib/app-db/connectionCredentialRepository";
import { createSession, clearAllSessions } from "@/lib/connectionVault/session";
import { VAULT_COOKIE } from "@/lib/connectionVault/cookies";
import { resolveProxyConnection } from "./resolveConnection";

function req(token?: string): never {
  return {
    cookies: { get: (name: string) => (token && name === VAULT_COOKIE ? { value: token } : undefined) },
  } as unknown as never;
}

describe("resolveProxyConnection (RD-061 / PR-026c)", () => {
  const originalDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-proxy-resolve-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    getAppDb();
    clearAllSessions();
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    clearAllSessions();
    if (originalDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = originalDbPath;
  });

  it("uses inline credentials unchanged (ephemeral path)", () => {
    const connection = { baseUrl: "https://api.example.com", apiKey: "inline-key", budgetSyncId: "b1" };
    const result = resolveProxyConnection(req(), { connection });
    expect(result).toEqual({ ok: true, connection });
  });

  it("400s when neither connection nor connectionRef is provided", () => {
    const result = resolveProxyConnection(req(), {});
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("401s for a connectionRef when the vault is locked (no session)", () => {
    const result = resolveProxyConnection(req(), { connectionRef: "fp1" });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("injects the sealed apiKey server-side for a remembered connection", () => {
    const db = getAppDb();
    const key = deriveConnectionVaultKey(db, "unlock-me-please");
    upsertConnectionCredential(
      db,
      {
        connectionFingerprint: "fp1",
        mode: "http-api",
        baseUrl: "https://api.example.com",
        budgetSyncId: "b1",
        label: "Family",
        secret: { apiKey: "sealed-key", encryptionPassword: "enc" },
      },
      key
    );
    const token = createSession(key);

    // The browser payload carries only the reference — no apiKey.
    const result = resolveProxyConnection(req(token), { connectionRef: "fp1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.connection).toEqual({
        baseUrl: "https://api.example.com",
        apiKey: "sealed-key",
        budgetSyncId: "b1",
        encryptionPassword: "enc",
      });
    }
  });

  it("404s for an unknown reference, and for a Direct-mode record with no apiKey", () => {
    const db = getAppDb();
    const key = deriveConnectionVaultKey(db, "unlock-me-please");
    const token = createSession(key);
    expect(resolveProxyConnection(req(token), { connectionRef: "missing" })).toMatchObject({
      ok: false,
      status: 404,
    });

    upsertConnectionCredential(
      db,
      {
        connectionFingerprint: "direct1",
        mode: "browser-api",
        baseUrl: "https://actual.example.com",
        budgetSyncId: "b1",
        secret: { serverPassword: "pw" },
      },
      key
    );
    expect(resolveProxyConnection(req(token), { connectionRef: "direct1" })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("401s when the session key cannot decrypt the record (wrong key)", () => {
    const db = getAppDb();
    const rightKey = deriveConnectionVaultKey(db, "right-passphrase");
    upsertConnectionCredential(
      db,
      {
        connectionFingerprint: "fp1",
        mode: "http-api",
        baseUrl: "https://api.example.com",
        budgetSyncId: "b1",
        secret: { apiKey: "sealed-key" },
      },
      rightKey
    );
    // A session holding a different key (as if from a stale/rotated passphrase).
    const staleToken = createSession(deriveConnectionVaultKey(db, "wrong-passphrase"));
    expect(resolveProxyConnection(req(staleToken), { connectionRef: "fp1" })).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});

/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { getOrCreateConnectionVaultSalt } from "@/lib/app-db/connectionCredentialRepository";
import {
  upsertBudgetEncryptionCredential,
  upsertServerCredential,
} from "@/lib/app-db/serverCredentialRepository";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import { deriveKeyFromPassphrase } from "@/lib/sync/vault";
import { clearAllSessions, createSession } from "@/lib/connectionVault/session";
import { VAULT_COOKIE } from "@/lib/connectionVault/cookies";
import { POST } from "./route";

/**
 * This route hands a stored credential back to the browser. The vault
 * primitives underneath it are well covered; the route that unseals and
 * *returns* the secret was not tested at all, and its whole job is to refuse in
 * every case except the one where it should not.
 */

const server = {
  mode: "http-api" as const,
  baseUrl: "https://api.example.com",
  label: "Family API",
  secret: { apiKey: "k-abc-secret" },
};
const fingerprint = serverFingerprint({ mode: server.mode, baseUrl: server.baseUrl });

let root: string;
const originalDbPath = process.env.ACTUAL_BENCH_DB_PATH;

function req(body?: unknown, token?: string) {
  return {
    headers: { get: () => null },
    cookies: {
      get: (name: string) =>
        token && name === VAULT_COOKIE ? { value: token } : undefined,
    },
    nextUrl: { protocol: "http:" },
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

function unlocked(pass = "unlock-me-please") {
  const key = deriveKeyFromPassphrase(pass, getOrCreateConnectionVaultSalt(getAppDb()));
  return { key, token: createSession(key) };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "actual-bench-reveal-"));
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

describe("refusing to reveal", () => {
  it("refuses when the vault is locked, without saying whether the server exists", async () => {
    const { key } = unlocked();
    upsertServerCredential(getAppDb(), server, key);

    // No session cookie at all.
    const response = await POST(req({ serverFingerprint: fingerprint }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toMatch(/locked/i);
    expect(JSON.stringify(body)).not.toContain("k-abc-secret");
  });

  it("refuses an unknown session token", async () => {
    const { key } = unlocked();
    upsertServerCredential(getAppDb(), server, key);

    const response = await POST(req({ serverFingerprint: fingerprint }, "not-a-real-token"));
    expect(response.status).toBe(401);
  });

  it("refuses a session whose key cannot decrypt the stored secret", async () => {
    // A passphrase change re-seals the vault; a session opened under the old key
    // must fail closed rather than return garbage.
    const { key } = unlocked("right-passphrase");
    upsertServerCredential(getAppDb(), server, key);
    const wrong = createSession(
      deriveKeyFromPassphrase("wrong-passphrase", getOrCreateConnectionVaultSalt(getAppDb()))
    );

    const response = await POST(req({ serverFingerprint: fingerprint }, wrong));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatch(/could not decrypt/i);
  });

  it.each([
    ["a missing fingerprint", {}],
    ["a non-string fingerprint", { serverFingerprint: 42 }],
    ["a null fingerprint", { serverFingerprint: null }],
  ])("rejects %s as a bad request", async (_case, body) => {
    const { token } = unlocked();
    const response = await POST(req(body, token));
    expect(response.status).toBe(400);
  });

  it("returns 404 for a server it does not hold, distinct from a locked vault", async () => {
    const { token } = unlocked();
    const response = await POST(req({ serverFingerprint: "unknown-fingerprint" }, token));
    expect(response.status).toBe(404);
  });
});

describe("revealing to an unlocked session", () => {
  it("returns the server's mode, address and secret", async () => {
    const { key, token } = unlocked();
    upsertServerCredential(getAppDb(), server, key);

    const response = await POST(req({ serverFingerprint: fingerprint }, token));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mode: "http-api",
      baseUrl: "https://api.example.com",
      label: "Family API",
      secret: { apiKey: "k-abc-secret", serverPassword: null, encryptionPassword: null },
    });
  });

  it("returns a Direct server's password in the serverPassword slot, not the apiKey one", async () => {
    const { key, token } = unlocked();
    const direct = {
      mode: "browser-api" as const,
      baseUrl: "https://actual.example.com",
      label: "Home",
      secret: { serverPassword: "direct-pw" },
    };
    upsertServerCredential(getAppDb(), direct, key);

    const response = await POST(
      req(
        { serverFingerprint: serverFingerprint({ mode: direct.mode, baseUrl: direct.baseUrl }) },
        token
      )
    );
    await expect(response.json()).resolves.toMatchObject({
      mode: "browser-api",
      secret: { apiKey: null, serverPassword: "direct-pw" },
    });
  });

  it("includes a remembered budget encryption password only for the budget asked about", async () => {
    // Returning another budget's password would hand the caller a secret it did
    // not ask for and has no business holding.
    const { key, token } = unlocked();
    const db = getAppDb();
    upsertServerCredential(db, server, key);
    upsertBudgetEncryptionCredential(
      db,
      { serverFingerprint: fingerprint, budgetSyncId: "budget-1", encryptionPassword: "e2e-one" },
      key
    );

    const asked = await POST(
      req({ serverFingerprint: fingerprint, budgetSyncId: "budget-1" }, token)
    );
    await expect(asked.json()).resolves.toMatchObject({
      secret: { encryptionPassword: "e2e-one" },
    });

    const other = await POST(
      req({ serverFingerprint: fingerprint, budgetSyncId: "budget-2" }, token)
    );
    await expect(other.json()).resolves.toMatchObject({
      secret: { encryptionPassword: null },
    });
  });

  it("omits the encryption password when no budget was named", async () => {
    const { key, token } = unlocked();
    const db = getAppDb();
    upsertServerCredential(db, server, key);
    upsertBudgetEncryptionCredential(
      db,
      { serverFingerprint: fingerprint, budgetSyncId: "budget-1", encryptionPassword: "e2e-one" },
      key
    );

    const response = await POST(req({ serverFingerprint: fingerprint }, token));
    await expect(response.json()).resolves.toMatchObject({
      secret: { encryptionPassword: null },
    });
  });
});

/**
 * @jest-environment node
 */
const cookieJar = new Map<string, string>();
const cookieOptions = new Map<string, { maxAge?: number }>();

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
      cookies: {
        set: (name: string, value: string, options?: { maxAge?: number }) => {
          if (value === "") {
            cookieJar.delete(name);
            cookieOptions.delete(name);
          } else {
            cookieJar.set(name, value);
            cookieOptions.set(name, options ?? {});
          }
        },
      },
    }),
  },
}));

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { clearAllSessions } from "@/lib/connectionVault/session";
import { resetUnlockThrottle } from "@/lib/connectionVault/throttle";
import { VAULT_COOKIE } from "@/lib/connectionVault/cookies";
import { GET } from "./route";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);
import { POST as setPassphrase } from "./passphrase/route";
import { POST as changePassphrase } from "./passphrase/change/route";
import { POST as unlock } from "./unlock/route";
import { POST as lock } from "./lock/route";
import { POST as reset } from "./reset/route";

function req(body?: unknown): never {
  return {
    headers: { get: () => null },
    cookies: {
      get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    },
    nextUrl: { protocol: "http:" },
    json: async () => body,
  } as unknown as never;
}

async function status() {
  return (await GET(req()).json()) as {
    supported: boolean;
    passphraseSet: boolean;
    unlocked: boolean;
    authMode: "password" | "none";
    passwordFromEnv: boolean;
  };
}

describe("connection-vault routes (RD-061 / PR-026b)", () => {
  const originalDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-vault-routes-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    getAppDb();
    cookieJar.clear();
    cookieOptions.clear();
    clearAllSessions();
    resetUnlockThrottle();
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    cookieJar.clear();
    cookieOptions.clear();
    clearAllSessions();
    resetUnlockThrottle();
    if (originalDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = originalDbPath;
  });

  it("reports status through the full lifecycle", async () => {
    expect(await status()).toEqual({ supported: true, passphraseSet: false, unlocked: false, authMode: "password", passwordFromEnv: false });

    const set = await setPassphrase(req({ passphrase: "unlock-me-please" }));
    expect(set.status).toBe(200);
    expect(cookieJar.has(VAULT_COOKIE)).toBe(true);
    expect(await status()).toEqual({ supported: true, passphraseSet: true, unlocked: true, authMode: "password", passwordFromEnv: false });
  });

  it("rejects a short passphrase and a second set", async () => {
    expect((await setPassphrase(req({ passphrase: "short" }))).status).toBe(400);
    expect((await setPassphrase(req({ passphrase: "unlock-me-please" }))).status).toBe(200);
    expect((await setPassphrase(req({ passphrase: "another-one-here" }))).status).toBe(409);
  });

  it("locks and unlocks with the passphrase", async () => {
    await setPassphrase(req({ passphrase: "unlock-me-please" }));

    expect((await lock(req())).status).toBe(200);
    expect(cookieJar.has(VAULT_COOKIE)).toBe(false);
    expect((await status()).unlocked).toBe(false);

    expect((await unlock(req({ passphrase: "wrong-passphrase" }))).status).toBe(401);
    expect((await status()).unlocked).toBe(false);

    expect((await unlock(req({ passphrase: "unlock-me-please" }))).status).toBe(200);
    expect((await status()).unlocked).toBe(true);
  });

  it("uses an approved duration for a new unlock", async () => {
    await setPassphrase(req({ passphrase: "unlock-me-please" }));
    await lock(req());

    expect((await unlock(req({ passphrase: "unlock-me-please", duration: "30d" }))).status).toBe(200);
    expect(cookieOptions.get(VAULT_COOKIE)?.maxAge).toBe(30 * 24 * 60 * 60);
    expect((await unlock(req({ passphrase: "unlock-me-please", duration: "forever" }))).status).toBe(400);
  });

  it("throttles repeated failed unlock attempts", async () => {
    await setPassphrase(req({ passphrase: "unlock-me-please" }));
    await lock(req());

    // Five wrong guesses are 401; the throttle then locks further attempts (429).
    for (let i = 0; i < 5; i++) {
      expect((await unlock(req({ passphrase: "wrong" }))).status).toBe(401);
    }
    expect((await unlock(req({ passphrase: "wrong" }))).status).toBe(429);
    // Even the correct passphrase is refused while locked out.
    expect((await unlock(req({ passphrase: "unlock-me-please" }))).status).toBe(429);
  });

  it("changes the passphrase and rejects a wrong current one", async () => {
    await setPassphrase(req({ passphrase: "old-passphrase" }));

    expect((await changePassphrase(req({ currentPassphrase: "nope", newPassphrase: "new-passphrase" }))).status).toBe(401);
    expect((await changePassphrase(req({ currentPassphrase: "old-passphrase", newPassphrase: "new-passphrase" }))).status).toBe(200);

    // Old passphrase no longer unlocks; new one does.
    await lock(req());
    expect((await unlock(req({ passphrase: "old-passphrase" }))).status).toBe(401);
    expect((await unlock(req({ passphrase: "new-passphrase" }))).status).toBe(200);
  });

  describe("with sign-in (RD-096)", () => {
    const saved = { auth: process.env.ACTUAL_BENCH_AUTH, password: process.env.ACTUAL_BENCH_PASSWORD };

    afterEach(() => {
      if (saved.auth === undefined) delete process.env.ACTUAL_BENCH_AUTH;
      else process.env.ACTUAL_BENCH_AUTH = saved.auth;
      if (saved.password === undefined) delete process.env.ACTUAL_BENCH_PASSWORD;
      else process.env.ACTUAL_BENCH_PASSWORD = saved.password;
    });

    it("refuses to change a password the environment sets", async () => {
      await setPassphrase(req({ passphrase: "old-password" }));
      process.env.ACTUAL_BENCH_PASSWORD = "old-password";

      const response = await changePassphrase(req({ currentPassphrase: "old-password", newPassphrase: "new-password" }));
      expect(response.status).toBe(409);
      expect((await status()).passwordFromEnv).toBe(true);
    });

    it("refuses a reset while it is the app password, and allows one with sign-in off", async () => {
      await setPassphrase(req({ passphrase: "the-password" }));
      delete process.env.ACTUAL_BENCH_AUTH;
      expect((await reset(req())).status).toBe(409);
      expect((await status()).passphraseSet).toBe(true);

      process.env.ACTUAL_BENCH_AUTH = "none";
      expect((await reset(req())).status).toBe(200);
      expect((await status()).passphraseSet).toBe(false);
    });
  });
});

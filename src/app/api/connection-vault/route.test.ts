/**
 * @jest-environment node
 */
const cookieJar = new Map<string, string>();

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
      cookies: {
        set: (name: string, value: string) => {
          if (value === "") cookieJar.delete(name);
          else cookieJar.set(name, value);
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
  return (await GET(req()).json()) as { supported: boolean; passphraseSet: boolean; unlocked: boolean };
}

describe("connection-vault routes (RD-061 / PR-026b)", () => {
  const originalDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-vault-routes-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    getAppDb();
    cookieJar.clear();
    clearAllSessions();
    resetUnlockThrottle();
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    cookieJar.clear();
    clearAllSessions();
    resetUnlockThrottle();
    if (originalDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = originalDbPath;
  });

  it("reports status through the full lifecycle", async () => {
    expect(await status()).toEqual({ supported: true, passphraseSet: false, unlocked: false });

    const set = await setPassphrase(req({ passphrase: "unlock-me-please" }));
    expect(set.status).toBe(200);
    expect(cookieJar.has(VAULT_COOKIE)).toBe(true);
    expect(await status()).toEqual({ supported: true, passphraseSet: true, unlocked: true });
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
});

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
import { serverFingerprint } from "@/lib/sync/connectionRef";
import { POST as setPassphrase } from "../passphrase/route";
import { POST as unlock } from "../unlock/route";
import { GET as listServers, POST as remember, DELETE as forget } from "./route";
import { POST as reveal } from "./reveal/route";
import { POST as rememberBudgetEnc, DELETE as forgetBudgetEnc } from "./budget-encryption/route";
import { POST as rememberBudget, DELETE as forgetBudget } from "./budgets/route";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

function req(opts: { body?: unknown; query?: Record<string, string> } = {}): never {
  return {
    headers: { get: () => null },
    cookies: {
      get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    },
    nextUrl: {
      protocol: "http:",
      searchParams: { get: (k: string) => opts.query?.[k] ?? null },
    },
    json: async () => opts.body,
  } as unknown as never;
}

const httpServer = { mode: "http-api" as const, baseUrl: "https://api.example.com", label: "Family API", secret: { apiKey: "sealed-key" } };
const directServer = { mode: "browser-api" as const, baseUrl: "https://actual.example.com", label: "Home", secret: { serverPassword: "pw" } };

describe("server-scoped vault routes (RD-063 / PR-028b)", () => {
  const originalDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-servers-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    getAppDb();
    cookieJar.clear();
    clearAllSessions();
    await setPassphrase(req({ body: { passphrase: "unlock-me-please" } }));
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    cookieJar.clear();
    clearAllSessions();
    if (originalDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = originalDbPath;
  });

  it("remembers, lists (metadata only), and forgets a server", async () => {
    expect((await remember(req({ body: httpServer }))).status).toBe(201);

    const list = (await (await listServers()).json()) as {
      servers: Array<{ serverFingerprint: string; label: string; mode: string }>;
    };
    expect(list.servers).toHaveLength(1);
    const fp = serverFingerprint(httpServer);
    expect(list.servers[0]).toMatchObject({ serverFingerprint: fp, label: "Family API", mode: "http-api" });
    expect(JSON.stringify(list.servers)).not.toContain("sealed-key");

    await forget(req({ query: { serverFingerprint: fp } }));
    expect(((await (await listServers()).json()) as { servers: unknown[] }).servers).toHaveLength(0);
  });

  it("refuses to remember when the session is locked, and validates the secret", async () => {
    cookieJar.clear();
    expect((await remember(req({ body: httpServer }))).status).toBe(401);
    // Re-unlock to restore the session cookie, then check input validation.
    await unlock(req({ body: { passphrase: "unlock-me-please" } }));
    expect((await remember(req({ body: { ...httpServer, baseUrl: undefined } }))).status).toBe(400);
    expect((await remember(req({ body: { ...httpServer, secret: {} } }))).status).toBe(400);
  });

  it("reveals a server secret for reconnect — both Direct and HTTP (Option B)", async () => {
    await remember(req({ body: directServer }));
    await remember(req({ body: httpServer }));

    const directRes = await reveal(req({ body: { serverFingerprint: serverFingerprint(directServer) } }));
    expect(directRes.status).toBe(200);
    const direct = (await directRes.json()) as { mode: string; secret: { serverPassword: string | null } };
    expect(direct.mode).toBe("browser-api");
    expect(direct.secret.serverPassword).toBe("pw");

    const httpRes = await reveal(req({ body: { serverFingerprint: serverFingerprint(httpServer) } }));
    const http = (await httpRes.json()) as { mode: string; secret: { apiKey: string | null } };
    expect(http.secret.apiKey).toBe("sealed-key");
  });

  it("remembers a per-budget encryption password and releases it only when opening that budget", async () => {
    await remember(req({ body: httpServer }));
    const fp = serverFingerprint(httpServer);

    // A budget password requires a remembered server first.
    expect((await rememberBudgetEnc(req({ body: { serverFingerprint: "nope", budgetSyncId: "b1", encryptionPassword: "e" } }))).status).toBe(404);

    expect((await rememberBudgetEnc(req({ body: { serverFingerprint: fp, budgetSyncId: "b1", encryptionPassword: "enc1" } }))).status).toBe(201);

    // Reveal without budgetSyncId → no encryption password leaks.
    const bare = (await (await reveal(req({ body: { serverFingerprint: fp } }))).json()) as {
      secret: { encryptionPassword: string | null };
    };
    expect(bare.secret.encryptionPassword).toBeNull();

    // Reveal for b1 → password released; for b2 (not remembered) → null.
    const forB1 = (await (await reveal(req({ body: { serverFingerprint: fp, budgetSyncId: "b1" } }))).json()) as {
      secret: { encryptionPassword: string | null };
    };
    expect(forB1.secret.encryptionPassword).toBe("enc1");
    const forB2 = (await (await reveal(req({ body: { serverFingerprint: fp, budgetSyncId: "b2" } }))).json()) as {
      secret: { encryptionPassword: string | null };
    };
    expect(forB2.secret.encryptionPassword).toBeNull();

    await forgetBudgetEnc(req({ query: { serverFingerprint: fp, budgetSyncId: "b1" } }));
    const gone = (await (await reveal(req({ body: { serverFingerprint: fp, budgetSyncId: "b1" } }))).json()) as {
      secret: { encryptionPassword: string | null };
    };
    expect(gone.secret.encryptionPassword).toBeNull();
  });

  it("records remembered budgets and returns them in the servers list", async () => {
    await remember(req({ body: httpServer }));
    const fp = serverFingerprint(httpServer);

    // A budget requires a remembered server first.
    expect((await rememberBudget(req({ body: { serverFingerprint: "nope", budgetSyncId: "b1", name: "X" } }))).status).toBe(404);

    expect((await rememberBudget(req({ body: { serverFingerprint: fp, budgetSyncId: "b1", name: "Main" } }))).status).toBe(201);
    expect((await rememberBudget(req({ body: { serverFingerprint: fp, budgetSyncId: "b2", name: "Travel" } }))).status).toBe(201);

    const list = (await (await listServers()).json()) as {
      budgets: Array<{ serverFingerprint: string; budgetSyncId: string; name: string }>;
    };
    expect(list.budgets).toHaveLength(2);
    expect(list.budgets.map((b) => b.budgetSyncId).sort()).toEqual(["b1", "b2"]);

    await forgetBudget(req({ query: { serverFingerprint: fp, budgetSyncId: "b1" } }));
    const after = (await (await listServers()).json()) as { budgets: unknown[] };
    expect(after.budgets).toHaveLength(1);
  });

  it("reveal requires an unlocked session and a known server", async () => {
    await remember(req({ body: directServer }));
    expect((await reveal(req({ body: { serverFingerprint: "does-not-exist" } }))).status).toBe(404);
    cookieJar.clear();
    expect((await reveal(req({ body: { serverFingerprint: serverFingerprint(directServer) } }))).status).toBe(401);
  });
});

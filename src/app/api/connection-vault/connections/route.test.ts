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
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { POST as setPassphrase } from "../passphrase/route";
import { GET as listConnections, POST as remember, DELETE as forget } from "./route";
import { POST as reveal } from "./reveal/route";

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

const httpInput = {
  mode: "http-api" as const,
  baseUrl: "https://api.example.com",
  budgetSyncId: "b1",
  label: "Family",
  secret: { apiKey: "sealed-key" },
};
const directInput = {
  mode: "browser-api" as const,
  baseUrl: "https://actual.example.com",
  budgetSyncId: "b2",
  label: "Home",
  secret: { serverPassword: "pw", encryptionPassword: "enc" },
};

describe("remembered connections routes (RD-061 / PR-026d)", () => {
  const originalDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-remembered-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    getAppDb();
    cookieJar.clear();
    clearAllSessions();
    // Establish + unlock a passphrase (sets the session cookie).
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

  it("remembers, lists, and forgets a connection", async () => {
    const res = await remember(req({ body: httpInput }));
    expect(res.status).toBe(201);

    const list = (await (await listConnections()).json()) as { connections: Array<{ connectionFingerprint: string; label: string }> };
    expect(list.connections).toHaveLength(1);
    const fp = connectionFingerprint(httpInput);
    expect(list.connections[0]).toMatchObject({ connectionFingerprint: fp, label: "Family" });

    await forget(req({ query: { connectionFingerprint: fp } }));
    const after = (await (await listConnections()).json()) as { connections: unknown[] };
    expect(after.connections).toHaveLength(0);
  });

  it("refuses to remember when the session is locked", async () => {
    cookieJar.clear(); // simulate a locked session
    expect((await remember(req({ body: httpInput }))).status).toBe(401);
  });

  it("validates mode + a mode-appropriate secret", async () => {
    expect((await remember(req({ body: { ...httpInput, budgetSyncId: undefined } }))).status).toBe(400);
    expect((await remember(req({ body: { ...httpInput, secret: {} } }))).status).toBe(400);
  });

  it("reveals a remembered secret for reconnect — both Direct and HTTP (Option B)", async () => {
    await remember(req({ body: directInput }));
    await remember(req({ body: httpInput }));

    const directFp = connectionFingerprint(directInput);
    const directRes = await reveal(req({ body: { connectionFingerprint: directFp } }));
    expect(directRes.status).toBe(200);
    const direct = (await directRes.json()) as { mode: string; secret: { serverPassword: string | null; encryptionPassword: string | null } };
    expect(direct.mode).toBe("browser-api");
    expect(direct.secret.serverPassword).toBe("pw");
    expect(direct.secret.encryptionPassword).toBe("enc");

    const httpFp = connectionFingerprint(httpInput);
    const httpRes = await reveal(req({ body: { connectionFingerprint: httpFp } }));
    expect(httpRes.status).toBe(200);
    const http = (await httpRes.json()) as { mode: string; secret: { apiKey: string | null } };
    expect(http.mode).toBe("http-api");
    expect(http.secret.apiKey).toBe("sealed-key");
  });

  it("reveal requires an unlocked session and a known connection", async () => {
    await remember(req({ body: directInput }));
    const directFp = connectionFingerprint(directInput);

    cookieJar.clear();
    expect((await reveal(req({ body: { connectionFingerprint: directFp } }))).status).toBe(401);
  });
});

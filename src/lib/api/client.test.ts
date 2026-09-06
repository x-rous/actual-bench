/**
 * @jest-environment node
 */
import { getApiVersion, getServerVersion, listBudgets, testConnection } from "./client";
import type { HttpApiConnection } from "@/store/connection";

/**
 * The four functions the connect flow depends on, none of which had a test.
 *
 * `getApiVersion` and `getServerVersion` sit directly on an AGENTS.md §2
 * invariant — a version endpoint is optional and its failure must never turn a
 * working connection into a failed one. The hook enforces that with
 * `Promise.allSettled`, which only works if these reject rather than resolving
 * with something misleading; that contract is what the version tests below pin.
 */

const connection: HttpApiConnection = {
  id: "c1",
  label: "Household",
  mode: "http-api",
  baseUrl: "https://actual.example.com",
  budgetSyncId: "budget-1",
  apiKey: "key",
};

type Reply = { ok?: boolean; status?: number; json?: unknown; throws?: Error };
let reply: Reply;
let calls: { url: string; body: unknown }[] = [];

beforeEach(() => {
  calls = [];
  reply = { status: 200, json: {} };
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    return {
      ok: reply.ok ?? (status >= 200 && status < 300),
      status,
      json: async () => {
        if (reply.json === undefined) throw new Error("not json");
        return reply.json;
      },
    };
  }) as unknown as typeof fetch;
});

describe("testConnection", () => {
  it("resolves when the accounts endpoint answers", async () => {
    reply = { status: 200, json: { data: [] } };
    await expect(testConnection(connection)).resolves.toBeUndefined();
  });

  it("rejects with the server's message so the form can show why", async () => {
    reply = { status: 401, json: { error: "invalid api key" } };
    await expect(testConnection(connection)).rejects.toMatchObject({
      kind: "api",
      status: 401,
      message: "invalid api key",
    });
  });
});

describe("getApiVersion", () => {
  it("asks the server-level endpoint, unscoped by budget", async () => {
    // The wrapper version is not budget-specific; scoping it would 404 before a
    // budget has been chosen.
    reply = { status: 200, json: { data: { version: "1.2.3" } } };
    await expect(getApiVersion("https://actual.example.com", "key")).resolves.toBe("1.2.3");
    expect(calls[0].body).toMatchObject({ path: "/v1/actualhttpapiversion", method: "GET" });
  });

  it("rejects when the endpoint is absent, so the caller can settle it away", async () => {
    reply = { status: 404, json: { error: "not found" } };
    await expect(getApiVersion("https://actual.example.com", "key")).rejects.toThrow();
  });

  it("rejects rather than returning an empty version when the payload has none", async () => {
    // Resolving with "" would put a blank version in the UI and read as a
    // successful check.
    reply = { status: 200, json: { data: {} } };
    await expect(getApiVersion("https://actual.example.com", "key")).rejects.toThrow(/no version/i);
  });
});

describe("getServerVersion", () => {
  it("asks the budget-scoped endpoint and returns the version", async () => {
    reply = { status: 200, json: { data: { version: "26.9.0" } } };
    await expect(
      getServerVersion("https://actual.example.com", "key", "budget-1")
    ).resolves.toBe("26.9.0");
    expect(calls[0].body).toMatchObject({ path: "/actualserverversion" });
  });

  it("rejects with a structured error carrying the status", async () => {
    reply = { status: 500, json: { message: "upstream exploded" } };
    await expect(
      getServerVersion("https://actual.example.com", "key", "budget-1")
    ).rejects.toMatchObject({ kind: "api", status: 500, message: "upstream exploded" });
  });

  it("rejects rather than returning an empty version when the payload has none", async () => {
    reply = { status: 200, json: { data: {} } };
    await expect(
      getServerVersion("https://actual.example.com", "key", "budget-1")
    ).rejects.toThrow(/no version/i);
  });

  it("settles as a rejection, leaving a connection check free to succeed anyway", async () => {
    // The shape the connect flow relies on: `allSettled` over a rejected
    // version check plus a successful connection still connects.
    reply = { status: 404, json: { error: "gone" } };
    const [version] = await Promise.allSettled([
      getServerVersion("https://actual.example.com", "key", "budget-1"),
    ]);
    expect(version.status).toBe("rejected");
  });
});

describe("listBudgets", () => {
  const budget = (over: Record<string, unknown>) => ({
    cloudFileId: "cf",
    name: "Budget",
    state: "remote",
    groupId: "g1",
    ...over,
  });

  it("returns only remote budgets — local-only files cannot be opened over the API", async () => {
    reply = {
      status: 200,
      json: {
        data: [
          budget({ groupId: "g1", name: "Remote" }),
          budget({ groupId: "g2", name: "Local", state: "local" }),
          budget({ groupId: "g3", name: "Broken", state: "broken" }),
        ],
      },
    };
    const budgets = await listBudgets("https://actual.example.com", "key");
    expect(budgets.map((b) => b.name)).toEqual(["Remote"]);
  });

  it("drops a budget with no groupId, since the Sync ID is what identifies it", async () => {
    reply = {
      status: 200,
      json: { data: [budget({ groupId: undefined, name: "No sync id" }), budget({ name: "Fine" })] },
    };
    const budgets = await listBudgets("https://actual.example.com", "key");
    expect(budgets.map((b) => b.name)).toEqual(["Fine"]);
  });

  it("deduplicates by groupId, keeping the first — cloudFileId is not unique", async () => {
    // The same budget can appear more than once with different cloudFileIds;
    // listing it twice offers the user a choice that is not a choice.
    reply = {
      status: 200,
      json: {
        data: [
          budget({ groupId: "g1", cloudFileId: "cf-1", name: "First" }),
          budget({ groupId: "g1", cloudFileId: "cf-2", name: "Duplicate" }),
        ],
      },
    };
    const budgets = await listBudgets("https://actual.example.com", "key");
    expect(budgets.map((b) => b.name)).toEqual(["First"]);
  });

  it("accepts a bare array as well as a data-wrapped payload", async () => {
    // Server versions differ on the envelope; both shapes are in the wild.
    reply = { status: 200, json: [budget({ name: "Bare" })] };
    await expect(listBudgets("https://actual.example.com", "key")).resolves.toMatchObject([
      { name: "Bare" },
    ]);
  });

  it("returns nothing rather than throwing when the payload has no data", async () => {
    reply = { status: 200, json: {} };
    await expect(listBudgets("https://actual.example.com", "key")).resolves.toEqual([]);
  });

  it("rejects with the server's message on failure", async () => {
    reply = { status: 403, json: { error: "forbidden" } };
    await expect(listBudgets("https://actual.example.com", "key")).rejects.toMatchObject({
      kind: "api",
      status: 403,
      message: "forbidden",
    });
  });
});

/**
 * @jest-environment node
 */
import { POST } from "./route";
import { __internals } from "./serverQueue";

/**
 * Every browser call in HTTP API Server mode transits this route, and it had no
 * test — only its request queue did. What it builds (URL, headers, method) is
 * the contract with actual-http-api, and what it does with an upstream failure
 * is what the user sees when their server is down.
 *
 * `fetch` is mocked; everything else is the real route.
 */

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

type Upstream = { status: number; json?: unknown; throws?: Error };
let upstream: Upstream;
let fetchCalls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  __internals.serverQueueTails.clear();
  fetchCalls = [];
  upstream = { status: 200, json: { data: "ok" } };
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (upstream.throws) throw upstream.throws;
    return {
      ok: upstream.status >= 200 && upstream.status < 300,
      status: upstream.status,
      json: async () => {
        if (upstream.json === undefined) throw new Error("not json");
        return upstream.json;
      },
    };
  }) as unknown as typeof fetch;
});

const connection = {
  baseUrl: "https://actual.example.com/",
  apiKey: "secret-key",
  budgetSyncId: "budget-abc",
  encryptionPassword: "e2e-pass",
};

function request(body: unknown, malformed = false) {
  return {
    json: async () => {
      if (malformed) throw new Error("bad json");
      return body;
    },
  } as unknown as Parameters<typeof POST>[0];
}

const headersOf = (i = 0) => fetchCalls[i].init.headers as Record<string, string>;

describe("upstream request construction", () => {
  it("builds the budget-scoped URL, trimming a trailing slash on the base", async () => {
    await POST(request({ connection, path: "/accounts" }));
    expect(fetchCalls[0].url).toBe("https://actual.example.com/v1/budgets/budget-abc/accounts");
  });

  it("uses a server-scoped path as-is when there is no budget to scope to", async () => {
    // Budget listing happens before a budget is chosen; scoping it would 404.
    await POST(request({ connection: { ...connection, budgetSyncId: "" }, path: "/v1/budgets/" }));
    expect(fetchCalls[0].url).toBe("https://actual.example.com/v1/budgets/");
  });

  it("forwards the API key and always sends the encryption-password header", async () => {
    // Some deployments require the header to be present even for unencrypted
    // budgets, so an absent password is sent as empty rather than omitted.
    await POST(request({ connection: { ...connection, encryptionPassword: undefined }, path: "/accounts" }));
    expect(headersOf()["x-api-key"]).toBe("secret-key");
    expect(headersOf()["budget-encryption-password"]).toBe("");
  });

  it("defaults to GET and sends no body when none was given", async () => {
    await POST(request({ connection, path: "/accounts" }));
    expect(fetchCalls[0].init.method).toBe("GET");
    expect(fetchCalls[0].init.body).toBeUndefined();
  });

  it("forwards the method and serialises the body for a write", async () => {
    await POST(
      request({ connection, path: "/payees", method: "POST", body: { payee: { name: "Amazon" } } })
    );
    expect(fetchCalls[0].init.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0].init.body))).toEqual({ payee: { name: "Amazon" } });
  });

  it("bounds the upstream call with a timeout so a hung server cannot hold the request open", async () => {
    await POST(request({ connection, path: "/accounts" }));
    expect(fetchCalls[0].init.signal).toBeDefined();
  });

  it("does not leak the credentials into the URL", async () => {
    // They belong in headers; a key in the path lands in every access log
    // between here and the server.
    await POST(request({ connection, path: "/accounts" }));
    expect(fetchCalls[0].url).not.toContain("secret-key");
    expect(fetchCalls[0].url).not.toContain("e2e-pass");
  });
});

describe("request validation", () => {
  it("rejects a body that is not JSON, without calling upstream", async () => {
    const response = await POST(request(null, true));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request body" });
    expect(fetchCalls).toHaveLength(0);
  });

  it.each([
    ["no connection at all", { path: "/accounts" }],
    ["no baseUrl", { connection: { apiKey: "k" }, path: "/accounts" }],
    ["no apiKey", { connection: { baseUrl: "https://x.test" }, path: "/accounts" }],
  ])("rejects a request with %s", async (_case, payload) => {
    const response = await POST(request(payload));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing connection details" });
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("upstream responses", () => {
  it("passes a successful payload straight through", async () => {
    upstream = { status: 200, json: { data: [{ id: "a1" }] } };
    const response = await POST(request({ connection, path: "/accounts" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [{ id: "a1" }] });
  });

  it("preserves 204 as an empty response rather than trying to parse a body", async () => {
    upstream = { status: 204, json: undefined };
    const response = await POST(request({ connection, path: "/payees/p1", method: "DELETE" }));
    expect(response.status).toBe(204);
  });

  it("keeps the upstream status and surfaces its own error message", async () => {
    // The status has to survive: the client distinguishes a 404 from a 401, and
    // collapsing both to 500 turns a fixable problem into a mystery.
    upstream = { status: 404, json: { error: "budget not found" } };
    const response = await POST(request({ connection, path: "/accounts" }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "budget not found" });
  });

  it("prefers `message` over `error` when the upstream sends both shapes", async () => {
    upstream = { status: 422, json: { message: "validation failed", error: "generic" } };
    const response = await POST(request({ connection, path: "/accounts" }));
    await expect(response.json()).resolves.toEqual({ error: "validation failed" });
  });

  it("falls back to the status code when the error body is unreadable", async () => {
    upstream = { status: 502, json: undefined };
    const response = await POST(request({ connection, path: "/accounts" }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "HTTP 502" });
  });

  it("reports an unreachable server as 502 with the network error, not as a crash", async () => {
    upstream = { status: 0, throws: new Error("ECONNREFUSED 127.0.0.1:5006") };
    const response = await POST(request({ connection, path: "/accounts" }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "ECONNREFUSED 127.0.0.1:5006",
    });
  });
});

describe("per-server serialisation", () => {
  it("routes the call through the queue for its server", async () => {
    // actual-http-api opens one budget at a time; concurrent requests against
    // one server interleave budget opens. The queue is covered in
    // serverQueue.test.ts — what matters here is that this route uses it.
    await POST(request({ connection, path: "/accounts" }));
    expect(__internals.serverQueueTails.size).toBe(1);
  });
});

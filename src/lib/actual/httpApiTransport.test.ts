/**
 * @jest-environment node
 */
import { createHttpApiTransport } from "./httpApiTransport";
import type { HttpApiConnection } from "@/store/connection";

/**
 * HTTP API Server mode is a first-class transport (AGENTS.md §2) and every read
 * and write in that mode passes through this file — yet 57 of its 63 functions
 * had never been executed by a test.
 *
 * The mock here is `fetch` and nothing else. The real `apiRequest` runs, so what
 * these tests pin is the request that actually reaches actual-http-api: its URL,
 * its method and its body. Mocking `apiRequest` instead would have asserted only
 * that this file calls its own helper, which is the part that cannot break.
 *
 * In the Node environment `apiRequest` forwards straight to the upstream rather
 * than through /api/proxy, which is also the path unattended server-side sync
 * takes — so the URLs asserted below are the real ones.
 */

const connection: HttpApiConnection = {
  id: "conn-1",
  label: "Household",
  mode: "http-api",
  baseUrl: "https://actual.example.com/",
  budgetSyncId: "budget-abc",
  apiKey: "secret-key",
  encryptionPassword: "e2e-pass",
};

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[] = [];
let respond: (call: Call) => { status?: number; json?: unknown };

function mockFetch() {
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    };
    calls.push(call);
    const { status = 200, json = { data: null } } = respond(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  respond = () => ({ status: 200, json: { data: null } });
  mockFetch();
});

const transport = () => createHttpApiTransport(connection);
const only = () => {
  expect(calls).toHaveLength(1);
  return calls[0];
};

describe("request construction", () => {
  it("builds the budget-scoped URL and sends the credentials as headers", async () => {
    respond = () => ({ json: { data: [] } });
    await transport().getBudgetMonths();

    const call = only();
    // The trailing slash on baseUrl must not produce a double slash.
    expect(call.url).toBe("https://actual.example.com/v1/budgets/budget-abc/months");
    expect(call.method).toBe("GET");
    expect(call.headers["x-api-key"]).toBe("secret-key");
    expect(call.headers["budget-encryption-password"]).toBe("e2e-pass");
  });

  it("sends an empty encryption password rather than omitting the header", async () => {
    // actual-http-api reads the header unconditionally; omitting it on an
    // unencrypted budget is not the same as sending it empty.
    const plain = { ...connection, encryptionPassword: undefined };
    await createHttpApiTransport(plain).getBudgetMonths();
    expect(only().headers["budget-encryption-password"]).toBe("");
  });

  it("unwraps the `data` envelope the API wraps every payload in", async () => {
    respond = () => ({ json: { data: ["2026-01", "2026-02"] } });
    await expect(transport().getBudgetMonths()).resolves.toEqual(["2026-01", "2026-02"]);
  });
});

describe("budget writes", () => {
  it.each([
    [
      "setBudgetAmount",
      (t: ReturnType<typeof transport>) => t.setBudgetAmount("2026-03", "cat-1", 12_500),
      "PATCH",
      "https://actual.example.com/v1/budgets/budget-abc/months/2026-03/categories/cat-1",
      { category: { budgeted: 12500 } },
    ],
    [
      "setBudgetCarryover",
      (t: ReturnType<typeof transport>) => t.setBudgetCarryover("2026-03", "cat-1", true),
      "PATCH",
      "https://actual.example.com/v1/budgets/budget-abc/months/2026-03/categories/cat-1",
      { category: { carryover: true } },
    ],
    [
      "holdBudgetForNextMonth",
      (t: ReturnType<typeof transport>) => t.holdBudgetForNextMonth("2026-03", 5_000),
      "POST",
      "https://actual.example.com/v1/budgets/budget-abc/months/2026-03/nextmonthbudgethold",
      { amount: 5000 },
    ],
    [
      "resetBudgetHold",
      (t: ReturnType<typeof transport>) => t.resetBudgetHold("2026-03"),
      "DELETE",
      "https://actual.example.com/v1/budgets/budget-abc/months/2026-03/nextmonthbudgethold",
      undefined,
    ],
  ])("%s targets the right month and sends the documented body", async (_name, run, method, url, body) => {
    // A wrong month in the path writes to a month the user did not choose and
    // reports success, which is the quietest way this transport can go wrong.
    await run(transport());
    const call = only();
    expect(call.method).toBe(method);
    expect(call.url).toBe(url);
    expect(call.body).toEqual(body);
  });

  it("sends a category transfer as one request naming both sides and the amount", async () => {
    await transport().transferBudget("2026-03", {
      fromCategoryId: "from-1",
      toCategoryId: "to-1",
      amount: 2_500,
    });

    const call = only();
    expect(call.method).toBe("POST");
    expect(call.url).toBe(
      "https://actual.example.com/v1/budgets/budget-abc/months/2026-03/categorytransfers"
    );
    expect(call.body).toEqual({
      categorytransfer: { fromCategoryId: "from-1", toCategoryId: "to-1", amount: 2500 },
    });
  });

  it("reads a single month through the month-scoped endpoint", async () => {
    respond = () => ({ json: { data: { month: "2026-03", categoryGroups: [] } } });
    await expect(transport().getBudgetMonth("2026-03")).resolves.toEqual({
      month: "2026-03",
      categoryGroups: [],
    });
    expect(only().url).toBe("https://actual.example.com/v1/budgets/budget-abc/months/2026-03");
  });
});

describe("error handling", () => {
  it("surfaces the server's own message on a failed write", async () => {
    respond = () => ({ status: 422, json: { error: "category not found" } });
    await expect(transport().setBudgetAmount("2026-03", "gone", 1)).rejects.toMatchObject({
      kind: "api",
      status: 422,
      message: "category not found",
    });
  });

  it("falls back to the status code when the error body is not readable", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;

    await expect(transport().getBudgetMonths()).rejects.toMatchObject({
      kind: "api",
      status: 500,
      message: "HTTP 500",
    });
  });

  it("reports an unreachable server as a network error rather than a status", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await expect(transport().getBudgetMonths()).rejects.toMatchObject({
      kind: "api",
      status: 0,
      message: "ECONNREFUSED",
    });
  });

  it("treats 204 No Content as success, not as an empty body to parse", async () => {
    respond = () => ({ status: 204 });
    await expect(transport().resetBudgetHold("2026-03")).resolves.toBeUndefined();
  });
});

describe("optional version checks never block a connection", () => {
  it("returns null instead of throwing when the version endpoint is missing", async () => {
    // AGENTS.md §2: a version failure must not turn a working connection into a
    // failed one. This is the transport's half of that invariant.
    respond = () => ({ status: 404, json: { error: "not found" } });
    await expect(transport().getServerVersion()).resolves.toBeNull();
  });

  it("returns null when the endpoint answers without a version", async () => {
    respond = () => ({ json: { data: {} } });
    await expect(transport().getServerVersion()).resolves.toBeNull();
  });

  it("returns the version when the endpoint does answer", async () => {
    respond = () => ({ json: { data: { version: "26.9.0" } } });
    await expect(transport().getServerVersion()).resolves.toBe("26.9.0");
  });
});

describe("capabilities", () => {
  it("reports the HTTP-mode sync capabilities, not the Direct ones", () => {
    expect(transport().mode).toBe("http-api");
    expect(transport().getSyncCapabilities()).toEqual(
      expect.objectContaining({ mode: "http-api" })
    );
  });

  it("does not ask the server whether bank sync is available", async () => {
    // The endpoints are part of actual-http-api's contract, so unlike the
    // Direct runtime there is no per-build question to ask.
    await expect(transport().canRunBankSync?.()).resolves.toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("has no sync step and runs budget updates without a batch wrapper", async () => {
    await expect(transport().sync()).resolves.toBeUndefined();
    const ran = jest.fn().mockResolvedValue("done");
    await expect(transport().batchBudgetUpdates(ran)).resolves.toBe("done");
    expect(ran).toHaveBeenCalledTimes(1);
  });
});

describe("entity endpoints", () => {
  const base = "https://actual.example.com/v1/budgets/budget-abc";

  it.each([
    ["getAccounts", (t) => t.getAccounts(), "GET", `${base}/accounts`],
    ["deleteAccount", (t) => t.deleteAccount("a1"), "DELETE", `${base}/accounts/a1`],
    ["getPayees", (t) => t.getPayees(), "GET", `${base}/payees`],
    ["deletePayee", (t) => t.deletePayee("p1"), "DELETE", `${base}/payees/p1`],
    ["getCategoryGroups", (t) => t.getCategoryGroups(), "GET", `${base}/categorygroups`],
    ["deleteCategoryGroup", (t) => t.deleteCategoryGroup("g1"), "DELETE", `${base}/categorygroups/g1`],
    ["deleteCategory", (t) => t.deleteCategory("c1"), "DELETE", `${base}/categories/c1`],
    ["getTags", (t) => t.getTags(), "GET", `${base}/tags`],
    ["deleteTag", (t) => t.deleteTag("t1"), "DELETE", `${base}/tags/t1`],
    ["getRules", (t) => t.getRules(), "GET", `${base}/rules`],
    ["deleteRule", (t) => t.deleteRule("r1"), "DELETE", `${base}/rules/r1`],
    ["getSchedules", (t) => t.getSchedules(), "GET", `${base}/schedules`],
    ["deleteSchedule", (t) => t.deleteSchedule("s1"), "DELETE", `${base}/schedules/s1`],
  ] as [string, (t: ReturnType<typeof transport>) => Promise<unknown>, string, string][])(
    "%s addresses %s %s",
    async (_name, run, method, url) => {
      // Deletes especially: a wrong path either deletes nothing and reports
      // success, or deletes the wrong kind of thing. Both are silent.
      respond = () => ({ json: { data: [] } });
      await run(transport());
      expect(only()).toMatchObject({ method, url });
    }
  );

  it("merges payees through the dedicated endpoint, naming target and sources", async () => {
    await transport().mergePayees("keep-me", ["dupe-1", "dupe-2"]);
    const call = only();
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${base}/payees/merge`);
    expect(JSON.stringify(call.body)).toContain("dupe-1");
    expect(JSON.stringify(call.body)).toContain("keep-me");
  });
});

describe("rule amounts cross the wire in minor units", () => {
  it("converts a rule's amount condition from dollars to cents on create", async () => {
    // The editor works in dollars and actual-http-api stores cents. Sending
    // dollars would create a rule that matches a hundredth of the intended
    // amount, and nothing downstream would flag it.
    respond = () => ({ json: { data: { id: "r1" } } });
    await transport().createRule({
      stage: null,
      conditionsOp: "and",
      conditions: [{ field: "amount", op: "is", value: 12.34, type: "number" }],
      actions: [],
    } as never);

    const body = JSON.stringify(only().body);
    expect(body).toContain("1234");
    expect(body).not.toContain("12.34");
  });

  it("converts amounts on update as well as on create", async () => {
    await transport().updateRule("r1", {
      conditions: [{ field: "amount", op: "is", value: 5, type: "number" }],
    } as never);

    const body = JSON.stringify(only().body);
    expect(body).toContain("500");
  });
});

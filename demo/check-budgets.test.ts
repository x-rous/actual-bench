import { remoteBudgets } from "./check-budgets.mjs";

/**
 * The listing is the part that misled us, so it is the part with a test.
 *
 * `GET /v1/budgets` returns two different things in one array: what the sync
 * server holds (`state: "remote"`) and what the API has cached locally. When the
 * Tracking demo broke, its local entry was still listed - with neither a
 * `cloudFileId` nor a `groupId` - which is exactly the row that must not be read
 * as "this budget exists and works".
 */
describe("remoteBudgets", () => {
  const listing = {
    data: [
      // Local cache entries. The second is the broken shape: no groupId, and a
      // name that has fallen back to its id.
      {
        id: "Live-Demo---Envelope-283b5a7",
        cloudFileId: "0389217b-9f62-4eb7-a7dd-992ba7e9c9d5",
        groupId: "7d243b3e-d2dc-4863-be75-b1fd85b77c2b",
        name: "Live Demo - Envelope",
      },
      { id: "Live-Demo---Tracking-1272172", name: "Live-Demo---Tracking-1272172" },
      // What the server actually holds.
      {
        cloudFileId: "0389217b-9f62-4eb7-a7dd-992ba7e9c9d5",
        state: "remote",
        groupId: "7d243b3e-d2dc-4863-be75-b1fd85b77c2b",
        name: "Live Demo - Envelope",
      },
      {
        cloudFileId: "2df796a1-0f76-4ef5-bb85-e1c342c668bb",
        state: "remote",
        groupId: "5e48dea9-96ef-4f5e-ba26-10a5af1e4da2",
        name: "Live Demo - Tracking",
      },
    ],
  };

  it("checks what the server holds, not what the API has cached", () => {
    expect(remoteBudgets(listing)).toEqual([
      { syncId: "7d243b3e-d2dc-4863-be75-b1fd85b77c2b", name: "Live Demo - Envelope" },
      { syncId: "5e48dea9-96ef-4f5e-ba26-10a5af1e4da2", name: "Live Demo - Tracking" },
    ]);
  });

  it("still checks a budget whose local cache is broken", () => {
    // The whole point: the Tracking budget is unusable *because* of that local
    // entry, so it has to stay in the list of things to verify.
    const names = remoteBudgets(listing).map((budget) => budget.name);
    expect(names).toContain("Live Demo - Tracking");
  });

  it("ignores rows with no group id, and never lists one twice", () => {
    expect(
      remoteBudgets({
        data: [
          { state: "remote", name: "No group id" },
          { state: "remote", groupId: "g-1", name: "Once" },
          { state: "remote", groupId: "g-1", name: "Again" },
        ],
      })
    ).toEqual([{ syncId: "g-1", name: "Once" }]);
  });

  it("treats an unreadable payload as no budgets rather than throwing", () => {
    expect(remoteBudgets(null)).toEqual([]);
    expect(remoteBudgets({})).toEqual([]);
    expect(remoteBudgets({ data: "not an array" })).toEqual([]);
  });
});

/**
 * The exit code is the contract: a deploy is gated on it, and `--warm` must
 * never fail a container boot. So these run the real script against a stub
 * backend rather than testing its parts.
 */
describe("check-budgets exit contract", () => {
  const listing = {
    data: [
      { state: "remote", groupId: "g-env", name: "Live Demo - Envelope" },
      { state: "remote", groupId: "g-trk", name: "Live Demo - Tracking" },
    ],
  };

  type Behaviour = { failAccountsFor?: string; failMonthsFor?: string };
  let server: import("node:http").Server;
  let origin = "";
  let behaviour: Behaviour = {};

  beforeAll(async () => {
    const { createServer } = await import("node:http");
    server = createServer((req, res) => {
      const url = req.url ?? "";
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url === "/v1/budgets") return send(200, listing);
      const match = /^\/v1\/budgets\/([^/]+)\/(accounts|months)$/.exec(url);
      if (!match) return send(404, { error: "not found" });
      const [, id, resource] = match;
      if (resource === "accounts" && behaviour.failAccountsFor === id) {
        return send(500, { error: "Unknown error while interacting with Actual Api" });
      }
      if (resource === "months" && behaviour.failMonthsFor === id) {
        return send(500, { error: "Unknown error while interacting with Actual Api" });
      }
      return send(200, { data: resource === "accounts" ? [{ id: "a" }] : ["2026-08"] });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function run(extra: string[] = []) {
    const { execFile } = await import("node:child_process");
    return new Promise<{ code: number; out: string }>((resolve) => {
      execFile(
        process.execPath,
        ["demo/check-budgets.mjs", "--url", origin, "--key", "k", "--timeout", "4000", ...extra],
        (error, stdout) => resolve({ code: error ? (error as { code?: number }).code ?? 1 : 0, out: stdout })
      );
    });
  }

  it("exits 0 and names every budget when they all open", async () => {
    behaviour = {};
    const { code, out } = await run();
    expect(code).toBe(0);
    expect(out).toContain("OK   Live Demo - Envelope");
    expect(out).toContain("OK   Live Demo - Tracking");
    expect(out).toContain("all 2 budgets open");
  });

  it("exits 1 when a budget cannot be opened, and says which", async () => {
    behaviour = { failAccountsFor: "g-trk" };
    const { code, out } = await run();
    expect(code).toBe(1);
    expect(out).toContain("FAIL Live Demo - Tracking");
    expect(out).toContain("OK   Live Demo - Envelope");
    expect(out).toContain("1 of 2 budgets cannot be opened");
  });

  it("exits 1 when a budget opens but its budget data does not", async () => {
    // The reported failure was on the budget page, not the account list.
    behaviour = { failMonthsFor: "g-trk" };
    const { code, out } = await run();
    expect(code).toBe(1);
    expect(out).toContain("FAIL Live Demo - Tracking");
  });

  it("exits 0 under --warm even when a budget fails, so a boot is never blocked", async () => {
    behaviour = { failAccountsFor: "g-trk" };
    const { code, out } = await run(["--warm"]);
    expect(code).toBe(0);
    expect(out).toContain("FAIL Live Demo - Tracking");
  });

  it("refuses to send the API key to a plaintext address that is not loopback", async () => {
    behaviour = {};
    const { execFile } = await import("node:child_process");
    const result = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(
        process.execPath,
        ["demo/check-budgets.mjs", "--url", "http://demo.example.com", "--key", "k", "--timeout", "2000"],
        (error, stdout) => resolve({ code: error ? (error as { code?: number }).code ?? 1 : 0, out: stdout })
      );
    });
    expect(result.code).toBe(1);
    expect(result.out).toContain("refusing to send the API key");
  });
});

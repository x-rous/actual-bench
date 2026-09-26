import { loadBrowserApiBudgetList } from "./budgetList";

jest.mock("./environment", () => ({ assertDirectBrowserApiEnvironment: jest.fn() }));

const SERVER = "https://actual.example.com";

function reply(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status });
}

function serve(routes: Record<string, () => Response | Promise<Response>>) {
  return jest.spyOn(global, "fetch").mockImplementation(async (input) => {
    const path = String(input).slice(SERVER.length);
    const handler = routes[path];
    if (!handler) throw new TypeError("Failed to fetch");
    return handler();
  });
}

describe("loadBrowserApiBudgetList", () => {
  afterEach(() => jest.restoreAllMocks());

  it("signs in, then lists live budgets and reads the version", async () => {
    const fetchSpy = serve({
      "/account/login": () => reply(200, { status: "ok", data: { token: "tok" } }),
      "/sync/list-user-files": () =>
        reply(200, {
          status: "ok",
          data: [
            { fileId: "f1", groupId: "g1", name: "Household", encryptKeyId: null, deleted: 0 },
            { fileId: "f2", groupId: "g2", name: "Old", deleted: 1 },
            { fileId: "f3", groupId: "g1", name: "Household copy", deleted: false },
            { fileId: "f4", groupId: "g4", name: "Joint", encryptKeyId: "k4", deleted: false },
          ],
        }),
      "/info": () => reply(200, { build: { version: "26.9.0" } }),
    });

    const result = await loadBrowserApiBudgetList({ serverUrl: `${SERVER}/`, serverPassword: "pw" });

    expect(result.serverVersion).toBe("26.9.0");
    expect(result.budgets).toEqual([
      expect.objectContaining({ cloudFileId: "f1", groupId: "g1", name: "Household", state: "remote" }),
      expect.objectContaining({ cloudFileId: "f4", groupId: "g4", name: "Joint", encryptKeyId: "k4" }),
    ]);
    const login = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/account/login"))!;
    expect(JSON.parse(String(login[1]!.body))).toEqual({ loginMethod: "password", password: "pw" });
    const list = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/list-user-files"))!;
    expect(list[1]!.headers).toEqual({ "X-ACTUAL-TOKEN": "tok" });
  });

  it("says the password is wrong when the server says so", async () => {
    serve({ "/account/login": () => reply(400, { status: "error", reason: "invalid-password" }) });
    await expect(loadBrowserApiBudgetList({ serverUrl: SERVER, serverPassword: "nope" })).rejects.toThrow(
      "Incorrect Actual Server password."
    );
  });

  it("explains the server's own sign-in limit", async () => {
    serve({ "/account/login": () => new Response("Too many requests", { status: 429 }) });
    await expect(loadBrowserApiBudgetList({ serverUrl: SERVER, serverPassword: "pw" })).rejects.toThrow(
      /Too many sign-in attempts/
    );
  });

  it("says when the server can't be reached", async () => {
    serve({});
    await expect(loadBrowserApiBudgetList({ serverUrl: SERVER, serverPassword: "pw" })).rejects.toThrow(
      /Cannot reach the Actual Server at https:\/\/actual\.example\.com/
    );
  });

  it("still lists budgets when the version can't be read", async () => {
    serve({
      "/account/login": () => reply(200, { status: "ok", data: { token: "tok" } }),
      "/sync/list-user-files": () => reply(200, { status: "ok", data: [{ fileId: "f1", groupId: "g1", name: "Household" }] }),
    });
    const result = await loadBrowserApiBudgetList({ serverUrl: SERVER, serverPassword: "pw" });
    expect(result.serverVersion).toBeNull();
    expect(result.budgets).toHaveLength(1);
  });
});

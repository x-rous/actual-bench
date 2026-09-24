import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyBudgetArchive } from "@/lib/backup/verify";
import type { BrowserApiConnection } from "@/store/connection";
import { createActualRuntimeTransport } from "../runtimeTransport";
import { ActualRuntimeError } from "./errors";
import {
  SNAPSHOT_REFRESH_INTERVAL_MS,
  __configureNodeHostForTests,
  __resetNodeHostForTests,
  closeNodeRuntime,
  getNodeRuntime,
  nodeHost,
  type SnapshotStore,
} from "./nodeHost";
import type { ActualApi } from "./types";

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function connection(overrides: Partial<BrowserApiConnection> = {}): BrowserApiConnection {
  return {
    id: "conn-1",
    label: "Test",
    mode: "browser-api",
    baseUrl: "https://actual.example.test",
    budgetSyncId: "budget-1",
    serverPassword: "server-password",
    ...overrides,
  };
}

function memorySnapshots(): SnapshotStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const id = (key: { serverFingerprint: string; budgetSyncId: string }) => `${key.serverFingerprint}/${key.budgetSyncId}`;
  return {
    rows,
    lastSnapshotAt: (key) => rows.get(id(key)) ?? null,
    recordSnapshot: (key, at) => void rows.set(id(key), at),
  };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "actual-bench-runtime-"));
  process.env.ACTUAL_BENCH_RUNTIME_DIR = root;
  __resetNodeHostForTests();
});

afterEach(async () => {
  await closeNodeRuntime();
  jest.restoreAllMocks();
  __resetNodeHostForTests();
  delete process.env.ACTUAL_BENCH_RUNTIME_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("the Node host", () => {
  it("refuses to open a budget in the web server's own thread", async () => {
    await expect(getNodeRuntime(connection())).rejects.toThrow(
      "Direct budgets run only inside an automation worker."
    );
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("the Node host with a scripted runtime", () => {
  function fakeApi(options: { downloadError?: unknown; uploadResult?: unknown } = {}) {
    const calls: string[] = [];
    const send = jest.fn(async (name: string) => {
      calls.push(`send:${name}`);
      return name === "upload-budget" ? (options.uploadResult ?? {}) : null;
    });
    const api = {
      init: jest.fn(async (config: { serverURL: string }) => {
        calls.push(`init:${config.serverURL}`);
        return { send };
      }),
      downloadBudget: jest.fn(async (syncId: string) => {
        calls.push(`download:${syncId}`);
        if (options.downloadError) throw options.downloadError;
      }),
      sync: jest.fn(async () => void calls.push("sync")),
      shutdown: jest.fn(async () => void calls.push("shutdown")),
    };
    return { api, send, calls };
  }

  function configure(api: unknown, snapshots = memorySnapshots(), now = () => Date.parse("2026-09-24T00:00:00Z")) {
    __configureNodeHostForTests({
      allowMainThread: true,
      loadApi: async () => api as ActualApi,
      snapshots,
      now,
    });
    return snapshots;
  }

  it("opens once per connection and switches budgets one after the other (Pattern A)", async () => {
    const { api, calls } = fakeApi();
    configure(api);

    const first = await getNodeRuntime(connection());
    expect(await getNodeRuntime(connection())).toBe(first);
    await getNodeRuntime(connection({ id: "conn-2", budgetSyncId: "budget-2" }));

    expect(calls.filter((call) => call.startsWith("download:"))).toEqual(["download:budget-1", "download:budget-2"]);
    // The first budget is shut down before the second is opened.
    expect(calls.indexOf("shutdown")).toBeLessThan(calls.indexOf("download:budget-2"));
  });

  it("downloads into a private workspace of its own and deletes it at the end of the task", async () => {
    const { api } = fakeApi();
    configure(api);

    await getNodeRuntime(connection());
    const dataDir = (api.init.mock.calls[0][0] as unknown as { dataDir: string }).dataDir;
    expect(dataDir.startsWith(join(root, "w-"))).toBe(true);
    expect(existsSync(dataDir)).toBe(true);

    await closeNodeRuntime();
    expect(existsSync(dataDir)).toBe(false);
    expect(api.shutdown).toHaveBeenCalledTimes(1);
  });

  it("uploads a fresh snapshot after a clean task, then not again within seven days", async () => {
    const { api, send } = fakeApi();
    let now = Date.parse("2026-09-24T00:00:00Z");
    const snapshots = configure(api, memorySnapshots(), () => now);

    await getNodeRuntime(connection());
    await closeNodeRuntime({ refreshSnapshot: true });
    expect(send).toHaveBeenCalledWith("upload-budget");
    expect(snapshots.rows.size).toBe(1);

    send.mockClear();
    now += SNAPSHOT_REFRESH_INTERVAL_MS - 60_000;
    await getNodeRuntime(connection());
    await closeNodeRuntime({ refreshSnapshot: true });
    expect(send).not.toHaveBeenCalledWith("upload-budget");

    now += 120_000;
    await getNodeRuntime(connection());
    await closeNodeRuntime({ refreshSnapshot: true });
    expect(send).toHaveBeenCalledWith("upload-budget");
  });

  it("does not upload after a task that did not finish cleanly", async () => {
    const { api, send } = fakeApi();
    const snapshots = configure(api);

    await getNodeRuntime(connection());
    await closeNodeRuntime({ refreshSnapshot: false });
    expect(send).not.toHaveBeenCalledWith("upload-budget");
    expect(snapshots.rows.size).toBe(0);
  });

  it("refreshes the budget it leaves when a task switches to another", async () => {
    const { api, calls } = fakeApi();
    configure(api);

    await getNodeRuntime(connection());
    await getNodeRuntime(connection({ id: "conn-2", budgetSyncId: "budget-2" }));
    expect(calls.indexOf("send:upload-budget")).toBeLessThan(calls.indexOf("download:budget-2"));
  });

  it("keeps a failed upload from failing anything, and tries again next time", async () => {
    const { api, send } = fakeApi({ uploadResult: { error: { reason: "unauthorized" } } });
    const snapshots = configure(api);

    await getNodeRuntime(connection());
    await expect(closeNodeRuntime({ refreshSnapshot: true })).resolves.toBeUndefined();
    expect(snapshots.rows.size).toBe(0);

    send.mockClear();
    await getNodeRuntime(connection());
    await closeNodeRuntime({ refreshSnapshot: true });
    expect(send).toHaveBeenCalledWith("upload-budget");
  });

  it("reports a known failure in plain language, with its code", async () => {
    const encrypted = Object.assign(new Error("File Envelope is encrypted. Please provide a password."), {
      code: "missing-key",
    });
    const { api } = fakeApi({ downloadError: encrypted });
    configure(api);

    const failure = await getNodeRuntime(connection()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ActualRuntimeError);
    expect(failure).toMatchObject({ code: "ENCRYPTION_KEY_REQUIRED" });

    // A failed open is not kept: the next call tries again.
    await expect(getNodeRuntime(connection())).rejects.toBeInstanceOf(ActualRuntimeError);
    expect(api.downloadBudget).toHaveBeenCalledTimes(2);
  });
});

describe("the Direct transport on the Node host, with the real @actual-app/api Node build", () => {
  // No server here: `init` runs offline, and "downloading" the budget creates
  // a local one with `runImport`. Everything after that - every read, write
  // and the export - is the real runtime driven through the shared transport.
  jest.setTimeout(60_000);

  it("reads, writes and exports a local budget", async () => {
    // The runtime narrates everything it does; keep the test output readable.
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    const real = (await import("@actual-app/api")) as unknown as ActualApi & {
      runImport(name: string, fn: () => Promise<void>): Promise<void>;
    };
    const seeded: { accountId?: string } = {};

    __configureNodeHostForTests({
      allowMainThread: true,
      snapshots: memorySnapshots(),
      loadApi: async () =>
        ({
          ...real,
          init: (config: { dataDir?: string }) => real.init({ dataDir: config.dataDir } as never),
          downloadBudget: async () => {
            await real.runImport("Node Host Test", async () => {
              seeded.accountId = await real.createAccount({ name: "Checking", offbudget: false } as never, 0);
              const payee = await real.createPayee({ name: "Grocer" } as never);
              await real.addTransactions(seeded.accountId, [
                { date: "2026-09-01", amount: -1234, payee },
                { date: "2026-09-02", amount: -5678, payee },
              ]);
            });
          },
          // Offline: there is no server to sync with.
          sync: async () => undefined,
        }) as unknown as ActualApi,
    });

    const transport = createActualRuntimeTransport(connection(), nodeHost);

    const accounts = await transport.getAccounts();
    expect(accounts.map((account) => account.name)).toEqual(["Checking"]);
    const accountId = seeded.accountId!;

    expect((await transport.getPayees()).map((payee) => payee.name)).toContain("Grocer");
    // A new budget comes with Actual's default categories.
    const { groups, categories } = await transport.getCategoryGroups();
    expect(groups.length).toBeGreaterThan(0);
    expect(categories.length).toBeGreaterThan(0);

    const before = await transport.listTransactionsForSync({ accountId });
    expect(before).toHaveLength(2);

    await transport.createTransactionsForSync([
      { accountId, date: "2026-09-03", amount: -999, payeeName: "Bakery", importedId: "bench-test-1" },
    ]);
    const after = await transport.listTransactionsForSync({ accountId });
    expect(after).toHaveLength(3);
    expect(after.some((row) => row.amount === -999)).toBe(true);

    // Read back the way a backup would: it opens as a budget, with what was written.
    const verified = verifyBudgetArchive(await transport.exportBudget!(), "data");
    expect(verified.status).toBe("passed");
    expect(verified.content).toMatchObject({ accounts: 1, transactions: 3 });

    const dataDir = readdirSync(root);
    expect(dataDir).toHaveLength(1);
    await closeNodeRuntime();
    expect(readdirSync(root)).toEqual([]);
  });
});

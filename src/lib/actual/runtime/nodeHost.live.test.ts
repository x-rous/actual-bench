import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyBudgetArchive } from "@/lib/backup/verify";
import type { BrowserApiConnection } from "@/store/connection";
import { createActualRuntimeTransport } from "../runtimeTransport";
import {
  __configureNodeHostForTests,
  __resetNodeHostForTests,
  closeNodeRuntime,
  nodeHost,
  type SnapshotStore,
} from "./nodeHost";

/**
 * The Direct transport on the Node host against a real Actual server
 * (RD-095 M3). Skipped unless pointed at one:
 *
 *   ACTUAL_TEST_SERVER_URL       the server
 *   ACTUAL_TEST_SERVER_PASSWORD  its password
 *   ACTUAL_TEST_SERVER_BUDGET    a budget's sync ID (it is written to)
 *   ACTUAL_TEST_SERVER_BUDGET_2  optional: a second budget, for switching
 *
 * It writes one transaction and deletes it again. Use a test server.
 */

const url = process.env.ACTUAL_TEST_SERVER_URL;
const password = process.env.ACTUAL_TEST_SERVER_PASSWORD;
const budget = process.env.ACTUAL_TEST_SERVER_BUDGET;
const budget2 = process.env.ACTUAL_TEST_SERVER_BUDGET_2;

const live = url && password && budget ? describe : describe.skip;

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function connection(syncId: string): BrowserApiConnection {
  return {
    id: `live-${syncId}`,
    label: "Live test",
    mode: "browser-api",
    baseUrl: url!,
    budgetSyncId: syncId,
    serverPassword: password!,
  };
}

live("the Direct transport on the Node host, against a real server", () => {
  jest.setTimeout(180_000);
  let root: string;
  const uploads: string[] = [];
  // Records, but never lets the test upload: a snapshot refresh is the
  // server's to schedule, and the unit tests cover the policy.
  const snapshots: SnapshotStore = {
    lastSnapshotAt: () => new Date().toISOString(),
    recordSnapshot: (key) => void uploads.push(key.budgetSyncId),
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-live-"));
    process.env.ACTUAL_BENCH_RUNTIME_DIR = root;
    __configureNodeHostForTests({ allowMainThread: true, snapshots });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(async () => {
    await closeNodeRuntime();
    __resetNodeHostForTests();
    jest.restoreAllMocks();
    delete process.env.ACTUAL_BENCH_RUNTIME_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it("downloads, reads, writes, syncs and exports", async () => {
    const open = () => createActualRuntimeTransport(connection(budget!), nodeHost);
    const find = async (accountId: string, marker: string) =>
      (await open().listTransactionsForSync({ accountId, startDate: "2026-09-24", endDate: "2026-09-24" })).find(
        (row) => row.importedId === marker
      );

    const accounts = (await open().getAccounts()).filter((account) => !account.closed);
    expect(accounts.length).toBeGreaterThan(0);
    const accountId = accounts[0].id;
    expect((await open().getPayees()).length).toBeGreaterThan(0);

    const marker = `bench-live-${Date.now()}`;
    const { created } = await open().createTransactionsForSync([
      { accountId, date: "2026-09-24", amount: -101, payeeName: "Bench live test", notes: marker, importedId: marker },
    ]);
    expect(created).toHaveLength(1);
    await open().sync();

    // A fresh download - a new workspace - sees it: it reached the server.
    await closeNodeRuntime();
    const written = await find(accountId, marker);
    expect(written).toBeDefined();

    await open().deleteTransactionForSync({ transactionId: written!.id });
    await open().sync();
    await closeNodeRuntime();
    expect(await find(accountId, marker)).toBeUndefined();

    const verified = verifyBudgetArchive(await open().exportBudget!(), "data");
    expect(verified.status).toBe("passed");
    expect(verified.content.transactions).toBeGreaterThan(0);
  });

  (budget2 ? it : it.skip)("switches to a second budget in the same worker, and back (Pattern A)", async () => {
    const first = createActualRuntimeTransport(connection(budget!), nodeHost);
    const second = createActualRuntimeTransport(connection(budget2!), nodeHost);

    const a = (await first.getAccounts()).map((account) => account.id);
    const b = (await second.getAccounts()).map((account) => account.id);
    expect(a).not.toEqual(b);
    expect((await first.getAccounts()).map((account) => account.id)).toEqual(a);
  });

  it("leaves nothing on disk once the task is closed", async () => {
    await closeNodeRuntime();
    expect(readdirSync(root)).toEqual([]);
  });
});

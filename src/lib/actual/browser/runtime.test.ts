/**
 * @jest-environment jsdom
 */
import { useConnectionStore, type BrowserApiConnection } from "@/store/connection";
import { BudgetNotOpenError, clearBrowserApiRuntimeCache, ensureBrowserApiBudgetOpen, getBrowserApiRuntime } from "./runtime";

jest.mock("./environment", () => ({ assertDirectBrowserApiEnvironment: jest.fn() }));

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** One fake Actual module for the tab, as in the browser. */
const downloads = new Map<string, Deferred>();
const events: string[] = [];
const actual = {
  init: jest.fn(async (config?: unknown) => ({ send: jest.fn(), config })),
  downloadBudget: jest.fn((syncId: string) => {
    events.push(`download ${syncId}`);
    const pending = downloads.get(syncId);
    return pending ? pending.promise : Promise.resolve();
  }),
  sync: jest.fn(async () => undefined),
  shutdown: jest.fn(async () => {
    events.push("shutdown");
  }),
};
jest.mock("./setup", () => ({
  ...jest.requireActual("./setup"),
  loadActualApi: async () => actual,
  initializeActualApi: (module: typeof actual, config: unknown) => module.init(config),
}));

function budget(id: string): BrowserApiConnection {
  return { id, label: `Budget ${id}`, mode: "browser-api", baseUrl: "https://actual.example.com", budgetSyncId: `sync-${id}`, serverPassword: "pw" };
}

const A = budget("A");
const C = budget("C");

function activate(connection: BrowserApiConnection) {
  const store = useConnectionStore.getState();
  store.addInstance(connection);
  store.setActiveInstance(connection.id);
}

describe("the tab's one Direct runtime", () => {
  beforeEach(async () => {
    clearBrowserApiRuntimeCache();
    await Promise.resolve();
    jest.clearAllMocks();
    downloads.clear();
    events.length = 0;
    useConnectionStore.getState().clearAll();
  });

  it("opens the active budget for an ordinary request", async () => {
    activate(A);
    await expect(getBrowserApiRuntime(A)).resolves.toBeDefined();
    expect(actual.downloadBudget).toHaveBeenCalledWith("sync-A", { password: undefined });
  });

  it("never lets a request for a budget that isn't active take the runtime", async () => {
    activate(A);
    await ensureBrowserApiBudgetOpen(A);
    await expect(getBrowserApiRuntime(C)).rejects.toBeInstanceOf(BudgetNotOpenError);
    expect(actual.downloadBudget).not.toHaveBeenCalledWith("sync-C", expect.anything());
  });

  it("keeps the page being left from taking the runtime back while another budget opens", async () => {
    activate(A);
    await ensureBrowserApiBudgetOpen(A);
    downloads.set("sync-C", deferred());

    const openingC = ensureBrowserApiBudgetOpen(C);
    // A is still the active budget in the store, and its page retries a request.
    await expect(getBrowserApiRuntime(A)).rejects.toBeInstanceOf(BudgetNotOpenError);

    downloads.get("sync-C")!.resolve();
    await openingC;
    expect(events.filter((event) => event.startsWith("download"))).toEqual(["download sync-A", "download sync-C"]);
  });

  it("lets the newest open win: an older one stops at its next step", async () => {
    downloads.set("sync-A", deferred());
    const openingA = ensureBrowserApiBudgetOpen(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const openingC = ensureBrowserApiBudgetOpen(C);

    downloads.get("sync-A")!.resolve();
    await expect(openingA).rejects.toThrow("A newer budget is being opened.");
    await expect(openingC).resolves.toBeUndefined();
    expect(actual.sync).toHaveBeenCalledTimes(1);
  });

  it("shuts the worker down after a failed open before the next budget starts", async () => {
    const failing = deferred();
    downloads.set("sync-A", failing);
    const openingA = ensureBrowserApiBudgetOpen(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    failing.reject(new Error("Opening budget did not finish within 45 seconds"));
    await expect(openingA).rejects.toThrow("45 seconds");

    events.length = 0;
    await ensureBrowserApiBudgetOpen(C);
    expect(events).toEqual(["shutdown", "download sync-C"]);
  });
});

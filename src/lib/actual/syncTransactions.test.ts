import { getBrowserApiRuntime } from "./browser/runtime";
import { createBrowserApiTransport } from "./browserApiTransport";
import { createHttpApiTransport } from "./httpApiTransport";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import type { ApiImportTransaction, ApiTransaction } from "./browser/runtime";

jest.mock("./browser/runtime", () => ({
  getBrowserApiRuntime: jest.fn(),
  syncBrowserApiRuntime: jest.fn(),
}));

const mockGetBrowserApiRuntime = getBrowserApiRuntime as jest.MockedFunction<
  typeof getBrowserApiRuntime
>;

const browserConnection: BrowserApiConnection = {
  id: "conn-src",
  label: "Home",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "pw",
  budgetSyncId: "budget-src",
};

const httpConnection: HttpApiConnection = {
  id: "conn-http",
  label: "Family",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "key",
  budgetSyncId: "budget-http",
};

type FakeRuntimeOptions = {
  payees?: { id: string; name: string }[];
  categories?: { id: string; name: string; group_id?: string }[];
  transactions?: ApiTransaction[];
  /** Rows returned by the id-recovery getTransactions(date,date) call. */
  createdRows?: ApiTransaction[];
};

function buildFakeRuntime(options: FakeRuntimeOptions = {}) {
  const addTransactions = jest.fn().mockResolvedValue("ok");
  const importTransactions = jest.fn().mockResolvedValue({ added: [], updated: [], errors: [] });
  const createPayee = jest.fn().mockResolvedValue("payee-new");

  const getTransactions = jest.fn(
    async (_accountId: string, startDate: string, endDate: string) => {
      // A start==end query is the id-recovery lookup after a create.
      if (startDate && startDate === endDate && options.createdRows) {
        return options.createdRows;
      }
      return options.transactions ?? [];
    }
  );

  const runtime = {
    getPayees: jest.fn().mockResolvedValue(
      (options.payees ?? []).map((p) => ({ id: p.id, name: p.name }))
    ),
    getCategories: jest.fn().mockResolvedValue(
      (options.categories ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        group_id: c.group_id ?? "group-1",
      }))
    ),
    getTransactions,
    addTransactions,
    importTransactions,
    createPayee,
  };

  mockGetBrowserApiRuntime.mockResolvedValue(runtime as never);
  return { runtime, addTransactions, importTransactions, createPayee, getTransactions };
}

beforeEach(() => {
  mockGetBrowserApiRuntime.mockReset();
});

describe("listTransactionsForSync (Direct)", () => {
  it("returns sync fields with names resolved and open-ended date bounds", async () => {
    const { getTransactions } = buildFakeRuntime({
      payees: [{ id: "p1", name: "Coffee Bar" }],
      categories: [{ id: "c1", name: "Dining" }],
      transactions: [
        {
          id: "t1",
          account: "acct-src",
          date: "2026-07-01",
          amount: -1250,
          payee: "p1",
          category: "c1",
          notes: "flat white",
          cleared: true,
          reconciled: false,
          imported_id: "bank-1",
        },
      ],
    });

    const transport = createBrowserApiTransport(browserConnection);
    const rows = await transport.listTransactionsForSync({ accountId: "acct-src" });

    expect(getTransactions).toHaveBeenCalledWith("acct-src", "", "");
    expect(rows[0]).toMatchObject({
      id: "t1",
      amount: -1250,
      payeeId: "p1",
      payeeName: "Coffee Bar",
      categoryId: "c1",
      categoryName: "Dining",
      notes: "flat white",
      cleared: true,
      reconciled: false,
      importedId: "bank-1",
      isParent: false,
      splitLines: [],
    });
  });

  it("returns split parents with inline children and skips top-level children", async () => {
    buildFakeRuntime({
      payees: [{ id: "p1", name: "Market" }],
      categories: [
        { id: "cat-a", name: "Groceries" },
        { id: "cat-b", name: "Household" },
      ],
      transactions: [
        {
          id: "parent",
          account: "acct-src",
          date: "2026-07-02",
          amount: -3000,
          payee: "p1",
          is_parent: true,
          subtransactions: [
            { id: "s1", account: "acct-src", date: "2026-07-02", amount: -1000, category: "cat-a" },
            { id: "s2", account: "acct-src", date: "2026-07-02", amount: -2000, category: "cat-b", notes: "soap" },
          ],
        },
        // A stray top-level child should be ignored (already inline in parent).
        { id: "s1", account: "acct-src", date: "2026-07-02", amount: -1000, is_child: true, parent_id: "parent" },
      ],
    });

    const transport = createBrowserApiTransport(browserConnection);
    const rows = await transport.listTransactionsForSync({ accountId: "acct-src" });

    expect(rows).toHaveLength(1);
    expect(rows[0].isParent).toBe(true);
    expect(rows[0].splitLines).toEqual([
      { id: "s1", amount: -1000, payeeId: null, payeeName: null, categoryId: "cat-a", categoryName: "Groceries", notes: null },
      { id: "s2", amount: -2000, payeeId: null, payeeName: null, categoryId: "cat-b", categoryName: "Household", notes: "soap" },
    ]);
  });
});

describe("createOrResolvePayee (Direct)", () => {
  it("matches an existing payee by normalized name without creating", async () => {
    const { createPayee } = buildFakeRuntime({ payees: [{ id: "p1", name: "Coffee Bar" }] });
    const transport = createBrowserApiTransport(browserConnection);

    const resolved = await transport.createOrResolvePayee({ name: "  coffee   bar " });
    expect(resolved).toEqual({ id: "p1", name: "Coffee Bar", created: false });
    expect(createPayee).not.toHaveBeenCalled();
  });

  it("creates a payee when no normalized match exists", async () => {
    const { createPayee } = buildFakeRuntime({ payees: [{ id: "p1", name: "Coffee Bar" }] });
    createPayee.mockResolvedValueOnce("p2");
    const transport = createBrowserApiTransport(browserConnection);

    const resolved = await transport.createOrResolvePayee({ name: "Tea House" });
    expect(resolved).toEqual({ id: "p2", name: "Tea House", created: true });
    expect(createPayee).toHaveBeenCalledWith({ name: "Tea House" });
  });
});

describe("createTransactionsForSync (Direct)", () => {
  it("creates via addTransactions (no reconcile) and recovers the id by imported_id", async () => {
    const { addTransactions, importTransactions, getTransactions } = buildFakeRuntime({
      createdRows: [
        { id: "created-1", account: "acct-tgt", date: "2026-07-01", amount: 1250, imported_id: "sync-marker-1" },
      ],
    });
    const transport = createBrowserApiTransport(browserConnection);

    const result = await transport.createTransactionsForSync([
      {
        accountId: "acct-tgt",
        date: "2026-07-01",
        amount: 1250,
        payeeId: "tp1",
        categoryId: "tc1",
        notes: "Groceries [Synced from Home / Checking]",
        importedId: "sync-marker-1",
      },
    ]);

    // MVP create path is addTransactions, not importTransactions.
    expect(importTransactions).not.toHaveBeenCalled();
    expect(addTransactions).toHaveBeenCalledTimes(1);
    const [accountId, payloads, opts] = addTransactions.mock.calls[0];
    expect(accountId).toBe("acct-tgt");
    expect(opts).toEqual({ learnCategories: false, runTransfers: false });
    expect(payloads[0]).toEqual<ApiImportTransaction>({
      date: "2026-07-01",
      amount: 1250,
      payee: "tp1",
      category: "tc1",
      notes: "Groceries [Synced from Home / Checking]",
      cleared: false,
      imported_id: "sync-marker-1",
    });

    // The id-recovery lookup is a same-day query filtered by the marker.
    expect(getTransactions).toHaveBeenCalledWith("acct-tgt", "2026-07-01", "2026-07-01");
    // The id and the persisted fields are recovered from the same read (no
    // second fetch), so callers can diff planned vs actual cheaply.
    expect(result.created).toEqual([
      {
        requestIndex: 0,
        transactionId: "created-1",
        importedId: "sync-marker-1",
        resolvedPayeeId: "tp1",
        applied: { amount: 1250, date: "2026-07-01", cleared: false, categoryId: null, payeeId: null, notes: null },
      },
    ]);
  });

  it("resolves a missing payee by name before creating the transaction", async () => {
    const { createPayee, addTransactions } = buildFakeRuntime({ payees: [] });
    createPayee.mockResolvedValueOnce("payee-created");
    const transport = createBrowserApiTransport(browserConnection);

    await transport.createTransactionsForSync([
      { accountId: "acct-tgt", date: "2026-07-03", amount: 500, payeeName: "New Vendor" },
    ]);

    expect(createPayee).toHaveBeenCalledWith({ name: "New Vendor" });
    expect(addTransactions.mock.calls[0][1][0].payee).toBe("payee-created");
  });

  it("returns a null id when no marker is supplied (id cannot be recovered)", async () => {
    buildFakeRuntime({});
    const transport = createBrowserApiTransport(browserConnection);

    const result = await transport.createTransactionsForSync([
      { accountId: "acct-tgt", date: "2026-07-03", amount: 500 },
    ]);
    expect(result.created).toEqual([
      { requestIndex: 0, transactionId: null, importedId: null, resolvedPayeeId: null, applied: null },
    ]);
  });
});

describe("getTargetLookupForSync (Direct)", () => {
  it("returns payees and an imported_id -> id index for marker-match dedupe", async () => {
    buildFakeRuntime({
      payees: [{ id: "tp1", name: "Vendor" }],
      transactions: [
        { id: "x1", account: "acct-tgt", date: "2026-07-01", amount: 100, imported_id: "m1" },
        { id: "x2", account: "acct-tgt", date: "2026-07-02", amount: 200 },
      ],
    });
    const transport = createBrowserApiTransport(browserConnection);

    const lookup = await transport.getTargetLookupForSync({ accountId: "acct-tgt" });
    expect(lookup.payees).toEqual([{ id: "tp1", name: "Vendor" }]);
    expect(lookup.importedIdIndex.get("m1")).toBe("x1");
    expect(lookup.importedIdIndex.size).toBe(1);
  });
});

describe("getSyncCapabilities", () => {
  it("reports Direct capabilities for browser connections", () => {
    const transport = createBrowserApiTransport(browserConnection);
    const report = transport.getSyncCapabilities();
    expect(report.supported).toBe(true);
    expect(report.capabilities.createTransactionWithImportedId).toBe(true);
  });

  it("supports entity sync over HTTP but still refuses transaction primitives", async () => {
    const transport = createHttpApiTransport(httpConnection);
    const caps = transport.getSyncCapabilities();
    // HTTP now supports master-data sync (payees/categories)…
    expect(caps.supported).toBe(true);
    expect(caps.capabilities.createPayee).toBe(true);
    // …but transaction sync is not implemented yet (RD-060 Phase 2).
    expect(caps.capabilities.listTransactions).toBe(false);
    expect(() => transport.listTransactionsForSync({ accountId: "a" })).toThrow();
    expect(() => transport.createOrResolvePayee({ name: "x" })).toThrow();
    expect(() => transport.createTransactionsForSync([])).toThrow();
    expect(() => transport.getTargetLookupForSync({ accountId: "a" })).toThrow();
  });
});

import {
  createHttpTransactionsForSync,
  createOrResolveHttpPayee,
  getHttpTargetLookupForSync,
  listHttpTransactionsForSync,
} from "./httpSyncTransactions";
import { apiRequest } from "../api/client";
import type { ConnectionInstance } from "@/store/connection";

jest.mock("../api/client", () => ({ apiRequest: jest.fn() }));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const connection = {
  id: "conn-http",
  label: "Family",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "key",
  budgetSyncId: "budget-http",
} as ConnectionInstance;

type RawRow = Record<string, unknown>;

/**
 * Routes `apiRequest(connection, path, opts)` to fixtures by path + method. The
 * batch POST captures inserted rows so the follow-up read-back can echo them
 * with recovered ids (mirroring actual-http-api's plain insert).
 */
function mockApi(options: {
  payees?: { id: string; name: string }[];
  categories?: { id: string; name: string }[];
  transactions?: RawRow[];
}) {
  const payees = [...(options.payees ?? [])];
  const byAccount = new Map<string, RawRow[]>();
  for (const t of options.transactions ?? []) {
    const acct = String(t.account);
    byAccount.set(acct, [...(byAccount.get(acct) ?? []), t]);
  }
  let nextId = 1;

  mockApiRequest.mockImplementation(async (_conn, path, opts) => {
    const method = opts?.method ?? "GET";
    if (path === "/payees" && method === "GET") {
      return { data: payees.map((p) => ({ id: p.id, name: p.name })) } as never;
    }
    if (path === "/payees" && method === "POST") {
      const name = (opts?.body as { payee: { name: string } }).payee.name;
      const created = { id: `payee-${nextId++}`, name };
      payees.push(created);
      return { data: created } as never;
    }
    if (path === "/categorygroups") {
      return {
        data: [
          {
            id: "group-1",
            name: "Group",
            categories: (options.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
          },
        ],
      } as never;
    }
    const batch = path.match(/^\/accounts\/([^/]+)\/transactions\/batch$/);
    if (batch && method === "POST") {
      const acct = batch[1];
      const rows = byAccount.get(acct) ?? [];
      for (const t of (opts?.body as { transactions: RawRow[] }).transactions) {
        rows.push({ ...t, id: `txn-${nextId++}`, account: acct });
      }
      byAccount.set(acct, rows);
      return { message: "ok" } as never;
    }
    const list = path.match(/^\/accounts\/([^/]+)\/transactions/);
    if (list && method === "GET") {
      const acct = list[1];
      const since = /since_date=([^&]+)/.exec(path)?.[1];
      const rows = (byAccount.get(acct) ?? []).filter(
        (r) => !since || String(r.date) >= decodeURIComponent(since)
      );
      return { data: rows } as never;
    }
    throw new Error(`unexpected request: ${method} ${path}`);
  });
}

beforeEach(() => mockApiRequest.mockReset());

describe("listHttpTransactionsForSync", () => {
  it("maps snake_case rows and resolves payee/category names, dropping split children", async () => {
    mockApi({
      payees: [{ id: "p1", name: "Coffee Bar" }],
      categories: [{ id: "c1", name: "Dining" }],
      transactions: [
        { id: "t1", account: "acct-src", date: "2026-01-05", amount: -500, payee: "p1", category: "c1", notes: "hi", cleared: true, reconciled: false, imported_id: "m1", is_parent: false, is_child: false, parent_id: null },
        { id: "t2", account: "acct-src", date: "2026-01-06", amount: -800, payee: null, category: null, notes: null, cleared: false, reconciled: false, imported_id: null, is_parent: true, is_child: false, parent_id: null, subtransactions: [{ id: "s1", amount: -300, payee: "p1", category: "c1", notes: "part" }] },
        { id: "t3", account: "acct-src", date: "2026-01-06", amount: -300, payee: null, category: "c1", notes: null, cleared: false, reconciled: false, imported_id: null, is_parent: false, is_child: true, parent_id: "t2" },
      ],
    });

    const rows = await listHttpTransactionsForSync(connection, { accountId: "acct-src" });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "t1", payeeName: "Coffee Bar", categoryName: "Dining", importedId: "m1", cleared: true });
    expect(rows[1]).toMatchObject({ id: "t2", isParent: true });
    expect(rows[1].splitLines).toEqual([
      expect.objectContaining({ id: "s1", amount: -300, payeeName: "Coffee Bar", categoryName: "Dining" }),
    ]);
  });

  it("filters by endDate inclusively", async () => {
    mockApi({
      transactions: [
        { id: "a", account: "acct-src", date: "2026-01-05", amount: -1, payee: null, category: null, notes: null, cleared: true, reconciled: false, imported_id: null, is_parent: false, is_child: false, parent_id: null },
        { id: "b", account: "acct-src", date: "2026-02-01", amount: -1, payee: null, category: null, notes: null, cleared: true, reconciled: false, imported_id: null, is_parent: false, is_child: false, parent_id: null },
      ],
    });

    const rows = await listHttpTransactionsForSync(connection, { accountId: "acct-src", endDate: "2026-01-31" });
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("getHttpTargetLookupForSync", () => {
  it("builds the imported_id index and lightweight transaction list", async () => {
    mockApi({
      payees: [{ id: "p1", name: "Grocer" }],
      transactions: [
        { id: "x1", account: "acct-tgt", date: "2026-01-05", amount: -500, payee: "p1", category: "c9", notes: null, cleared: true, reconciled: false, imported_id: "marker-1", is_parent: false, is_child: false, parent_id: null },
      ],
    });

    const lookup = await getHttpTargetLookupForSync(connection, { accountId: "acct-tgt" });
    expect(lookup.importedIdIndex.get("marker-1")).toBe("x1");
    expect(lookup.transactions).toEqual([
      { id: "x1", date: "2026-01-05", amount: -500, payeeName: "Grocer", categoryId: "c9" },
    ]);
    expect(lookup.payees).toEqual([{ id: "p1", name: "Grocer" }]);
  });
});

describe("createOrResolveHttpPayee", () => {
  it("matches an existing payee by normalized name without creating", async () => {
    mockApi({ payees: [{ id: "p1", name: "Coffee Bar" }] });
    const resolved = await createOrResolveHttpPayee(connection, "  coffee   bar ");
    expect(resolved).toEqual({ id: "p1", name: "Coffee Bar", created: false });
  });

  it("creates a payee when none matches", async () => {
    mockApi({ payees: [] });
    const resolved = await createOrResolveHttpPayee(connection, "Tea House");
    expect(resolved).toMatchObject({ name: "Tea House", created: true });
    expect(resolved.id).toMatch(/^payee-/);
  });
});

describe("createHttpTransactionsForSync", () => {
  it("resolves payees once, batch-inserts, and recovers ids by imported_id", async () => {
    mockApi({ payees: [{ id: "p1", name: "Grocer" }] });

    const result = await createHttpTransactionsForSync(connection, [
      { accountId: "acct-tgt", date: "2026-01-05", amount: -500, payeeName: "Grocer", categoryId: "c1", notes: "n", importedId: "m1" },
      { accountId: "acct-tgt", date: "2026-01-06", amount: -900, payeeName: "New Shop", importedId: "m2" },
    ]);

    expect(result.created).toHaveLength(2);
    expect(result.created[0]).toMatchObject({ requestIndex: 0, importedId: "m1", resolvedPayeeId: "p1" });
    expect(result.created[0].transactionId).toMatch(/^txn-/);
    expect(result.created[0].applied).toMatchObject({ amount: -500, date: "2026-01-05", categoryId: "c1", payeeId: "p1", notes: "n" });
    // Second row's payee was created on the fly and reused.
    expect(result.created[1].resolvedPayeeId).toMatch(/^payee-/);
    expect(result.created[1].importedId).toBe("m2");

    // One batch POST (not one call per row).
    const batchCalls = mockApiRequest.mock.calls.filter(
      ([, path, opts]) => path.endsWith("/transactions/batch") && opts?.method === "POST"
    );
    expect(batchCalls).toHaveLength(1);
    expect((batchCalls[0][2]?.body as { transactions: unknown[] }).transactions).toHaveLength(2);
  });

  it("returns empty for no inputs without calling the API", async () => {
    mockApi({});
    const result = await createHttpTransactionsForSync(connection, []);
    expect(result.created).toEqual([]);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("groups inputs by account: one batch POST per account with correct rows and indices", async () => {
    mockApi({ payees: [{ id: "p1", name: "Grocer" }] });

    const result = await createHttpTransactionsForSync(connection, [
      { accountId: "acct-a", date: "2026-01-05", amount: -100, payeeName: "Grocer", importedId: "a1" },
      { accountId: "acct-b", date: "2026-01-06", amount: -200, payeeName: "Grocer", importedId: "b1" },
      { accountId: "acct-a", date: "2026-01-07", amount: -300, payeeName: "Grocer", importedId: "a2" },
    ]);

    // Results are keyed back to the original request index regardless of account.
    expect(result.created.map((c) => c.requestIndex)).toEqual([0, 1, 2]);
    expect(result.created.map((c) => c.importedId)).toEqual(["a1", "b1", "a2"]);
    expect(result.created.every((c) => (c.transactionId ?? "").startsWith("txn-"))).toBe(true);
    expect(result.created[0].applied).toMatchObject({ amount: -100, date: "2026-01-05" });
    expect(result.created[1].applied).toMatchObject({ amount: -200, date: "2026-01-06" });

    // One batch POST per account, each carrying only that account's rows.
    const batchCalls = mockApiRequest.mock.calls.filter(
      ([, path, opts]) => path.endsWith("/transactions/batch") && opts?.method === "POST"
    );
    const byPath = new Map(batchCalls.map(([, path, opts]) => [path, (opts?.body as { transactions: { imported_id: string }[] }).transactions]));
    expect(byPath.get("/accounts/acct-a/transactions/batch")?.map((t) => t.imported_id)).toEqual(["a1", "a2"]);
    expect(byPath.get("/accounts/acct-b/transactions/batch")?.map((t) => t.imported_id)).toEqual(["b1"]);
  });
});

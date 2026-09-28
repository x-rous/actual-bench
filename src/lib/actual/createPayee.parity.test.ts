import { getBrowserApiRuntime } from "./browser/runtime";
import { createBrowserApiTransport } from "./browserApiTransport";
import { createHttpApiTransport } from "./httpApiTransport";
import { apiRequest } from "../api/client";
import { createFakeActualBudget } from "./testing/fakeActualBudget";
import { payeeAdapter } from "@/lib/sync/adapters/payeeAdapter";
import { createReconciliationTransport } from "@/lib/reconciliation/transportAdapter";
import { executeApplyPlan } from "@/lib/reconciliation/apply/executor";
import type { ApplyOperation } from "@/lib/reconciliation/apply/operations";
import type { ActualBenchTransport } from "./transport";
import type { JsonObject, SyncFlow } from "@/lib/app-db/types";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";

/**
 * Creating a payee returns its id in both transports.
 *
 * actual-http-api answers POST /payees with the new id alone (`{ data: "<id>" }`).
 * The HTTP transport used to read that as a payee object and hand callers an
 * undefined id: Budget File Sync recorded no target, reconciliation wrote rows
 * with no payee, and a batch naming the same new payee twice created it twice.
 * These run each caller over one fake budget per transport and compare.
 */

jest.mock("./browser/runtime", () => ({
  getBrowserApiRuntime: jest.fn(),
  syncBrowserApiRuntime: jest.fn(),
}));
jest.mock("../api/client", () => ({ apiRequest: jest.fn() }));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockGetBrowserApiRuntime = getBrowserApiRuntime as jest.MockedFunction<typeof getBrowserApiRuntime>;

const browserConnection: BrowserApiConnection = {
  id: "conn-direct",
  label: "Home",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "pw",
  budgetSyncId: "budget-1",
};

const httpConnection: HttpApiConnection = {
  id: "conn-http",
  label: "Home",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "key",
  budgetSyncId: "budget-1",
};

const accounts = [{ id: "acct-chk", name: "Checking" }];

type Mode = "direct" | "http";

function setup(mode: Mode) {
  const budget = createFakeActualBudget({ accounts, payees: [{ id: "p-coffee", name: "Coffee Bar" }] });
  let transport: ActualBenchTransport;
  if (mode === "direct") {
    mockGetBrowserApiRuntime.mockResolvedValue(budget.directRuntime() as never);
    transport = createBrowserApiTransport(browserConnection);
  } else {
    mockApiRequest.mockImplementation(budget.httpApiRequest as never);
    transport = createHttpApiTransport(httpConnection);
  }
  const named = (name: string) => budget.payees().filter((p) => p.name === name);
  return { budget, transport, named };
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockGetBrowserApiRuntime.mockReset();
});

describe.each<Mode>(["direct", "http"])("payee creation (%s)", (mode) => {
  it("createPayee returns the id of the payee it created", async () => {
    const { transport, named } = setup(mode);
    const created = await transport.createPayee({ name: "Tea House" });
    const [stored] = named("Tea House");
    expect(created).toEqual({ id: stored.id, name: "Tea House" });
  });

  it("createOrResolvePayee creates once, then resolves the same id", async () => {
    const { transport, named } = setup(mode);
    const first = await transport.createOrResolvePayee({ name: "Tea House" });
    const second = await transport.createOrResolvePayee({ name: "tea house" });
    expect(first).toEqual({ id: named("Tea House")[0].id, name: "Tea House", created: true });
    expect(second).toEqual({ id: first.id, name: "Tea House", created: false });
    expect(named("Tea House")).toHaveLength(1);
  });

  it("a batch naming one new payee on two rows creates it once and uses its id on both", async () => {
    const { budget, transport, named } = setup(mode);
    const result = await transport.createTransactionsForSync([
      { accountId: "acct-chk", date: "2026-07-01", amount: -500, payeeName: "Tea House", importedId: "m1" },
      { accountId: "acct-chk", date: "2026-07-02", amount: -700, payeeName: "Tea House", importedId: "m2" },
    ]);
    const payees = named("Tea House");
    expect(payees).toHaveLength(1);
    expect(budget.rows().map((r) => r.payee)).toEqual([payees[0].id, payees[0].id]);
    expect(result.created.map((c) => c.resolvedPayeeId)).toEqual([payees[0].id, payees[0].id]);
  });

  it("Budget File Sync payee create records the created payee as the target", async () => {
    const { transport, named } = setup(mode);
    const results = await payeeAdapter.createBatch(transport, {} as SyncFlow, [
      { itemId: "i1", payload: { entity: "payee", name: "New Vendor" } as JsonObject },
    ]);
    expect(named("New Vendor")).toHaveLength(1);
    expect(results).toEqual([{ itemId: "i1", targetId: named("New Vendor")[0].id, changedFields: [] }]);
  });

  it("Bank Statement Reconciliation writes a new payee once and books the row to it", async () => {
    const { budget, transport, named } = setup(mode);
    const recon = createReconciliationTransport(transport);
    const create = (id: string, date: string): ApplyOperation => ({
      id: `create:${id}`,
      kind: "create",
      itemId: id,
      statementRowId: `s-${id}`,
      accountId: "acct-chk",
      date,
      amount: -6850,
      payeeId: null,
      payeeName: "DUBAI TAXI",
      importedPayee: null,
      categoryId: null,
      notes: null,
      marker: `recon:${id}`,
    });

    const resolved = await recon.resolvePayee({ name: "DUBAI TAXI" });
    const result = await executeApplyPlan({
      plan: {
        operations: [create("i1", "2026-07-12"), create("i2", "2026-07-13")],
        alreadyApplied: 0,
        noWriteMatches: 0,
        unresolved: 0,
        blocked: [],
        unreconciledDifferences: [],
      },
      transport: recon,
    });

    expect(result.applied).toBe(2);
    expect(named("DUBAI TAXI")).toHaveLength(1);
    expect(resolved.id).toBe(named("DUBAI TAXI")[0].id);
    expect(budget.rows().map((r) => r.payee)).toEqual([resolved.id, resolved.id]);
  });
});

it("Direct and HTTP return the same logical result for every create path", async () => {
  async function run(mode: Mode) {
    const { transport } = setup(mode);
    const created = await transport.createPayee({ name: "Tea House" });
    const resolved = await transport.createOrResolvePayee({ name: "Tea House" });
    const fresh = await transport.createOrResolvePayee({ name: "Book Shop" });
    // Ids are generated per budget; compare shape and reuse, not the literal id.
    return {
      created: { name: created.name, hasId: typeof created.id === "string" && created.id !== "" },
      resolved: { name: resolved.name, created: resolved.created, sameId: resolved.id === created.id },
      fresh: { name: fresh.name, created: fresh.created, hasId: typeof fresh.id === "string" && fresh.id !== "" },
    };
  }
  expect(await run("http")).toEqual(await run("direct"));
});

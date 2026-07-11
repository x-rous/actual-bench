import { connectionFingerprint } from "./connectionRef";
import { runLiveDryRunPreview, type PreviewStore, type PreviewTransportProvider } from "./previewOrchestrator";
import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import type { BrowserApiConnection, ConnectionInstance, HttpApiConnection } from "@/store/connection";
import type { CategoryGroupsResponse } from "@/lib/api/categoryGroups";
import type { JsonObject, SyncFlow, SyncMapping } from "@/lib/app-db/types";
import type { SyncPlanResult } from "./plannedChanges";

const sourceConn: BrowserApiConnection = {
  id: "src", label: "Home", mode: "browser-api", baseUrl: "https://src.example.com", serverPassword: "pw", budgetSyncId: "budget-src",
};
const targetConn: BrowserApiConnection = {
  id: "tgt", label: "Family", mode: "browser-api", baseUrl: "https://tgt.example.com", serverPassword: "pw", budgetSyncId: "budget-tgt",
};
// An HTTP connection to the SAME target budget (budget-tgt) via a different
// URL/mode - the cross-mode scenario budget-identity matching enables.
const httpTarget: HttpApiConnection = {
  id: "http", label: "Http", mode: "http-api", baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: "budget-tgt",
};

type FlowOverrides = { enabled?: boolean; filterData?: JsonObject; targetConnection?: ConnectionInstance };

function makeFlow(overrides: FlowOverrides = {}): SyncFlow {
  const target = overrides.targetConnection ?? targetConn;
  return {
    id: "flow-1",
    name: "Cross-budget",
    enabled: overrides.enabled ?? true,
    flowType: "transaction_sync",
    description: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    legs: [
      {
        id: "leg-1",
        flowId: "flow-1",
        position: 0,
        sourceRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(sourceConn), budgetId: "budget-src", accountId: "acct-src", budgetName: "Home", accountName: "Checking" } },
        targetRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(target), budgetId: "budget-tgt", accountId: "acct-tgt" } },
        filter: { version: 1, data: overrides.filterData ?? {} },
        transform: { version: 1, data: {} },
        options: { version: 1, data: {} },
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  };
}

const events: string[] = [];

type TransportFixture = {
  sourceTransactions?: SyncSourceTransaction[];
  targetTransactions?: SyncSourceTransaction[];
  targetPayees?: { id: string; name: string }[];
  targetCategories?: { id: string; name: string }[];
  importedIdIndex?: Map<string, string>;
  failSourceRead?: boolean;
};

function makeTransport(kind: "source" | "target", fx: TransportFixture): ActualBenchTransport {
  const categoryGroups: CategoryGroupsResponse = {
    groups: [],
    categories: (fx.targetCategories ?? []).map((c) => ({ id: c.id, name: c.name, groupId: "g", isIncome: false, hidden: false })),
  };
  return {
    mode: kind === "source" ? "browser-api" : "browser-api",
    listTransactionsForSync: jest.fn(async () => {
      events.push(`list:${kind}`);
      if (kind === "source") {
        if (fx.failSourceRead) throw new Error("source boom");
        return fx.sourceTransactions ?? [];
      }
      return fx.targetTransactions ?? [];
    }),
    getTargetLookupForSync: jest.fn(async () => {
      events.push(`lookup:${kind}`);
      return {
        payees: fx.targetPayees ?? [],
        importedIdIndex: fx.importedIdIndex ?? new Map(),
        transactions: (fx.targetTransactions ?? []).map((t) => ({
          id: t.id, date: t.date, amount: t.amount, payeeName: t.payeeName, categoryId: t.categoryId,
        })),
      };
    }),
    getCategoryGroups: jest.fn(async () => categoryGroups),
  } as unknown as ActualBenchTransport;
}

function makeStore(flow: SyncFlow | null, opts: { mappings?: SyncMapping[]; persistThrows?: boolean } = {}) {
  const persistPlan = jest.fn(async (plan: SyncPlanResult) => {
    if (opts.persistThrows) throw new Error("db down");
    return { runId: "run-123", plan };
  });
  const persistFailedRun = jest.fn(async () => "failed-run-1");
  const store: PreviewStore = {
    loadFlow: jest.fn(async () => flow),
    loadMappings: jest.fn(async () => opts.mappings ?? []),
    persistPlan,
    persistFailedRun,
  };
  return { store, persistPlan, persistFailedRun };
}

function makeProvider(sourceT: ActualBenchTransport, targetT: ActualBenchTransport): PreviewTransportProvider {
  return {
    openTransport: jest.fn(async (connection: ConnectionInstance) => {
      if (connection.id === sourceConn.id) {
        events.push("open:source");
        return sourceT;
      }
      events.push("open:target");
      return targetT;
    }),
  };
}

function srcTxn(overrides: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction {
  return {
    id: "t1", accountId: "acct-src", date: "2026-07-10", amount: -1250,
    payeeId: "sp1", payeeName: "Coffee Bar", categoryId: "sc1", categoryName: "Dining",
    notes: "flat white", cleared: true, reconciled: false, importedId: null,
    isParent: false, isChild: false, parentId: null, splitLines: [], ...overrides,
  };
}

beforeEach(() => {
  events.length = 0;
});

describe("runLiveDryRunPreview - happy path", () => {
  it("reads source fully before opening the target, then plans and persists", async () => {
    const source = makeTransport("source", { sourceTransactions: [srcTxn()] });
    const target = makeTransport("target", { targetPayees: [{ id: "tp1", name: "Coffee Bar" }], targetCategories: [{ id: "tc1", name: "Dining" }] });
    const { store, persistPlan } = makeStore(makeFlow());

    const result = await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: sourceConn, targetConnection: targetConn } },
      { transport: makeProvider(source, target), store }
    );

    expect(result.status).toBe("draft_preview");
    if (result.status !== "draft_preview") return;
    expect(result.runId).toBe("run-123");
    expect(result.summary.createCandidates).toBe(1);
    expect(result.summary.sourceTransactionsScanned).toBe(1);
    expect(persistPlan).toHaveBeenCalledTimes(1);

    // Pattern A: every source event precedes opening the target; no source
    // reads happen after the target is opened.
    const openTargetAt = events.indexOf("open:target");
    expect(events.slice(0, openTargetAt)).toEqual(["open:source", "list:source"]);
    expect(events.slice(openTargetAt)).not.toContain("list:source");
    // the plan received the create candidate with resolved target payee/category
    const plan = persistPlan.mock.calls[0][0];
    expect(plan.items[0].plannedTargetPayload).toMatchObject({ payeeId: "tp1", categoryId: "tc1", amount: 1250 });
  });

  it("excludes generated source transactions and reports the count", async () => {
    const gen = srcTxn({ id: "g", notes: "x [Synced from Home / Checking]" });
    const source = makeTransport("source", { sourceTransactions: [srcTxn({ id: "a" }), gen] });
    const target = makeTransport("target", {});
    const { store, persistPlan } = makeStore(makeFlow());

    const result = await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: sourceConn, targetConnection: targetConn } },
      { transport: makeProvider(source, target), store }
    );

    if (result.status !== "draft_preview") throw new Error("expected preview");
    expect(result.summary.generatedTransactionsExcluded).toBe(1);
    expect(persistPlan.mock.calls[0][0].items).toHaveLength(1);
  });

  it("applies source filters before planning", async () => {
    const source = makeTransport("source", {
      sourceTransactions: [srcTxn({ id: "a", date: "2026-07-01" }), srcTxn({ id: "b", date: "2026-07-20" })],
    });
    const target = makeTransport("target", {});
    const { store, persistPlan } = makeStore(makeFlow({ filterData: { startDate: "2026-07-10", endDate: "2026-07-31" } }));

    await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: sourceConn, targetConnection: targetConn } },
      { transport: makeProvider(source, target), store }
    );
    const plan = persistPlan.mock.calls[0][0];
    expect(plan.items.map((i) => i.sourceTransactionId)).toEqual(["b"]);
  });

  it("passes loaded mappings into the planner (already-synced skip)", async () => {
    const source = makeTransport("source", { sourceTransactions: [srcTxn()] });
    const target = makeTransport("target", {});
    const mapping = {
      sourceItemKey: "txn:t1",
      // fingerprint must match the planner's computed one; use a mapping that
      // forces the source_changed path deterministically instead.
      sourceFingerprint: "will-not-match",
      targetTransactionId: "tt1",
    } as unknown as SyncMapping;
    const { store, persistPlan } = makeStore(makeFlow(), { mappings: [mapping] });

    await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: sourceConn, targetConnection: targetConn } },
      { transport: makeProvider(source, target), store }
    );
    const plan = persistPlan.mock.calls[0][0];
    expect(plan.items[0].classification).toBe("source_changed_since_sync");
    expect(store.loadMappings).toHaveBeenCalledWith("flow-1");
  });
});

describe("runLiveDryRunPreview - validation", () => {
  it("returns flow_not_found with no run when the flow is missing", async () => {
    const { store, persistPlan, persistFailedRun } = makeStore(null);
    const result = await runLiveDryRunPreview(
      { flowId: "missing", context: { sourceConnection: sourceConn, targetConnection: targetConn } },
      { transport: makeProvider(makeTransport("source", {}), makeTransport("target", {})), store }
    );
    expect(result).toMatchObject({ status: "failed", runId: null, error: { code: "flow_not_found" } });
    expect(persistPlan).not.toHaveBeenCalled();
    expect(persistFailedRun).not.toHaveBeenCalled();
  });

  it("returns flow_disabled unless allowDisabled is set", async () => {
    const { store } = makeStore(makeFlow({ enabled: false }));
    const provider = makeProvider(makeTransport("source", {}), makeTransport("target", {}));
    const result = await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: sourceConn, targetConnection: targetConn } },
      { transport: provider, store }
    );
    expect(result).toMatchObject({ status: "failed", error: { code: "flow_disabled" } });
    expect(provider.openTransport).not.toHaveBeenCalled();
  });

  it("previews a Direct-built flow through an HTTP connection to the same budget (RD-060 Phase 2)", async () => {
    // Flow saved in Direct mode (targetRef fingerprint = Direct); the preview runs
    // over an HTTP connection to the same budget-tgt. Budget-identity matching accepts it.
    const { store } = makeStore(makeFlow());
    const result = await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: sourceConn, targetConnection: httpTarget } },
      { transport: makeProvider(makeTransport("source", { sourceTransactions: [srcTxn()] }), makeTransport("target", {})), store }
    );
    expect(result.status).toBe("draft_preview");
  });

  it("rejects a connection that points at a different budget", async () => {
    const { store } = makeStore(makeFlow());
    const otherSource: BrowserApiConnection = { ...sourceConn, budgetSyncId: "budget-other" };
    const result = await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: otherSource, targetConnection: targetConn } },
      { transport: makeProvider(makeTransport("source", {}), makeTransport("target", {})), store }
    );
    expect(result).toMatchObject({ status: "failed", error: { code: "connection_mismatch" } });
  });
});

describe("runLiveDryRunPreview - failure handling", () => {
  it("persists a failed run when source reads throw after validation", async () => {
    const source = makeTransport("source", { failSourceRead: true });
    const { store, persistFailedRun } = makeStore(makeFlow());
    const result = await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: sourceConn, targetConnection: targetConn } },
      { transport: makeProvider(source, makeTransport("target", {})), store }
    );
    expect(result).toMatchObject({ status: "failed", runId: "failed-run-1", error: { code: "source_load_failed" } });
    expect(persistFailedRun).toHaveBeenCalledTimes(1);
  });

  it("still returns a clean failure when persistence itself fails", async () => {
    const source = makeTransport("source", { sourceTransactions: [srcTxn()] });
    const { store, persistFailedRun } = makeStore(makeFlow(), { persistThrows: true });
    const result = await runLiveDryRunPreview(
      { flowId: "flow-1", context: { sourceConnection: sourceConn, targetConnection: targetConn } },
      { transport: makeProvider(source, makeTransport("target", {})), store }
    );
    expect(result).toMatchObject({ status: "failed", error: { code: "persistence_failed" } });
    expect(persistFailedRun).toHaveBeenCalledTimes(1);
  });
});

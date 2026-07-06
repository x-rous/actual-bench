import { connectionFingerprint } from "./connectionRef";
import { applySyncRun, type ApplyStore, type ApplyTransportProvider } from "./applyOrchestrator";
import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import type { JsonObject, SyncFlow, SyncFlowRun, SyncFlowRunItem, SyncMapping, SyncMappingInput } from "@/lib/app-db/types";

const targetConn: BrowserApiConnection = {
  id: "tgt", label: "Family", mode: "browser-api", baseUrl: "https://tgt.example.com", serverPassword: "pw", budgetSyncId: "budget-tgt",
};
const httpTarget: HttpApiConnection = {
  id: "http", label: "Http", mode: "http-api", baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: "budget-http",
};

// --- Fixtures ---------------------------------------------------------------

function makeFlow(): SyncFlow {
  return {
    id: "flow-1", name: "Cross-budget", enabled: true, flowType: "transaction_sync",
    description: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    legs: [
      {
        id: "leg-1", flowId: "flow-1", position: 0,
        sourceRef: { version: 1, data: { connectionFingerprint: "src-fp", budgetId: "budget-src", accountId: "acct-src", budgetName: "Home", accountName: "Checking" } },
        targetRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(targetConn), budgetId: "budget-tgt", accountId: "acct-tgt" } },
        filter: { version: 1, data: {} }, transform: { version: 1, data: {} }, options: { version: 1, data: {} },
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  };
}

function runItem(overrides: Partial<SyncFlowRunItem> = {}): SyncFlowRunItem {
  const payload: JsonObject = {
    accountId: "acct-tgt", date: "2026-07-10", amount: 1250,
    payeeId: null, payeeName: "Coffee Bar", categoryId: "tc1",
    notes: "flat white [Synced from Home / Checking]", cleared: false,
    importedId: "absync:flow-1:txn:t1",
    ...(overrides as { payloadData?: JsonObject }).payloadData,
  };
  return {
    id: "item-1", runId: "run-1", flowId: "flow-1", legId: null, sequence: 0,
    sourceItemRef: { version: 1, data: {} }, targetItemRef: null,
    status: "planned", message: null,
    sourceEntityType: "transaction", sourceItemKey: "txn:t1",
    sourceTransactionId: "t1", sourceSplitId: null, sourceFingerprint: "fp1",
    plannedAction: "create", plannedTargetPayload: { version: 1, data: payload },
    classification: "new", duplicateConfidence: "none",
    warnings: null, errors: null, selectedForApply: true, applyState: "pending",
    createdTargetTransactionId: null, createdTargetMarker: null,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: null,
    ...overrides,
  };
}

// --- Fake target budget -----------------------------------------------------

function targetRow(overrides: Partial<SyncSourceTransaction>): SyncSourceTransaction {
  return {
    id: "x", accountId: "acct-tgt", date: "2026-07-10", amount: 1250,
    payeeId: null, payeeName: null, categoryId: null, categoryName: null,
    notes: null, cleared: false, reconciled: false, importedId: null,
    isParent: false, isChild: false, parentId: null, splitLines: [], ...overrides,
  };
}

type TargetOptions = {
  preloaded?: SyncSourceTransaction[];
  ruleMutate?: (input: { categoryId: string | null; payeeId: string | null; notes: string | null }) => Partial<SyncSourceTransaction>;
  resolveFails?: boolean;
};

function makeTargetTransport(opts: TargetOptions = {}) {
  const rows: SyncSourceTransaction[] = [...(opts.preloaded ?? [])];
  const createPayee = jest.fn(async ({ name }: { name: string }) => ({ id: "payee-" + name, name, created: true }));
  let counter = 0;

  const createTransactionsForSync = jest.fn(async (inputs: Array<{ accountId: string; date: string; amount: number; payeeId?: string | null; categoryId?: string | null; notes?: string | null; cleared?: boolean; importedId?: string | null }>) => {
    const created = inputs.map((inp, i) => {
      if (opts.resolveFails) {
        return { requestIndex: i, transactionId: null, importedId: inp.importedId ?? null };
      }
      counter += 1;
      const id = "tt" + counter;
      const ruled = opts.ruleMutate ? opts.ruleMutate({ categoryId: inp.categoryId ?? null, payeeId: inp.payeeId ?? null, notes: inp.notes ?? null }) : {};
      rows.push(targetRow({
        id, date: inp.date, amount: inp.amount, payeeId: inp.payeeId ?? null,
        categoryId: inp.categoryId ?? null, notes: inp.notes ?? null, cleared: inp.cleared ?? false,
        importedId: inp.importedId ?? null, ...ruled,
      }));
      return { requestIndex: i, transactionId: id, importedId: inp.importedId ?? null };
    });
    return { created };
  });

  const transport = {
    createOrResolvePayee: createPayee,
    createTransactionsForSync,
    getTargetLookupForSync: jest.fn(async () => ({
      payees: [],
      importedIdIndex: new Map(rows.filter((r) => r.importedId).map((r) => [r.importedId as string, r.id])),
    })),
    listTransactionsForSync: jest.fn(async ({ startDate, endDate }: { startDate?: string; endDate?: string }) =>
      rows.filter((r) => (!startDate || r.date >= startDate) && (!endDate || r.date <= endDate))
    ),
  } as unknown as ActualBenchTransport;

  return { transport, rows, createPayee, createTransactionsForSync };
}

// --- Fake store -------------------------------------------------------------

function makeStore(opts: { runStatus?: string; items?: SyncFlowRunItem[]; seedMappings?: SyncMapping[] } = {}) {
  const run: SyncFlowRun = {
    id: "run-1", flowId: "flow-1", status: opts.runStatus ?? "draft_preview",
    startedAt: "2026-07-01T00:00:00.000Z", finishedAt: null,
    summary: { version: 1, data: {} }, error: null, createdByTrigger: "manual_preview",
    sourceSnapshotSummary: null, targetSnapshotSummary: null, counts: null,
  };
  const items = opts.items ?? [runItem()];
  const mappings = new Map<string, SyncMapping>();
  for (const m of opts.seedMappings ?? []) mappings.set(m.flowId + "|" + m.sourceItemKey, m);
  const createdMappings: SyncMappingInput[] = [];
  const itemPatches = new Map<string, unknown>();

  const store: ApplyStore = {
    loadRun: jest.fn(async () => run),
    loadRunItems: jest.fn(async () => items),
    loadFlow: jest.fn(async () => makeFlow()),
    getMappingBySource: jest.fn(async (flowId, key) => mappings.get(flowId + "|" + key) ?? null),
    createMapping: jest.fn(async (input) => {
      createdMappings.push(input);
      mappings.set(input.flowId + "|" + input.sourceItemKey, { ...(input as unknown as SyncMapping) });
    }),
    updateRunStatus: jest.fn(async (_runId, patch) => {
      run.status = patch.status;
    }),
    updateRunItemStatus: jest.fn(async (itemId, patch) => {
      itemPatches.set(itemId, patch);
    }),
    persistApplyFailure: jest.fn(async () => {}),
  };
  return { store, run, createdMappings, itemPatches };
}

const provider = (transport: ActualBenchTransport): ApplyTransportProvider => ({
  openTransport: jest.fn(async () => transport),
});

// --- Tests ------------------------------------------------------------------

describe("applySyncRun — validation", () => {
  it("fails when the run does not exist", async () => {
    const store = makeStore();
    store.store.loadRun = jest.fn(async () => null);
    const { transport } = makeTargetTransport();
    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store: store.store });
    expect(result).toMatchObject({ status: "failed", error: { code: "run_not_found" } });
    expect(store.store.updateRunStatus).not.toHaveBeenCalled();
  });

  it("refuses to apply a run that is not in draft_preview", async () => {
    const { store } = makeStore({ runStatus: "applied" });
    const { transport, createTransactionsForSync } = makeTargetTransport();
    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(result).toMatchObject({ status: "failed", error: { code: "run_not_applyable" } });
    expect(createTransactionsForSync).not.toHaveBeenCalled();
  });

  it("rejects an unsupported HTTP target", async () => {
    const { store } = makeStore();
    const { transport } = makeTargetTransport();
    const result = await applySyncRun({ runId: "run-1", targetConnection: httpTarget }, { transport: provider(transport), store });
    expect(result).toMatchObject({ status: "failed", error: { code: "unsupported_connection" } });
  });

  it("rejects a target that no longer matches the saved route", async () => {
    const { store } = makeStore();
    const { transport } = makeTargetTransport();
    const other: BrowserApiConnection = { ...targetConn, baseUrl: "https://elsewhere.example.com" };
    const result = await applySyncRun({ runId: "run-1", targetConnection: other }, { transport: provider(transport), store });
    expect(result).toMatchObject({ status: "failed", error: { code: "route_mismatch" } });
  });

  it("rejects explicitly selecting an ineligible (non-new) item", async () => {
    const { store } = makeStore({ items: [runItem({ id: "dup", classification: "exact_duplicate", plannedAction: "skip" })] });
    const { transport } = makeTargetTransport();
    const result = await applySyncRun(
      { runId: "run-1", targetConnection: targetConn, selection: { selectedItemIds: ["dup"] } },
      { transport: provider(transport), store }
    );
    expect(result).toMatchObject({ status: "failed", error: { code: "ineligible_selection" } });
  });

  it("returns no_eligible_items when nothing is applyable", async () => {
    const { store } = makeStore({ items: [runItem({ classification: "blocked", plannedAction: "blocked", plannedTargetPayload: null })] });
    const { transport } = makeTargetTransport();
    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(result).toMatchObject({ status: "failed", error: { code: "no_eligible_items" } });
  });
});

describe("applySyncRun — create path", () => {
  it("creates a target transaction, resolves the id, and records a mapping immediately", async () => {
    const { store, createdMappings, itemPatches } = makeStore();
    const { transport, createTransactionsForSync, createPayee } = makeTargetTransport();

    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });

    expect(result.status).toBe("applied");
    expect(result.counts).toMatchObject({ selected: 1, applied: 1, failed: 0 });
    expect(result.items[0]).toMatchObject({ outcome: "applied", targetTransactionId: "tt1" });

    // create used the marker; payee was resolved from name
    expect(createPayee).toHaveBeenCalledWith({ name: "Coffee Bar" });
    expect(createTransactionsForSync.mock.calls[0][0][0]).toMatchObject({
      importedId: "absync:flow-1:txn:t1", payeeId: "payee-Coffee Bar", categoryId: "tc1", amount: 1250,
    });

    // mapping recorded with target id + marker
    expect(createdMappings).toHaveLength(1);
    expect(createdMappings[0]).toMatchObject({
      flowId: "flow-1", sourceItemKey: "txn:t1", targetTransactionId: "tt1",
      targetMarker: "absync:flow-1:txn:t1", sourceEntityType: "transaction",
    });
    expect(itemPatches.get("item-1")).toMatchObject({ applyState: "applied" });
  });

  it("does not create a payee when policy left it empty", async () => {
    const { store } = makeStore({ items: [runItem({ payloadData: { payeeId: null, payeeName: null } } as unknown as Partial<SyncFlowRunItem>)] });
    const { transport, createPayee, createTransactionsForSync } = makeTargetTransport();
    await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(createPayee).not.toHaveBeenCalled();
    expect(createTransactionsForSync.mock.calls[0][0][0].payeeId).toBeNull();
  });

  it("never creates categories; a missing category stays empty", async () => {
    const { store } = makeStore({ items: [runItem({ payloadData: { categoryId: null } } as unknown as Partial<SyncFlowRunItem>)] });
    const { transport, createTransactionsForSync } = makeTargetTransport();
    await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(createTransactionsForSync.mock.calls[0][0][0].categoryId).toBeNull();
    // transport exposes no category-create method to call
    expect((transport as unknown as Record<string, unknown>).createCategory).toBeUndefined();
  });

  it("marks applied_with_warnings when target rules change the created transaction", async () => {
    const { store, itemPatches } = makeStore();
    const { transport } = makeTargetTransport({ ruleMutate: () => ({ categoryId: "rules-changed-cat" }) });
    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(result.items[0].outcome).toBe("applied_with_warnings");
    expect(result.items[0].changedFields).toContain("category");
    expect(result.counts.appliedWithWarnings).toBe(1);
    expect(itemPatches.get("item-1")).toMatchObject({ applyState: "applied" });
  });

  it("fails the item without a mapping when the created id cannot be resolved", async () => {
    const { store, createdMappings, itemPatches } = makeStore();
    const { transport } = makeTargetTransport({ resolveFails: true });
    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(result.status).toBe("failed");
    expect(result.items[0].outcome).toBe("failed");
    expect(createdMappings).toHaveLength(0);
    expect(itemPatches.get("item-1")).toMatchObject({ applyState: "failed" });
  });
});

describe("applySyncRun — idempotency & duplicates", () => {
  it("skips an item that already has a DB mapping (no duplicate create)", async () => {
    const seed = { flowId: "flow-1", sourceItemKey: "txn:t1", targetTransactionId: "existing" } as unknown as SyncMapping;
    const { store, createdMappings } = makeStore({ seedMappings: [seed] });
    const { transport, createTransactionsForSync } = makeTargetTransport();
    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(result.items[0].outcome).toBe("skipped");
    expect(createTransactionsForSync).not.toHaveBeenCalled();
    expect(createdMappings).toHaveLength(0);
    expect(result.status).toBe("applied");
  });

  it("repairs the mapping when the marker exists on target but the DB mapping is missing", async () => {
    const { store, createdMappings } = makeStore();
    const { transport, createTransactionsForSync } = makeTargetTransport({
      preloaded: [targetRow({ id: "pre-existing", importedId: "absync:flow-1:txn:t1" })],
    });
    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(result.items[0].outcome).toBe("repaired");
    expect(result.items[0].targetTransactionId).toBe("pre-existing");
    expect(createTransactionsForSync).not.toHaveBeenCalled();
    expect(createdMappings[0]).toMatchObject({ targetTransactionId: "pre-existing" });
  });

  it("blocks a second apply of the same run (status no longer draft_preview)", async () => {
    const { store } = makeStore();
    const { transport, createTransactionsForSync } = makeTargetTransport();
    const first = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    const second = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(first.status).toBe("applied");
    expect(second).toMatchObject({ status: "failed", error: { code: "run_not_applyable" } });
    expect(createTransactionsForSync).toHaveBeenCalledTimes(1);
  });
});

describe("applySyncRun — partial failure & splits", () => {
  it("reports partial when one item applies and another fails to resolve", async () => {
    const good = runItem({ id: "good", sourceItemKey: "txn:t1", payloadData: { importedId: "absync:flow-1:txn:t1" } } as unknown as Partial<SyncFlowRunItem>);
    const bad = runItem({ id: "bad", sourceItemKey: "txn:t2", sourceTransactionId: "t2", payloadData: { importedId: "absync:flow-1:txn:t2" } } as unknown as Partial<SyncFlowRunItem>);
    const { store, createdMappings } = makeStore({ items: [good, bad] });
    // Fail resolution only for the second create by toggling after first success.
    const target = makeTargetTransport();
    let call = 0;
    (target.transport.createTransactionsForSync as jest.Mock).mockImplementation(async (inputs: Array<{ importedId?: string | null; date: string; amount: number }>) => {
      call += 1;
      if (call === 2) return { created: [{ requestIndex: 0, transactionId: null, importedId: inputs[0].importedId ?? null }] };
      target.rows.push(targetRow({ id: "tt-good", importedId: inputs[0].importedId ?? null }));
      return { created: [{ requestIndex: 0, transactionId: "tt-good", importedId: inputs[0].importedId ?? null }] };
    });

    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(target.transport), store });
    expect(result.status).toBe("partial");
    expect(result.counts).toMatchObject({ applied: 1, failed: 1 });
    // the successful mapping is not lost despite the later failure
    expect(createdMappings).toHaveLength(1);
    expect(createdMappings[0].sourceItemKey).toBe("txn:t1");
  });

  it("applies a split-line item as a normal target transaction and records a split-line mapping", async () => {
    const split = runItem({
      id: "split-item", sourceEntityType: "split_line",
      sourceItemKey: "split:t1:s1", sourceTransactionId: "t1", sourceSplitId: "s1",
      payloadData: { importedId: "absync:flow-1:split:t1:s1" } as JsonObject,
    } as unknown as Partial<SyncFlowRunItem>);
    const { store, createdMappings } = makeStore({ items: [split] });
    const { transport } = makeTargetTransport();
    const result = await applySyncRun({ runId: "run-1", targetConnection: targetConn }, { transport: provider(transport), store });
    expect(result.items[0].outcome).toBe("applied");
    expect(createdMappings[0]).toMatchObject({
      sourceEntityType: "split_line", sourceSplitId: "s1", sourceItemKey: "split:t1:s1",
      targetEntityType: "transaction",
    });
  });
});

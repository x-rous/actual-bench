/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { AppDbConflictError } from "@/lib/app-db/errors";
import { createSyncMappingIfAbsent } from "@/lib/app-db/syncMappingRepository";
import { claimSyncFlowRun, createSyncFlowRun, failAbandonedSyncRuns, getSyncFlowRun, heartbeatSyncFlowRun } from "@/lib/app-db/syncRunRepository";
import { amountEditText, parseAmountToMinor } from "@/features/sync/lib/previewRows";
import { adjustRateByPercent, averageRates, impliedRate } from "@/lib/fx/fxMath";
import { findTransactionFx, saveTransactionFx, updateTransactionFxSnapshot } from "@/lib/fx/repositories/transactionFxRepository";
import { insertFxRate } from "@/lib/fx/repositories/fxRateRepository";
import { resolveFxBatch } from "@/lib/fx/services/resolveFxBatch";
import { categoryReturnAdapter } from "./adapters/categoryReturnAdapter";
import { transactionAdapter as adapter } from "./adapters/transactionAdapter";
import { applySyncRun, type ApplyStore } from "./applyOrchestrator";
import { planCategoryReturn } from "./categoryReturn";
import { buildPlanConfig, flowPlanHash } from "./flowConfig";
import { routineScanSince } from "./serverSafeSync";
import { runFlowGroup } from "@/features/sync/lib/flowGroups";
import { createFxRateResolver, fxNeedDates } from "./fxPolicy";
import { buildRevaluationInput, computeFxPosition, findTransferCandidates, revaluationItemKey, type TransferRow } from "./fxPosition";
import { runSafeSync } from "./safeSyncOrchestrator";
import { DEFAULT_SOURCE_FILTER } from "./sourceFilter";
import { expandSourceTransactions, transactionFingerprint } from "./sourceItems";
import { planExpandedItems } from "./syncPlanner";
import { hashTargetFields, targetBaseline, targetMatchesBaseline } from "./targetFingerprint";
import { fnv1aHex } from "./hash";
import { generateSyncMarker } from "./marker";
import type { ActualBenchTransport, SyncAppliedSnapshot, SyncSourceTransaction } from "@/lib/actual/transport";
import type { JsonObject, SqliteDatabase, SyncFlow, SyncFlowRun, SyncFlowRunItem, SyncMapping } from "@/lib/app-db/types";
import type { FxRateProvider } from "@/lib/fx/providers/fxRateProvider";
import type { BrowserApiConnection } from "@/store/connection";
import type { FxRateInfo, SyncPlannerTargetSnapshot } from "./plannedChanges";

const envelope = (data: JsonObject) => ({ version: 1 as const, data });
const connection = (budgetSyncId: string): BrowserApiConnection => ({ id: budgetSyncId, label: budgetSyncId, mode: "browser-api", baseUrl: "https://x.example", serverPassword: "pw", budgetSyncId });

function flow(options: JsonObject = {}, transform: JsonObject = {}, filter: JsonObject = {}): SyncFlow {
  return {
    id: "f", name: "AUD to AED", enabled: true, flowType: "transaction_sync", description: null, createdAt: "", updatedAt: "",
    sourceRef: envelope({ connectionFingerprint: "s", budgetId: "S", accountId: "sa", budgetName: "Sub", accountName: "AUD" }),
    targetRef: envelope({ connectionFingerprint: "t", budgetId: "T", accountId: "ta", budgetName: "Main", accountName: "AUD" }),
    filter: envelope(filter),
    transform: envelope({ amountDirection: "same", fxEnabled: true, fxSourceCurrency: "AUD", fxTargetCurrency: "AED", ...transform }),
    options: envelope({ reviewPolicy: "auto_sync_unattended", ...options }),
  };
}

function txn(id: string, overrides: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction {
  return {
    id, accountId: "sa", date: "2026-11-17", amount: -1000, payeeId: "p", payeeName: "Cafe", categoryId: null, categoryName: null,
    notes: null, cleared: false, reconciled: false, importedId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...overrides,
  } as SyncSourceTransaction;
}

const mapping = (key: string, fingerprint: string, targetId: string, overrides: Partial<SyncMapping> = {}) => ({
  id: `m-${key}`, flowId: "f", sourceItemKey: key, sourceFingerprint: fingerprint, targetTransactionId: targetId, status: "active",
  sourceEntityType: "transaction", sourceTransactionId: key.split(":")[1], sourceSplitId: null, targetFingerprint: "x", ...overrides,
}) as SyncMapping;

const capabilities = { mode: "browser-api", supported: true, reason: null, capabilities: { createTransactionWithImportedId: true } } as never;
const config = (overrides: Parameters<typeof buildPlanConfig>[0] extends infer T ? Partial<T> : never = {}) =>
  buildPlanConfig({ flowId: "f", sourceBudgetId: "S", targetBudgetId: "T", sourceAccountId: "sa", targetAccountId: "ta", amountDirection: "same", ...overrides });
const target = (overrides: Partial<SyncPlannerTargetSnapshot> = {}): SyncPlannerTargetSnapshot => ({ payees: [], categories: [], importedIdIndex: new Map(), transactions: [], ...overrides });
const rate = (value: string): FxRateInfo => ({ rate: value, effectiveDate: "2026-11-17", source: "frankfurter", provider: "frankfurter", fxRateId: "r" });

describe("automated runs", () => {
  it("converts currency in a safe-sync run", async () => {
    const transport = {
      listTransactionsForSync: async () => [txn("a")],
      getTargetLookupForSync: async () => ({ payees: [], importedIdIndex: new Map(), transactions: [] }),
      getCategoryGroups: async () => ({ groups: [], categories: [] }),
    } as unknown as ActualBenchTransport;
    const saved = flow();
    let planned: { items: { classification: string; plannedTargetPayload: { amount: number } | null }[] } | undefined;
    const result = await runSafeSync(
      { flowId: "f", context: { sourceConnection: connection("S"), targetConnection: connection("T") } },
      {
        transport: { openTransport: async () => transport },
        previewStore: {
          loadFlow: async () => saved, loadMappings: async () => [],
          persistPlan: async (plan) => { planned = plan as never; return { runId: "r", items: [] }; },
          persistFailedRun: async () => null,
        },
        applyStore: { updateRunStatus: async () => {} } as unknown as ApplyStore,
        resolveFx: async () => ({ resolved: { "AUD:AED:2026-11-17": { requestedDate: "2026-11-17", ...rate("2.5") } } }),
        runApply: (async () => ({ status: "applied", runId: "r", counts: {}, items: [] })) as never,
      }
    );
    expect(result.status).toBe("applied");
    expect(planned?.items[0].classification).toBe("new");
    expect(planned?.items[0].plannedTargetPayload?.amount).toBe(-2500);
  });
});

describe("rate resolution", () => {
  let root: string;
  let db: SqliteDatabase;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "bench-multicurrency-")); db = getAppDb(join(root, "m.sqlite")); });
  afterEach(() => { resetAppDbForTests(); rmSync(root, { recursive: true, force: true }); });
  const nowMs = Date.parse("2026-11-20T00:00:00Z");
  const need = { baseCurrency: "AUD", quoteCurrency: "AED", date: "2026-11-17" };
  const stored = (date: string, value: string) => insertFxRate(db, { baseCurrency: "AUD", quoteCurrency: "AED", requestedDate: date, effectiveDate: date, rate: value, source: "frankfurter", provider: "frankfurter" });
  const provider = (series: () => Promise<{ date: string; rate: string }[]>) => ({ name: "stub", getRate: async () => { throw new Error("unused"); }, getRateSeries: series }) as unknown as FxRateProvider;

  it("asks the provider before accepting an earlier date's rate", async () => {
    stored("2026-11-13", "2.4996");
    const result = await resolveFxBatch(db, [need], { nowMs, provider: provider(async () => [{ date: "2026-11-17", rate: "2.4766" }]) });
    expect(Object.values(result.resolved)[0]).toMatchObject({ rate: "2.4766", effectiveDate: "2026-11-17" });
  });

  it("waits rather than locking in an old rate when the provider fails", async () => {
    stored("2026-11-13", "2.4996");
    const result = await resolveFxBatch(db, [need], { nowMs, provider: provider(async () => { throw new Error("down"); }) });
    expect(result.resolved).toEqual({});
    expect(Object.keys(result.pending)).toHaveLength(1);
  });

  it("uses the latest earlier rate when the provider published none that day", async () => {
    stored("2026-11-13", "2.4996");
    const result = await resolveFxBatch(db, [need], { nowMs, provider: provider(async () => []) });
    expect(Object.values(result.resolved)[0]).toMatchObject({ rate: "2.4996", effectiveDate: "2026-11-13" });
  });

  it("keeps the snapshot's source amount in step with an edited source", () => {
    saveTransactionFx(db, { transactionId: "T", fxRateId: null, sourceCurrency: "AUD", targetCurrency: "AED", sourceAmount: -1000, convertedAmount: -2500, appliedRate: "2.5", requestedDate: "2026-11-17", effectiveDate: "2026-11-17", source: "manual", provider: null, isManual: false });
    updateTransactionFxSnapshot(db, "T", { fxRateId: null, sourceAmount: -2000, appliedRate: "2.5", convertedAmount: -5000, requestedDate: "2026-11-17", effectiveDate: "2026-11-17", source: "manual", provider: null });
    expect(findTransactionFx(db, "T")).toMatchObject({ sourceAmount: -2000, convertedAmount: -5000 });
  });

  it("lets exactly one apply claim a run and closes abandoned applies", () => {
    db.prepare("INSERT INTO sync_flows (id, name, enabled, flow_type, created_at, updated_at, source_ref_json, target_ref_json, filter_json, transform_json, options_json) VALUES ('f', 'x', 1, 'transaction_sync', '', '', '{}', '{}', '{}', '{}', '{}')").run();
    const run = createSyncFlowRun(db, { flowId: "f", status: "draft_preview", summary: envelope({}) });
    const token = claimSyncFlowRun(db, run.id, ["draft_preview"]);
    expect(token).toEqual(expect.any(String));
    expect(claimSyncFlowRun(db, run.id, ["draft_preview"])).toBeNull();
    // A second preview of the same flow cannot start writing beside the first.
    const other = createSyncFlowRun(db, { flowId: "f", status: "draft_preview", summary: envelope({}) });
    expect(claimSyncFlowRun(db, other.id, ["draft_preview"])).toBeNull();
    expect(heartbeatSyncFlowRun(db, run.id, token!)).toBe(true);
    expect(heartbeatSyncFlowRun(db, run.id, "someone-else")).toBe(false);
    // A renewed claim is not abandoned; one that stopped renewing is.
    expect(failAbandonedSyncRuns(db, "f", new Date(Date.now() - 60_000).toISOString())).toBe(0);
    expect(failAbandonedSyncRuns(db, "f", new Date(Date.now() + 1000).toISOString())).toBe(1);
    expect(getSyncFlowRun(db, run.id)?.status).toBe("failed");
    expect(heartbeatSyncFlowRun(db, run.id, token!)).toBe(false);
  });

  it("repeats an identical mapping but refuses a different target", () => {
    db.prepare("INSERT INTO sync_flows (id, name, enabled, flow_type, created_at, updated_at, source_ref_json, target_ref_json, filter_json, transform_json, options_json) VALUES ('f', 'x', 1, 'transaction_sync', '', '', '{}', '{}', '{}', '{}', '{}')").run();
    const input = {
      flowId: "f", sourceConnectionFingerprint: "s", sourceBudgetId: "S", sourceAccountId: "sa", sourceEntityType: "transaction" as const,
      sourceTransactionId: "a", sourceSplitId: null, sourceItemKey: "txn:a", sourceFingerprint: "fp", targetConnectionFingerprint: "t",
      targetBudgetId: "T", targetAccountId: "ta", targetEntityType: "transaction" as const, targetTransactionId: "T1", targetItemKey: "txn:T1",
      targetFingerprint: null, targetMarker: null, createdRunId: null, lastAppliedAt: null,
    };
    const first = createSyncMappingIfAbsent(db, input);
    expect(createSyncMappingIfAbsent(db, input).id).toBe(first.id);
    expect(() => createSyncMappingIfAbsent(db, { ...input, targetTransactionId: "T2" })).toThrow(AppDbConflictError);
  });
});

describe("the target budget owns category and cleared state", () => {
  const written: SyncAppliedSnapshot = { amount: -2500, date: "2026-11-17", cleared: false, categoryId: null, payeeId: "p", notes: "n" };
  const payload = { date: "2026-11-17", amount: -2600, payeeId: "p", payeeName: null, categoryId: null, notes: "n", cleared: false };

  function transportWith(live: SyncAppliedSnapshot & { transferId?: string | null }) {
    const updateTransactionForSync = jest.fn(async () => null);
    const transport = { listTransactionsForSync: async () => [{ id: "T1", ...live }], readTargetTransactionForSync: async () => live, updateTransactionForSync, deleteTransactionForSync: jest.fn() } as unknown as ActualBenchTransport;
    return { transport, updateTransactionForSync };
  }

  it("still updates a row categorised after sync, and keeps the category", async () => {
    const { transport, updateTransactionForSync } = transportWith({ ...written, categoryId: "groceries", cleared: true });
    const [result] = await adapter.updateBatch!(transport, flow(), [{ itemId: "i", targetId: "T1", expectedTargetFingerprint: hashTargetFields(written), payload }]);
    expect(result.outcome).toBe("updated");
    const sent = (updateTransactionForSync.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(sent.amount).toBe(-2600);
    expect(sent.categoryId).toBeUndefined();
    expect(sent.cleared).toBeUndefined();
  });

  it("accepts a baseline stored before category left the fingerprint", () => {
    const legacy = fnv1aHex([written.amount, written.date, "0", "", "p", "n"].join("\u0001"));
    expect(targetMatchesBaseline({ ...written, categoryId: "groceries", cleared: true }, legacy)).toBe(true);
    expect(targetMatchesBaseline({ ...written, amount: -1 }, legacy)).toBe(false);
  });

  it("still protects a hand-edited amount", async () => {
    const { transport, updateTransactionForSync } = transportWith({ ...written, amount: -9999 });
    const [result] = await adapter.updateBatch!(transport, flow(), [{ itemId: "i", targetId: "T1", expectedTargetFingerprint: hashTargetFields(written), payload }]);
    expect(result.outcome).toBe("skipped");
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });

  it("finds the target when the source date moved", async () => {
    const { transport } = transportWith({ ...written, date: "2026-11-10" });
    const baseline = hashTargetFields({ ...written, date: "2026-11-10" });
    const [result] = await adapter.updateBatch!(transport, flow(), [{ itemId: "i", targetId: "T1", expectedTargetFingerprint: baseline, payload }]);
    expect(result.outcome).toBe("updated");
  });

  it("records what it wrote as the baseline, not a later edit", async () => {
    const list = jest.fn()
      .mockResolvedValueOnce([{ id: "T1", ...written }])
      .mockResolvedValue([{ id: "T1", ...written, amount: -7777 }]);
    const transport = { listTransactionsForSync: list, readTargetTransactionForSync: async () => written, updateTransactionForSync: jest.fn(async () => null) } as unknown as ActualBenchTransport;
    const [result] = await adapter.updateBatch!(transport, flow(), [{ itemId: "i", targetId: "T1", expectedTargetFingerprint: hashTargetFields(written), payload }]);
    expect(result.targetFingerprint).toBe(hashTargetFields({ ...written, amount: -2600 }));
  });

  it("puts split lines back when a later write fails, so a retry is not blocked", async () => {
    const lines = [{ id: "l1", amount: -1000, notes: "a", payeeId: "p", categoryId: "c1" }, { id: "l2", amount: -1500, notes: "b", payeeId: "p", categoryId: "c2" }];
    const row = { id: "T1", ...written, isParent: true, splitLines: lines };
    const update = jest.fn(async (input: { transactionId: string }) => {
      if (input.transactionId === "l2") throw new Error("boom");
      return null;
    });
    const transport = { listTransactionsForSync: async () => [row], updateTransactionForSync: update } as unknown as ActualBenchTransport;
    const [result] = await adapter.updateBatch!(transport, flow(), [{
      itemId: "i", targetId: "T1", expectedTargetFingerprint: targetBaseline(row),
      payload: { ...payload, subtransactions: [{ amount: -1100, notes: "a" }, { amount: -1500, notes: "c" }] },
    }]);
    expect(result.outcome).toBe("failed");
    expect(update.mock.calls.map(([input]) => [input.transactionId, (input as unknown as { amount: number }).amount])).toEqual([["l1", -1100], ["l2", -1500], ["l1", -1000]]);
  });

  it("stops inside a split as soon as the claim is lost", async () => {
    const lines = [{ id: "l1", amount: -1000, notes: "a", payeeId: "p", categoryId: null }, { id: "l2", amount: -1500, notes: "b", payeeId: "p", categoryId: null }];
    const row = { id: "T1", ...written, isParent: true, splitLines: lines };
    const update = jest.fn(async () => null);
    const transport = { listTransactionsForSync: async () => [row], updateTransactionForSync: update } as unknown as ActualBenchTransport;
    let checks = 0;
    const [result] = await adapter.updateBatch!(transport, flow(), [{
      itemId: "i", targetId: "T1", expectedTargetFingerprint: targetBaseline(row),
      payload: { ...payload, subtransactions: [{ amount: -1100, notes: "a" }, { amount: -1400, notes: "b" }] },
    }], { shouldStop: () => ++checks > 2 });
    expect(result.outcome).toBe("failed");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a queued row edited while a payee was being created", async () => {
    const list = jest.fn()
      .mockResolvedValueOnce([{ id: "A", ...written }, { id: "B", ...written, payeeId: "old" }])
      .mockResolvedValue([{ id: "A", ...written, amount: -7777 }, { id: "B", ...written, payeeId: "old" }]);
    const update = jest.fn(async () => null);
    const transport = {
      listTransactionsForSync: list,
      updateTransactionForSync: update,
      readTargetTransactionForSync: async () => ({ ...written, payeeId: "old" }),
      createOrResolvePayee: async () => ({ id: "new", name: "New", created: true }),
    } as unknown as ActualBenchTransport;
    const results = await adapter.updateBatch!(transport, flow(), [
      { itemId: "a", targetId: "A", expectedTargetFingerprint: hashTargetFields(written), payload },
      { itemId: "b", targetId: "B", expectedTargetFingerprint: hashTargetFields({ ...written, payeeId: "old" }), payload: { ...payload, payeeId: null, payeeName: "New" } },
    ]);
    expect(results.find((r) => r.itemId === "a")?.outcome).toBe("skipped");
    expect(results.find((r) => r.itemId === "b")?.outcome).toBe("updated");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("leaves a linked transfer alone", async () => {
    const { transport, updateTransactionForSync } = transportWith({ ...written, transferId: "other" });
    const [result] = await adapter.updateBatch!(transport, flow(), [{ itemId: "i", targetId: "T1", expectedTargetFingerprint: hashTargetFields(written), payload }]);
    expect(result.outcome).toBe("skipped");
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });
});

describe("planning", () => {
  it("does not treat an identical second purchase as a duplicate of the first", () => {
    const [first, second] = expandSourceTransactions([txn("c1", { categoryName: "Food" }), txn("c2", { categoryName: "Food" })]);
    const plan = planExpandedItems({
      config: config({ exactDuplicateAutoMap: true }), capabilities,
      sourceItems: [first, second],
      target: target({ payees: [{ id: "p", name: "Cafe" }], categories: [{ id: "food", name: "Food" }], transactions: [{ id: "T1", date: first.date, amount: -1000, payeeName: "Cafe", categoryId: "food" }] }),
      existingMappings: [mapping(first.itemKey, first.fingerprint, "T1")],
    });
    expect(plan.items[1].classification).toBe("new");
  });

  it("does not take a clear or reconcile in the source for a change", () => {
    const [before] = expandSourceTransactions([txn("a")]);
    const legacy = before.legacyFingerprints![0];
    const [after] = expandSourceTransactions([txn("a", { cleared: true, reconciled: true })]);
    const plan = planExpandedItems({ config: config(), capabilities, sourceItems: [after], target: target(), existingMappings: [mapping(after.itemKey, legacy, "T1")] });
    expect(after.fingerprint).toBe(transactionFingerprint(txn("a")));
    expect(plan.items[0].classification).toBe("already_synced");
  });

  it("detects a deletion on a dated flow and ignores a row that only left the filter", async () => {
    const dated = flow({ detectDeletedSource: true }, { fxEnabled: false }, { startDate: "2026-01-01", cleared: "uncleared" });
    const stillThere = txn("kept", { cleared: true });
    const transport = { listTransactionsForSync: async () => [stillThere] } as unknown as ActualBenchTransport;
    const source = await adapter.loadSource(transport, dated);
    const plan = adapter.plan({
      flow: dated, materialized: source.materialized, target: target(), targetCapabilities: {} as never,
      mappings: [mapping("txn:kept", "x", "T1"), mapping("txn:gone", "x", "T2")],
    });
    expect(plan.items.map((item) => [item.sourceItemKey, item.classification])).toEqual([["txn:gone", "source_missing"]]);
  });

  it("does not duplicate an exploded split when grouping is turned on", () => {
    const parent = txn("sp", { isParent: true, splitLines: [{ id: "l1", amount: -400 }, { id: "l2", amount: -600 }] as never });
    const exploded = expandSourceTransactions([parent]);
    const plan = planExpandedItems({
      config: config({ createTargetSplits: true }), capabilities,
      sourceItems: expandSourceTransactions([parent], { groupSplits: true }),
      target: target(),
      existingMappings: exploded.map((item, i) => mapping(item.itemKey, item.fingerprint, `X${i}`, { sourceEntityType: "split_line", sourceTransactionId: "sp", sourceSplitId: `l${i + 1}` })),
    });
    expect(plan.items[0]).toMatchObject({ classification: "blocked", action: "blocked" });
    expect(plan.items[0].flags).toContain("split_mode_changed");
  });

  it("holds a split line whose earlier keys point at different targets", () => {
    const line = { id: null, amount: -400, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null };
    const parent = txn("sp", { isParent: true, splitLines: [line] as never });
    const [plain] = expandSourceTransactions([parent]);
    const [cleared] = expandSourceTransactions([{ ...parent, cleared: true }]);
    const plan = planExpandedItems({
      config: config(), capabilities, sourceItems: [plain], target: target(),
      existingMappings: [
        mapping(plain.itemKey, plain.legacyFingerprints![0], "T1", { sourceEntityType: "split_line", sourceTransactionId: "sp" }),
        mapping(cleared.itemKey, cleared.legacyFingerprints![1], "T2", { sourceEntityType: "split_line", sourceTransactionId: "sp" }),
      ],
    });
    expect(plan.items[0].action).toBe("blocked");
    expect(plan.items[0].flags).toContain("ambiguous_split_identity");
  });

  it("updates a split whose lines moved while its total rounded the same", () => {
    const parent = txn("sp", { amount: -100, isParent: true, splitLines: [{ id: "l1", amount: -1000000 }, { id: "l2", amount: 999900 }] as never });
    const [item] = expandSourceTransactions([parent], { groupSplits: true });
    const plan = planExpandedItems({
      config: config({ fxEnabled: true, fxSourceCurrency: "AUD", fxTargetCurrency: "AED", fxUpdateOnRateChange: true, createTargetSplits: true }), capabilities,
      sourceItems: [item], fxRateByDate: new Map([["2026-11-17", rate("1.001")]]),
      target: target({ transactions: [{ id: "T1", date: item.date, amount: -100, payeeName: "Cafe", categoryId: null, splitAmounts: [-1000000, 999900] }] }),
      existingMappings: [mapping(item.itemKey, item.fingerprint, "T1")],
    });
    expect(plan.items[0].action).toBe("update");
    expect(plan.items[0].plannedTargetPayload?.subtransactions?.map((line) => line.amount)).toEqual([-1001000, 1000900]);
  });

  it("keeps the recorded rate when only a source note changed", () => {
    const [item] = expandSourceTransactions([txn("a", { notes: "edited" })]);
    const plan = planExpandedItems({
      config: config({ fxEnabled: true, fxSourceCurrency: "AUD", fxTargetCurrency: "AED", updateMappedTargets: true }), capabilities,
      sourceItems: [item], fxRateByDate: new Map([["2026-11-17", rate("9")]]),
      manualFxRates: new Map([["T1", { rate: "2.5", effectiveDate: "2026-11-17", requestedDate: "2026-11-17", isManual: false }]]),
      target: target({ transactions: [{ id: "T1", date: item.date, amount: -2500, payeeName: "Cafe", categoryId: null }] }),
      existingMappings: [mapping(item.itemKey, "old", "T1")],
    });
    expect(plan.items[0]).toMatchObject({ action: "update", plannedTargetPayload: { amount: -2500 } });
  });

  it("keeps a positional split line on the key it was synced under", () => {
    const line = { id: null, amount: -400, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null };
    const before = txn("sp", { isParent: true, splitLines: [line] as never });
    const [synced] = expandSourceTransactions([before]);
    const [cleared] = expandSourceTransactions([{ ...before, cleared: true }]);
    expect(cleared.itemKey).not.toBe(synced.itemKey);
    const plan = planExpandedItems({ config: config(), capabilities, sourceItems: [cleared], target: target(), existingMappings: [mapping(synced.itemKey, synced.legacyFingerprints![0], "T1", { sourceEntityType: "split_line", sourceTransactionId: "sp" })] });
    expect(plan.items[0]).toMatchObject({ classification: "already_synced", sourceItemKey: synced.itemKey });
  });

  it("does not let a look-alike take a target that carries another row's marker", () => {
    const [look, owner] = expandSourceTransactions([txn("c1", { categoryName: "Food" }), txn("c2", { categoryName: "Food" })]);
    const marker = generateSyncMarker({ sourceBudgetId: "S", targetBudgetId: "T", targetAccountId: "ta", sourceItemKey: owner.itemKey })!;
    const plan = planExpandedItems({
      config: config({ exactDuplicateAutoMap: true }), capabilities, sourceItems: [look, owner], existingMappings: [],
      target: target({ payees: [{ id: "p", name: "Cafe" }], categories: [{ id: "food", name: "Food" }], importedIdIndex: new Map([[marker, "T1"]]), transactions: [{ id: "T1", date: look.date, amount: -1000, payeeName: "Cafe", categoryId: "food" }] }),
    });
    expect(plan.items.map((item) => item.classification)).toEqual(["new", "target_marker_match"]);
  });

  it("reports a row deleted on the target and offers to recreate it", () => {
    const [item] = expandSourceTransactions([txn("a")]);
    const plan = planExpandedItems({ config: config(), capabilities, sourceItems: [item], target: target({ allTransactionIds: new Set() }), existingMappings: [mapping(item.itemKey, item.fingerprint, "gone")] });
    expect(plan.items[0]).toMatchObject({ classification: "target_missing", action: "create", selectedForApply: false });
  });

  it("writes a source transfer without a transfer payee", () => {
    const [item] = expandSourceTransactions([txn("t", { payeeName: "Savings", transferId: "other-leg" })]);
    const plan = planExpandedItems({ config: config(), capabilities, sourceItems: [item], target: target({ payees: [{ id: "transfer-payee", name: "Savings" }] }), existingMappings: [] });
    expect(plan.items[0].plannedTargetPayload).toMatchObject({ payeeId: null, payeeName: null });
    expect(plan.items[0].plannedTargetPayload?.notes).toContain("Transfer: Savings");
    expect(plan.items[0].flags).toContain("source_transfer");
  });

  it("keeps a rate the user set through a later rate change", () => {
    const [item] = expandSourceTransactions([txn("a")]);
    const plan = planExpandedItems({
      config: config({ fxEnabled: true, fxSourceCurrency: "AUD", fxTargetCurrency: "AED", fxUpdateOnRateChange: true }), capabilities,
      sourceItems: [item], fxRateByDate: new Map([["2026-11-17", rate("9")]]),
      manualFxRates: new Map([["T1", { rate: "2.5", effectiveDate: "2026-11-17" }]]),
      target: target({ transactions: [{ id: "T1", date: item.date, amount: -2500, payeeName: "Cafe", categoryId: null }] }),
      existingMappings: [mapping(item.itemKey, item.fingerprint, "T1")],
    });
    expect(plan.items[0].classification).toBe("already_synced");
  });
});

describe("apply safety", () => {
  const item = (amount = -2500): SyncFlowRunItem => ({
    id: "i", runId: "r", flowId: "f", sequence: 0, sourceItemRef: envelope({}), targetItemRef: null, status: "planned", message: null,
    sourceEntityType: "transaction", sourceItemKey: "txn:x", sourceTransactionId: "x", sourceSplitId: null, sourceFingerprint: "fp",
    plannedAction: "create", classification: "new", duplicateConfidence: "none", warnings: null, errors: null, selectedForApply: true,
    applyState: "pending", createdTargetTransactionId: null, createdTargetMarker: null, createdAt: "", updatedAt: null,
    plannedTargetPayload: envelope({
      accountId: "ta", date: "2026-11-17", amount, payeeId: null, payeeName: null, categoryId: null, notes: "[AUD -10.00 @ 2.5]", cleared: false, importedId: "absync:S:T:ta:txn:x",
      fx: { sourceAmount: -1000, sourceCurrency: "AUD", targetCurrency: "AED", rate: "2.5", requestedDate: "2026-11-17", effectiveDate: "2026-11-17", source: "frankfurter", provider: "frankfurter", fxRateId: "r" },
    }),
  });

  function harness(saved: SyncFlow, summary: JsonObject = {}) {
    const run: SyncFlowRun = { id: "r", flowId: "f", status: "draft_preview", startedAt: new Date().toISOString(), finishedAt: null, summary: envelope(summary), error: null, createdByTrigger: "manual_preview", sourceSnapshotSummary: null, targetSnapshotSummary: null, counts: null };
    const persistFxSnapshot = jest.fn<Promise<void>, [unknown, string?]>(async () => {});
    const store = {
      loadRun: async () => run, loadRunItems: async () => [item()], loadFlow: async () => saved, getMappingBySource: async () => null,
      createMapping: async () => {}, updateMapping: async () => {}, updateRunStatus: async (_: string, patch: { status: SyncFlowRun["status"] }) => { run.status = patch.status; },
      updateRunItemStatus: async () => {}, persistApplyFailure: async () => {}, persistFxSnapshot,
    } as unknown as ApplyStore;
    const createTransactionsForSync = jest.fn(async (rows: { importedId: string }[]) => ({ created: rows.map((row, requestIndex) => ({ requestIndex, transactionId: "new", importedId: row.importedId, resolvedPayeeId: null, applied: null })) }));
    const transport = { listTransactionsForSync: async () => [], createTransactionsForSync } as unknown as ActualBenchTransport;
    return { store, transport, createTransactionsForSync, persistFxSnapshot };
  }

  it("refuses a preview planned for settings the flow no longer has", async () => {
    const planned = flow({}, { fxEnabled: false });
    const moved = { ...planned, targetRef: envelope({ ...planned.targetRef.data, accountId: "other" }) };
    const { store, transport, createTransactionsForSync } = harness(moved, { flowPlanHash: flowPlanHash(planned) });
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T") }, { transport: { openTransport: async () => transport }, store });
    expect(result.error?.code).toBe("preview_stale");
    expect(createTransactionsForSync).not.toHaveBeenCalled();
  });

  it("saves the charged amount before writing, so a retry uses it", async () => {
    const saved = flow();
    const { store, transport } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    const saveRunItemPayloads = jest.fn(async () => {});
    await applySyncRun({ runId: "r", targetConnection: connection("T"), amountOverrides: { i: 2600 } }, { transport: { openTransport: async () => transport }, store: { ...store, saveRunItemPayloads } });
    expect(saveRunItemPayloads).toHaveBeenCalledWith([{ itemId: "i", payload: expect.objectContaining({ data: expect.objectContaining({ amount: -2600 }) }) }]);
  });

  it("refuses a charged amount on a zero-amount row instead of throwing", async () => {
    const saved = flow();
    const { store, transport, createTransactionsForSync } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    const zero = item();
    (zero.plannedTargetPayload!.data as { fx: { sourceAmount: number } }).fx.sourceAmount = 0;
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T"), amountOverrides: { i: 2600 } }, { transport: { openTransport: async () => transport }, store: { ...store, loadRunItems: async () => [zero] } });
    expect(result.error?.code).toBe("ineligible_selection");
    expect(createTransactionsForSync).not.toHaveBeenCalled();
  });

  it("does not recreate a row the user stopped syncing after the preview", async () => {
    const saved = flow();
    const { store, transport, createTransactionsForSync } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    const missing: SyncFlowRunItem = { ...item(), classification: "target_missing", targetItemRef: envelope({ targetTransactionId: "gone" }) };
    const stopped = mapping("txn:x", "fp", "gone", { status: "disabled" });
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T"), selection: { selectedItemIds: ["i"] } }, { transport: { openTransport: async () => transport }, store: { ...store, loadRunItems: async () => [missing], getMappingBySource: async () => stopped } });
    expect(result.counts.skipped).toBe(1);
    expect(createTransactionsForSync).not.toHaveBeenCalled();
  });

  it("fails the item when a charged rate cannot be saved, and a retry saves it without writing again", async () => {
    const saved = flow();
    const { store, transport, createTransactionsForSync, persistFxSnapshot } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    persistFxSnapshot.mockRejectedValueOnce(new Error("db down"));
    const first = await applySyncRun({ runId: "r", targetConnection: connection("T"), amountOverrides: { i: 2600 } }, { transport: { openTransport: async () => transport }, store });
    expect(first.counts.failed).toBe(1);
    const manual = item(-2600);
    const data = manual.plannedTargetPayload!.data as { fx: Record<string, unknown> };
    data.fx = { ...data.fx, rate: "2.6", source: "manual", isManual: true };
    const failedItem: SyncFlowRunItem = { ...manual, applyState: "failed" };
    (transport as unknown as { listTransactionsForSync: () => Promise<unknown[]> }).listTransactionsForSync = async () => [txn("new", { amount: -2600 })];
    const retryStore = { ...store, loadRun: async () => ({ ...(await store.loadRun("r"))!, status: "partial" as const }), loadRunItems: async () => [failedItem], getMappingBySource: async () => mapping("txn:x", "fp", "new") };
    createTransactionsForSync.mockClear();
    await applySyncRun({ runId: "r", targetConnection: connection("T"), selection: { selection: "retry_failed" } }, { transport: { openTransport: async () => transport }, store: retryStore });
    expect(createTransactionsForSync).not.toHaveBeenCalled();
    expect(persistFxSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ transactionId: "new", isManual: true, convertedAmount: -2600 }), "i");
  });

  it("keeps the run appliable when charged amounts cannot be saved", async () => {
    const saved = flow();
    const { store, transport, createTransactionsForSync } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    const updateRunStatus = jest.fn(async () => {});
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T"), amountOverrides: { i: 2600 } }, {
      transport: { openTransport: async () => transport },
      store: { ...store, updateRunStatus, saveRunItemPayloads: async () => { throw new Error("db down"); } },
    });
    expect(result.status).toBe("failed");
    expect(updateRunStatus).toHaveBeenCalledWith("r", expect.objectContaining({ status: "draft_preview" }));
    expect(createTransactionsForSync).not.toHaveBeenCalled();
  });

  it("refuses a charged amount when the planned amount rounded to zero", async () => {
    const saved = flow();
    const { store, transport, createTransactionsForSync } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T"), amountOverrides: { i: 1 } }, {
      transport: { openTransport: async () => transport },
      store: { ...store, loadRunItems: async () => [item(-0)] },
    });
    expect(result.error?.code).toBe("ineligible_selection");
    expect(createTransactionsForSync).not.toHaveBeenCalled();
  });

  it("does not delete a target whose mapping was stopped after the preview", async () => {
    const saved = flow();
    const { store, transport } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    const deleteBatch = jest.spyOn(adapter, "deleteBatch");
    const row: SyncFlowRunItem = { ...item(), classification: "source_missing", plannedAction: "delete", plannedTargetPayload: null, targetItemRef: envelope({ targetTransactionId: "T1" }) };
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T"), selection: { selectedItemIds: ["i", "i"] } }, {
      transport: { openTransport: async () => transport },
      store: { ...store, loadRunItems: async () => [row], getMappingBySource: async () => mapping("txn:x", "fp", "T1", { status: "disabled" }) },
    });
    expect(result.counts).toMatchObject({ selected: 1, skipped: 1, deleted: 0 });
    expect(deleteBatch).not.toHaveBeenCalled();
    deleteBatch.mockRestore();
  });

  it("reports a failed upload instead of a clean apply", async () => {
    const saved = flow();
    const { store, transport } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    const browser = { ...transport, mode: "browser-api", sync: jest.fn(async () => { throw new Error("offline"); }) } as unknown as ActualBenchTransport;
    const updateRunStatus = jest.fn(async () => {});
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T") }, { transport: { openTransport: async () => browser }, store: { ...store, updateRunStatus } });
    expect(result.status).toBe("partial");
    expect(result.error?.code).toBe("upload_failed");
    expect(updateRunStatus).toHaveBeenLastCalledWith("r", expect.objectContaining({ status: "partial", error: expect.anything() }));
  });

  it("fails the item when an ordinary rate record cannot be saved", async () => {
    const saved = flow();
    const { store, transport, persistFxSnapshot } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    persistFxSnapshot.mockRejectedValueOnce(new Error("db down"));
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T") }, { transport: { openTransport: async () => transport }, store });
    expect(result.counts).toMatchObject({ applied: 0, failed: 1 });
  });

  it("marks only the conflicting item failed when the store reports a mapping conflict", async () => {
    const saved = flow();
    const { store, transport } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    const result = await applySyncRun({ runId: "r", targetConnection: connection("T") }, {
      transport: { openTransport: async () => transport },
      store: { ...store, flushWrites: async () => ["i"] },
    });
    expect(result.status).toBe("failed");
    expect(result.counts).toMatchObject({ applied: 0, failed: 1 });
  });

  it("writes the amount the bank charged and records its real rate", async () => {
    const saved = flow();
    const { store, transport, createTransactionsForSync, persistFxSnapshot } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    await applySyncRun({ runId: "r", targetConnection: connection("T"), amountOverrides: { i: 2600 } }, { transport: { openTransport: async () => transport }, store });
    expect(createTransactionsForSync.mock.calls[0][0][0]).toMatchObject({ amount: -2600, notes: "[AUD -10.00 @ 2.6]" });
    expect(persistFxSnapshot).toHaveBeenCalledWith(expect.objectContaining({ appliedRate: "2.6", convertedAmount: -2600, isManual: true }), "i");
  });
});

describe("sending categories back", () => {
  const categories = { sourceCategories: [{ id: "s-food", name: "Food" }], targetCategories: [{ id: "t-food", name: "food" }, { id: "t-other", name: "Only here" }] };

  it("fills an empty source category and leaves the rest alone", () => {
    const rows = [txn("empty"), txn("set", { categoryId: "s-x", categoryName: "X" }), txn("nomatch"), txn("recon", { reconciled: true }), txn("xfer", { transferId: "z" })];
    const items = expandSourceTransactions(rows);
    const plan = planCategoryReturn({
      ...categories, groupSplits: false, sourceTransactions: rows,
      targetTransactions: [{ id: "T0", categoryId: "t-food" }, { id: "T1", categoryId: "t-food" }, { id: "T2", categoryId: "t-other" }, { id: "T3", categoryId: "t-food" }, { id: "T4", categoryId: "t-food" }],
      mappings: items.map((item, index) => mapping(item.itemKey, item.fingerprint, `T${index}`)),
    });
    expect(plan.rows.map((row) => [row.sourceId, row.categoryId])).toEqual([["empty", "s-food"]]);
    expect(plan.noMatchingCategory).toBe(1);
  });

  it("writes through the shared adapter and acknowledges only the category", async () => {
    const live = txn("a", { notes: "before" });
    const edited = { ...live, categoryId: "s-food", categoryName: "Food", notes: "edited meanwhile" };
    const update = jest.fn(async () => null);
    const list = jest.fn().mockResolvedValueOnce([live]).mockResolvedValue([edited]);
    const transport = { listTransactionsForSync: list, updateTransactionForSync: update } as unknown as ActualBenchTransport;
    const [result] = await categoryReturnAdapter.updateBatch!(transport, flow(), [{
      itemId: "i", targetId: "a", sourceItemKey: "txn:a", expectedTargetFingerprint: null,
      payload: { date: live.date, amount: live.amount, payeeId: live.payeeId, notes: "before", categoryId: "s-food" },
    }]);
    expect(result).toMatchObject({ outcome: "updated", mappingPatch: {} });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ transactionId: "a", categoryId: "s-food" }));
  });

  it("skips a source row that changed after the preview", async () => {
    const update = jest.fn(async () => null);
    const transport = { listTransactionsForSync: async () => [txn("a", { amount: -999 })], updateTransactionForSync: update } as unknown as ActualBenchTransport;
    const [result] = await categoryReturnAdapter.updateBatch!(transport, flow(), [{
      itemId: "i", targetId: "a", sourceItemKey: "txn:a", expectedTargetFingerprint: null,
      payload: { date: "2026-11-17", amount: -1000, payeeId: "p", notes: null, categoryId: "s-food" },
    }]);
    expect(result.outcome).toBe("skipped");
    expect(update).not.toHaveBeenCalled();
  });

  it("waits when the source changed since it was synced", () => {
    const rows = [txn("a")];
    const plan = planCategoryReturn({ ...categories, groupSplits: false, sourceTransactions: rows, targetTransactions: [{ id: "T0", categoryId: "t-food" }], mappings: [mapping("txn:a", "stale", "T0")] });
    expect(plan).toMatchObject({ rows: [], sourceChanged: 1 });
  });
});

describe("flow groups", () => {
  const named = (id: string, flowType: SyncFlow["flowType"], enabled = true): SyncFlow => ({ ...flow({ groupName: "AUD", reviewPolicy: "manual_preview_required" }), id, name: id, flowType, enabled });

  it("runs payees and categories before transactions, and only previews manual flows", async () => {
    const calls: string[] = [];
    const runPreview = jest.fn(async ({ flowId }: { flowId: string }) => { calls.push(flowId); return { status: "draft_preview", summary: { createCandidates: 2 } }; });
    const runSafe = jest.fn();
    const conns = [connection("S"), connection("T")];
    const out = await runFlowGroup([named("tx", "transaction_sync"), named("off", "transaction_sync", false), named("cat", "category_sync"), named("pay", "payee_sync")], conns, {
      runPreview: runPreview as never, runSafe: runSafe as never, runOnServer: jest.fn() as never, runsOnServer: () => false,
    }, () => {});
    expect(calls).toEqual(["pay", "cat", "tx"]);
    expect(runSafe).not.toHaveBeenCalled();
    expect(out.find((entry) => entry.flowId === "off")?.state).toBe("skipped");
    expect(out.find((entry) => entry.flowId === "tx")?.state).toBe("previewed");
  });

  it("keeps going after one flow fails", async () => {
    const runPreview = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ status: "draft_preview", summary: { createCandidates: 0 } });
    const out = await runFlowGroup([named("pay", "payee_sync"), named("tx", "transaction_sync")], [connection("S"), connection("T")], {
      runPreview: runPreview as never, runSafe: jest.fn() as never, runOnServer: jest.fn() as never, runsOnServer: () => false,
    }, () => {});
    expect(out.map((entry) => entry.state)).toEqual(["failed", "previewed"]);
  });
});

describe("routine scheduled scans", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  it("reads a recent window until a daily full scan is due", () => {
    expect(routineScanSince("2026-11-23T01:00:00Z", now)).toBe("2026-09-22");
    expect(routineScanSince("2026-11-22T11:00:00Z", now)).toBeNull();
    expect(routineScanSince(null, now)).toBeNull();
  });
});

describe("rate policies", () => {
  it("adds a bank fee to spending and takes it off money received", () => {
    const resolve = createFxRateResolver({ fxRatePolicy: "daily", fxFixedRate: "", fxMarkupPercent: "2.5" }, new Map([["2026-11-17", rate("2")]]));
    expect(resolve("2026-11-17", -100)?.rate).toBe("2.05");
    expect(resolve("2026-11-17", 100)?.rate).toBe("1.95");
  });

  it("averages a month and needs no market rate for a fixed one", () => {
    const byDate = new Map([["2026-11-01", rate("2")], ["2026-11-02", rate("3")]]);
    expect(createFxRateResolver({ fxRatePolicy: "monthly_average", fxFixedRate: "", fxMarkupPercent: "" }, byDate)("2026-11-02", -1)?.rate).toBe("2.5");
    const fixed = { fxRatePolicy: "fixed" as const, fxFixedRate: "3.6725", fxMarkupPercent: "" };
    expect(fxNeedDates(fixed, ["2026-11-02"], "2026-11-22")).toEqual([]);
    expect(createFxRateResolver(fixed, undefined)("2026-11-02", -1)?.rate).toBe("3.6725");
  });

  it("waits for every day of the month before using its average", () => {
    const policy = { fxRatePolicy: "monthly_average" as const, fxFixedRate: "", fxMarkupPercent: "" };
    const partial = new Map([["2026-11-01", rate("2")], ["2026-11-03", rate("3")]]);
    expect(createFxRateResolver(policy, partial, "2026-11-03")("2026-11-03", -1)).toBeNull();
    const full = new Map([...partial, ["2026-11-02", rate("4")]]);
    expect(createFxRateResolver(policy, full, "2026-11-03")("2026-11-03", -1)?.rate).toBe("3");
  });

  it("refuses more than two decimals in a mixed-separator amount", () => {
    expect(parseAmountToMinor("1,234.567", ".")).toBeNull();
    expect(parseAmountToMinor("1.234,567", ",")).toBeNull();
    expect(parseAmountToMinor("1,234,567", ".")).toBe(123456700);
  });

  it("reads charged amounts in either number format", () => {
    expect(parseAmountToMinor("12,50", ",")).toBe(1250);
    expect(parseAmountToMinor("1.234,56", ",")).toBe(123456);
    expect(parseAmountToMinor("1,234.56", ".")).toBe(123456);
    expect(parseAmountToMinor("1,234", ".")).toBe(123400);
    // Three decimals in the user's own format is a typo, not a thousands group.
    expect(parseAmountToMinor("1.234", ".")).toBeNull();
    expect(parseAmountToMinor(amountEditText(1250), ",")).toBe(1250);
    expect(parseAmountToMinor("abc", ".")).toBeNull();
  });

  it("does exact decimal arithmetic", () => {
    expect(adjustRateByPercent("3.6725", "1", 1)).toBe("3.709225");
    expect(averageRates(["0.1", "0.2"])).toBe("0.15");
    expect(impliedRate(-1000, 2600)).toBe("2.6");
  });
});

describe("currency position", () => {
  it("measures the gap to today's value, counting earlier revaluations", () => {
    const position = computeFxPosition({
      config: { amountDirection: "same", createTargetSplits: false }, filter: DEFAULT_SOURCE_FILTER, rate: "2.6",
      sourceTransactions: [txn("a", { amount: 10000 }), txn("new", { amount: 500 })],
      targetTransactions: [{ id: "T1", amount: 25000 }, { id: "R", amount: 300 }],
      mappings: [mapping("txn:a", "x", "T1"), mapping(revaluationItemKey("sa", "2026-11-01"), "x", "R", { sourceTransactionId: null })],
    });
    expect(position).toMatchObject({ sourceTotal: 10000, targetTotal: 25300, valueAtRate: 26000, difference: 700, revaluedTotal: 300, unsyncedRows: 1 });
  });

  it("gives a revaluation a once-per-day marker", () => {
    const route = { sourceBudgetId: "S", targetBudgetId: "T", sourceAccountId: "sa", targetAccountId: "ta", fxSourceCurrency: "AUD", fxTargetCurrency: "AED" };
    const a = buildRevaluationInput({ config: route, date: "2026-11-22", amount: 700, rate: "2.6", categoryId: "fx" });
    const b = buildRevaluationInput({ config: route, date: "2026-11-22", amount: 900, rate: "2.7", categoryId: "fx" });
    expect(a.transaction.importedId).toBe(b.transaction.importedId);
  });

  it("pairs a transfer with its closest unlinked other side", () => {
    const row = (id: string, accountId: string, amount: number, extra: Partial<TransferRow> = {}): TransferRow => ({ id, accountId, date: "2026-11-17", amount, payeeName: null, notes: null, reconciled: false, transferId: null, isParent: false, isChild: false, ...extra });
    const [pair, ...rest] = findTransferCandidates(
      [row("s", "ta", 2500)],
      [row("near", "b", -2510), row("far", "b", -2600), row("same-sign", "b", 2500), row("linked", "b", -2500, { transferId: "z" })]
    );
    expect(pair.counterpart.id).toBe("near");
    expect(rest).toEqual([]);
  });
});

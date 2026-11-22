/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { claimSyncFlowRun, createSyncFlowRun, failAbandonedSyncRuns, getSyncFlowRun } from "@/lib/app-db/syncRunRepository";
import { adjustRateByPercent, averageRates, impliedRate } from "@/lib/fx/fxMath";
import { findTransactionFx, saveTransactionFx, updateTransactionFxSnapshot } from "@/lib/fx/repositories/transactionFxRepository";
import { insertFxRate } from "@/lib/fx/repositories/fxRateRepository";
import { resolveFxBatch } from "@/lib/fx/services/resolveFxBatch";
import { transactionAdapter as adapter } from "./adapters/transactionAdapter";
import { applySyncRun, type ApplyStore } from "./applyOrchestrator";
import { buildPlanConfig, flowPlanHash } from "./flowConfig";
import { createFxRateResolver, fxNeedDates } from "./fxPolicy";
import { buildRevaluationInput, computeFxPosition, findTransferCandidates, revaluationItemKey, type TransferRow } from "./fxPosition";
import { runSafeSync } from "./safeSyncOrchestrator";
import { DEFAULT_SOURCE_FILTER } from "./sourceFilter";
import { expandSourceTransactions, transactionFingerprint } from "./sourceItems";
import { planExpandedItems } from "./syncPlanner";
import { hashTargetFields, targetMatchesBaseline } from "./targetFingerprint";
import { fnv1aHex } from "./hash";
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
    expect(claimSyncFlowRun(db, run.id, ["draft_preview"])).toBe(true);
    expect(claimSyncFlowRun(db, run.id, ["draft_preview"])).toBe(false);
    expect(failAbandonedSyncRuns(db, "f", new Date(Date.now() + 1000).toISOString())).toBe(1);
    expect(getSyncFlowRun(db, run.id)?.status).toBe("failed");
  });
});

describe("the target budget owns category and cleared state", () => {
  const written: SyncAppliedSnapshot = { amount: -2500, date: "2026-11-17", cleared: false, categoryId: null, payeeId: "p", notes: "n" };
  const payload = { date: "2026-11-17", amount: -2600, payeeId: "p", payeeName: null, categoryId: null, notes: "n", cleared: false };

  function transportWith(live: SyncAppliedSnapshot & { transferId?: string | null }) {
    const updateTransactionForSync = jest.fn(async () => null);
    const transport = { listTransactionsForSync: async () => [{ id: "T1", ...live }], updateTransactionForSync, deleteTransactionForSync: jest.fn() } as unknown as ActualBenchTransport;
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
    const persistFxSnapshot = jest.fn(async () => {});
    const store = {
      loadRun: async () => run, loadRunItems: async () => [item()], loadFlow: async () => saved, getMappingBySource: async () => null,
      createMapping: async () => {}, updateMapping: async () => {}, updateRunStatus: async (_: string, patch: { status: SyncFlowRun["status"] }) => { run.status = patch.status; },
      updateRunItemStatus: async () => {}, persistApplyFailure: async () => {}, persistFxSnapshot,
    } as unknown as ApplyStore;
    const createTransactionsForSync = jest.fn(async (rows: { importedId: string }[]) => ({ created: rows.map((row, requestIndex) => ({ requestIndex, transactionId: "new", importedId: row.importedId, resolvedPayeeId: null, applied: null })) }));
    const transport = { getTargetLookupForSync: async () => ({ payees: [], importedIdIndex: new Map(), transactions: [] }), createTransactionsForSync } as unknown as ActualBenchTransport;
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

  it("writes the amount the bank charged and records its real rate", async () => {
    const saved = flow();
    const { store, transport, createTransactionsForSync, persistFxSnapshot } = harness(saved, { flowPlanHash: flowPlanHash(saved) });
    await applySyncRun({ runId: "r", targetConnection: connection("T"), amountOverrides: { i: 2600 } }, { transport: { openTransport: async () => transport }, store });
    expect(createTransactionsForSync.mock.calls[0][0][0]).toMatchObject({ amount: -2600, notes: "[AUD -10.00 @ 2.6]" });
    expect(persistFxSnapshot).toHaveBeenCalledWith(expect.objectContaining({ appliedRate: "2.6", convertedAmount: -2600, isManual: true }));
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

/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncMapping, getSyncMapping, updateSyncMapping } from "@/lib/app-db/syncMappingRepository";
import { toPreviewRow } from "@/features/sync/lib/previewRows";
import { payeeAdapter } from "./adapters/payeeAdapter";
import { transactionAdapter as adapter } from "./adapters/transactionAdapter";
import { applySyncRun, type ApplyStore } from "./applyOrchestrator";
import { resolveTargetPayee, transferPayeeAccount } from "./entityResolution";
import { buildPlanConfig, flowPlanHash } from "./flowConfig";
import { expandSourceTransactions } from "./sourceItems";
import { planExpandedItems } from "./syncPlanner";
import { hashTargetFields } from "./targetFingerprint";
import type { ActualBenchTransport, SyncAppliedSnapshot, SyncSourceTransaction } from "@/lib/actual/transport";
import type { JsonObject, SyncFlow, SyncFlowRun, SyncFlowRunItem, SyncMapping } from "@/lib/app-db/types";
import type { BrowserApiConnection } from "@/store/connection";
import type { FxRateInfo, SyncPlannedItem, SyncPlannerPayee, SyncPlannerTargetSnapshot, SyncPlanResult } from "./plannedChanges";

const envelope = (data: JsonObject) => ({ version: 1 as const, data });
const connection = (budgetSyncId: string): BrowserApiConnection => ({ id: budgetSyncId, label: budgetSyncId, mode: "browser-api", baseUrl: "https://x.example", serverPassword: "pw", budgetSyncId });

function flow(options: JsonObject = {}, transform: JsonObject = {}): SyncFlow {
  return {
    id: "f", name: "AUD to AED", enabled: true, flowType: "transaction_sync", description: null, createdAt: "", updatedAt: "",
    sourceRef: envelope({ connectionFingerprint: "s", budgetId: "S", accountId: "sa", budgetName: "Sub", accountName: "AUD" }),
    targetRef: envelope({ connectionFingerprint: "t", budgetId: "T", accountId: "ta", budgetName: "Main", accountName: "AUD" }),
    filter: envelope({}),
    transform: envelope({ amountDirection: "same", fxEnabled: true, fxSourceCurrency: "AUD", fxTargetCurrency: "AED", ...transform }),
    options: envelope({ updateMappedTargets: true, detectDeletedSource: true, ...options }),
  };
}

function txn(id: string, overrides: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction {
  return {
    id, accountId: "sa", date: "2026-11-20", amount: 410000, payeeId: "p", payeeName: "AED Current", categoryId: null, categoryName: null,
    notes: null, cleared: false, reconciled: false, importedId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...overrides,
  } as SyncSourceTransaction;
}

const mapping = (key: string, fingerprint: string, targetId: string, overrides: Partial<SyncMapping> = {}) => ({
  id: `m-${key}`, flowId: "f", sourceItemKey: key, sourceFingerprint: fingerprint, targetTransactionId: targetId, status: "active",
  sourceEntityType: "transaction", sourceTransactionId: key.split(":")[1], sourceSplitId: null, targetFingerprint: "x", ...overrides,
}) as SyncMapping;

const capabilities = { mode: "browser-api", supported: true, reason: null, capabilities: { createTransactionWithImportedId: true } } as never;
const config = () => buildPlanConfig({ flowId: "f", sourceBudgetId: "S", targetBudgetId: "T", sourceAccountId: "sa", targetAccountId: "ta", amountDirection: "same", fxEnabled: true, fxSourceCurrency: "AUD", fxTargetCurrency: "AED", updateMappedTargets: true });
const rate: FxRateInfo = { rate: "2.5", effectiveDate: "2026-11-20", source: "frankfurter", provider: "frankfurter", fxRateId: "r" };
const payees: SyncPlannerPayee[] = [
  { id: "to-aed", name: "AED Current", transferAccountId: "aed" },
  { id: "to-self", name: "AUD Wallet", transferAccountId: "ta" },
  { id: "cafe", name: "Cafe", transferAccountId: null },
];
const target = (overrides: Partial<SyncPlannerTargetSnapshot> = {}): SyncPlannerTargetSnapshot => ({ payees, categories: [], importedIdIndex: new Map(), transactions: [], ...overrides });

function plan(sources: SyncSourceTransaction[], snapshot = target(), mappings: SyncMapping[] = [], extra: Partial<Parameters<typeof planExpandedItems>[0]> = {}) {
  return planExpandedItems({
    config: config(),
    capabilities,
    sourceItems: expandSourceTransactions(sources, { groupSplits: false }),
    target: snapshot,
    existingMappings: mappings,
    fxRateByDate: new Map([["2026-11-20", rate], ["2026-11-21", rate]]),
    ...extra,
  });
}

describe("planning a transfer between the budgets", () => {
  it("says a row whose payee is a transfer payee creates a transfer, and asks for the real amount", () => {
    const [item] = plan([txn("a")]).items;
    expect(item.action).toBe("create");
    expect(item.flags).toContain("creates_transfer");
    expect(item.plannedTargetPayload).toMatchObject({ payeeId: "to-aed", transferAccountId: "aed", transferAccountName: "AED Current", amount: 1025000 });
    expect(item.message).toContain("Creates a transfer to AED Current. Set the amount AED Current recorded");
  });

  it("resolves a `Transfer: <account>` payee only to that account's transfer payee", () => {
    expect(transferPayeeAccount("Transfer: AED Current")).toBe("AED Current");
    expect(transferPayeeAccount("transfer:aed current")).toBe("aed current");
    expect(transferPayeeAccount("Cafe")).toBeNull();
    const [item] = plan([txn("a", { payeeName: "Transfer: AED Current" })]).items;
    expect(item.plannedTargetPayload).toMatchObject({ payeeId: "to-aed", transferAccountId: "aed" });
    // An account the target does not have leaves the payee empty rather than inventing one.
    const unknown = resolveTargetPayee({ payeeName: "Transfer: Closed Account" }, { missingPayee: "create", targetAccountId: "ta" }, payees);
    expect(unknown).toMatchObject({ payeeId: null, payeeName: null, leftEmpty: true, transferAccountId: null });
    expect(unknown.note).toContain("No account named");
  });

  it("never makes a row transfer to its own account", () => {
    const [item] = plan([txn("a", { payeeName: "AUD Wallet" })]).items;
    expect(item.flags).not.toContain("creates_transfer");
    expect(item.plannedTargetPayload).toMatchObject({ payeeId: null, payeeName: null });
    expect(item.message).toContain("own transfer payee");
  });

  it("updates both legs of a transfer it created, and leaves one linked to the user's own row", () => {
    const source = txn("a", { amount: 420000 });
    const linked = target({ transactions: [{ id: "T1", date: "2026-11-20", amount: 1000000, payeeName: "AED Current", categoryId: null, transferId: "L1" }] });
    const owned = plan([source], linked, [mapping("txn:a", "old", "T1", { ownsTransferLeg: true })]).items[0];
    expect(owned.action).toBe("update");
    expect(owned.flags).toContain("linked_transfer");
    expect(owned.plannedTargetPayload).toMatchObject({ keepTargetPayee: true, linkedTransfer: "owned", transferAccountId: null });
    expect(owned.message).toContain("Both legs");
    const external = plan([source], linked, [mapping("txn:a", "old", "T1")]).items[0];
    expect(external.plannedTargetPayload).toMatchObject({ linkedTransfer: "external" });
    expect(external.message).toContain("left unchanged");
  });

  it("says what deleting a linked transfer does", () => {
    const linked = target({ transactions: [{ id: "T1", date: "2026-11-20", amount: 1000000, payeeName: "AED Current", categoryId: null, transferId: "L1" }] });
    const deleted = (ownsTransferLeg: boolean) =>
      plan([], linked, [mapping("txn:a", "old", "T1", { ownsTransferLeg })], { detectDeletedSource: true, presentSourceKeys: new Set() }).items[0];
    expect(deleted(true).flags).toContain("linked_transfer");
    expect(deleted(true).message).toContain("removes both of its legs");
    expect(deleted(false).message).toContain("both rows stay");
  });

  it("does not follow a new market rate on a transfer", () => {
    const source = txn("a");
    const [item] = expandSourceTransactions([source], { groupSplits: false });
    const linked = target({ transactions: [{ id: "T1", date: "2026-11-20", amount: 1000000, payeeName: "AED Current", categoryId: null, transferId: "L1" }] });
    const result = planExpandedItems({
      config: { ...config(), fxUpdateOnRateChange: true },
      capabilities,
      sourceItems: [item],
      target: linked,
      existingMappings: [mapping("txn:a", item.fingerprint, "T1", { ownsTransferLeg: true })],
      fxRateByDate: new Map([["2026-11-20", { ...rate, rate: "2.6" }]]),
    });
    expect(result.items[0].classification).toBe("already_synced");
  });
});

describe("payee sync", () => {
  it("names a transfer payee for the account it moves money to", () => {
    const result = payeeAdapter.plan({
      flow: { ...flow(), flowType: "payee_sync" },
      materialized: { payees: [{ id: "x", name: "AED Current", transferAccountId: "aed" }, { id: "y", name: "Cafe", transferAccountId: null }] },
      target: { byName: new Map() },
      mappings: [],
      targetCapabilities: {} as never,
    });
    const names = result.items.map((item) => (item.plannedTargetPayload as unknown as { name?: string } | null)?.name ?? item.source.payeeName);
    expect(names).toEqual(["Transfer: AED Current", "Cafe"]);
    expect(result.items[0].message).toContain("syncs back as a transfer");
  });
});

describe("writing a linked transfer", () => {
  const leg: SyncAppliedSnapshot & { id: string; transferId: string } = { id: "T1", amount: 1000000, date: "2026-11-20", cleared: false, categoryId: null, payeeId: "to-aed", notes: "n", transferId: "L1" };
  const other = { id: "L1", accountId: "aed", amount: -1000000, date: "2026-11-20", cleared: false, categoryId: null, payeeId: "to-aud", notes: "n", transferId: "T1", reconciled: false };

  function transportWith(otherLeg = other) {
    const updateTransactionForSync = jest.fn(async () => null);
    const deleteTransactionForSync = jest.fn(async () => {});
    const transport = {
      listTransactionsForSync: async ({ accountId }: { accountId: string }) => (accountId === "aed" ? [otherLeg] : [{ ...leg, accountId: "ta", reconciled: false }]),
      getPayees: async () => [{ id: "to-aed", name: "AED Current", transferAccountId: "aed" }],
      updateTransactionForSync,
      deleteTransactionForSync,
    } as unknown as ActualBenchTransport;
    return { transport, updateTransactionForSync, deleteTransactionForSync };
  }
  const input = (payload: JsonObject, ownsTransferLeg: boolean) => ({ itemId: "i", targetId: "T1", expectedTargetFingerprint: hashTargetFields(leg), payload, sourceFingerprint: "new", ownsTransferLeg });

  it("updates a transfer it created and moves the other leg's date", async () => {
    const { transport, updateTransactionForSync } = transportWith();
    const [result] = await adapter.updateBatch!(transport, flow(), [input({ date: "2026-11-21", amount: 1050000, notes: "n", keepTargetPayee: true }, true)]);
    expect(result).toMatchObject({ outcome: "updated", message: "Both legs of the transfer updated." });
    const calls = (updateTransactionForSync.mock.calls as unknown as [Record<string, unknown>][]).map(([call]) => call);
    // The payee stays, or Actual would unlink the transfer; the category is the target's.
    expect(calls[0]).toEqual({ transactionId: "T1", accountId: "ta", date: "2026-11-21", amount: 1050000, notes: "n", returnApplied: false });
    expect(calls[1]).toEqual({ transactionId: "L1", accountId: "aed", date: "2026-11-21", amount: -1050000, returnApplied: false });
  });

  it("leaves a transfer linked to the user's own row and reports it once", async () => {
    const { transport, updateTransactionForSync } = transportWith();
    const [result] = await adapter.updateBatch!(transport, flow(), [input({ date: "2026-11-20", amount: 1050000, notes: "n" }, false)]);
    expect(result).toMatchObject({ outcome: "skipped", mappingPatch: { sourceFingerprint: "new" } });
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });

  it("does not change a transfer whose other leg is reconciled", async () => {
    const { transport, updateTransactionForSync } = transportWith({ ...other, reconciled: true });
    const [result] = await adapter.updateBatch!(transport, flow(), [input({ date: "2026-11-20", amount: 1050000, notes: "n" }, true)]);
    expect(result).toMatchObject({ outcome: "skipped", mappingPatch: { sourceFingerprint: "new" } });
    expect(result.message).toContain("reconciled");
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });

  it("deletes a transfer it created, and stops syncing one it did not", async () => {
    const owned = transportWith();
    const [deleted] = await adapter.deleteBatch!(owned.transport, flow(), [input({}, true)]);
    expect(deleted.outcome).toBe("deleted");
    expect(owned.deleteTransactionForSync).toHaveBeenCalledWith({ transactionId: "T1" });

    const external = transportWith();
    const [kept] = await adapter.deleteBatch!(external.transport, flow(), [input({}, false)]);
    expect(kept).toMatchObject({ outcome: "skipped", mappingPatch: { status: "source_missing" } });
    expect(external.deleteTransactionForSync).not.toHaveBeenCalled();

    const reconciled = transportWith({ ...other, reconciled: true });
    const [held] = await adapter.deleteBatch!(reconciled.transport, flow(), [input({}, true)]);
    expect(held).toMatchObject({ outcome: "skipped", mappingPatch: { status: "source_missing" } });
    expect(reconciled.deleteTransactionForSync).not.toHaveBeenCalled();
  });
});

describe("a transfer that may already be recorded", () => {
  const planned = (amount: number, date = "2026-11-20"): SyncPlanResult => ({
    flowId: "f",
    counts: { new: 1 },
    items: [{
      sourceItemKey: "txn:a", sourceEntityType: "transaction", sourceTransactionId: "a", sourceSplitId: null, sourceFingerprint: "fp", usedFallbackKey: false,
      source: { date, amount: 410000, payeeName: "AED Current", categoryName: null, notes: null },
      classification: "new", duplicateConfidence: "none", action: "create", flags: ["target_rules_may_modify", "creates_transfer"], selectedForApply: true,
      plannedTargetPayload: { accountId: "ta", date, amount, payeeId: "to-aed", payeeName: null, categoryId: null, notes: null, cleared: false, importedId: "m", transferAccountId: "aed", transferAccountName: "AED Current" },
      targetTransactionId: null, message: "Creates a transfer to AED Current.",
    } as SyncPlannedItem],
  });
  const transport = (rows: Partial<SyncSourceTransaction>[]) => ({
    listTransactionsForSync: jest.fn(async () => rows.map((row, i) => txn(`r${i}`, { accountId: "aed", payeeName: null, ...row }))),
  });

  it("holds the transfer unselected when the other account has a matching row", async () => {
    const t = transport([{ date: "2026-11-21", amount: -1000000 }]);
    const reviewed = await adapter.reviewPlan!(t as unknown as ActualBenchTransport, flow(), planned(1000000));
    expect(reviewed.items[0]).toMatchObject({ selectedForApply: false });
    expect(reviewed.items[0].flags).toContain("transfer_may_duplicate");
    expect(reviewed.items[0].message).toContain("AED Current already has -10,000.00 on 2026-11-21");
    expect(t.listTransactionsForSync).toHaveBeenCalledWith(expect.objectContaining({ accountId: "aed", startDate: "2026-11-17", endDate: "2026-11-23" }));
  });

  it("leaves it alone when nothing there matches", async () => {
    // Same sign, too far apart, already linked, or a different amount.
    const t = transport([{ amount: 1000000 }, { date: "2026-11-30", amount: -1000000 }, { amount: -1000000, transferId: "x" }, { amount: -800000 }]);
    const reviewed = await adapter.reviewPlan!(t as unknown as ActualBenchTransport, flow(), planned(1000000));
    expect(reviewed.items[0].selectedForApply).toBe(true);
    expect(reviewed.items[0].flags).not.toContain("transfer_may_duplicate");
  });

  it("is created only when picked by hand", async () => {
    const run: SyncFlowRun = { id: "r", flowId: "f", status: "draft_preview", startedAt: new Date().toISOString(), finishedAt: null, summary: envelope({ flowPlanHash: flowPlanHash(flow()) }), error: null, createdByTrigger: "manual_preview", sourceSnapshotSummary: null, targetSnapshotSummary: null, counts: null };
    const held: SyncFlowRunItem = {
      id: "i", runId: "r", flowId: "f", sequence: 0, sourceItemRef: envelope({}), targetItemRef: null, status: "planned", message: null,
      sourceEntityType: "transaction", sourceItemKey: "txn:a", sourceTransactionId: "a", sourceSplitId: null, sourceFingerprint: "fp",
      plannedAction: "create", classification: "new", duplicateConfidence: "none", warnings: envelope({ flags: ["creates_transfer", "transfer_may_duplicate"] }), errors: null, selectedForApply: false,
      applyState: "pending", createdTargetTransactionId: null, createdTargetMarker: null, createdAt: "", updatedAt: null,
      plannedTargetPayload: envelope({ accountId: "ta", date: "2026-11-20", amount: 1000000, payeeId: "to-aed", payeeName: null, categoryId: null, notes: null, cleared: false, importedId: "absync:S:T:ta:txn:a", transferAccountId: "aed" }),
    };
    const createMapping = jest.fn(async () => {});
    const store = {
      loadRun: async () => run, loadRunItems: async () => [held], loadFlow: async () => flow({}, { fxEnabled: false }), getMappingBySource: async () => null,
      createMapping, updateMapping: async () => {}, updateRunStatus: async (_: string, patch: { status: SyncFlowRun["status"] }) => { run.status = patch.status; },
      updateRunItemStatus: async () => {}, persistApplyFailure: async () => {}, persistFxSnapshot: async () => {},
    } as unknown as ApplyStore;
    const createTransactionsForSync = jest.fn(async (rows: { importedId: string }[]) => ({ created: rows.map((row, requestIndex) => ({ requestIndex, transactionId: "new", importedId: row.importedId, resolvedPayeeId: null, applied: null })) }));
    const t = { listTransactionsForSync: async () => [], createTransactionsForSync } as unknown as ActualBenchTransport;
    const saved = flow({}, { fxEnabled: false });
    run.summary = envelope({ flowPlanHash: flowPlanHash(saved) });

    const bulk = await applySyncRun({ runId: "r", targetConnection: connection("T"), selection: { selection: "all_safe" } }, { transport: { openTransport: async () => t }, store });
    expect(bulk.error?.code).toBe("no_eligible_items");
    expect(createTransactionsForSync).not.toHaveBeenCalled();

    run.status = "draft_preview";
    const picked = await applySyncRun({ runId: "r", targetConnection: connection("T"), selection: { selectedItemIds: ["i"] } }, { transport: { openTransport: async () => t }, store });
    expect(picked.counts.applied).toBe(1);
    // The sync created the other leg, so its mapping says so.
    expect(createMapping).toHaveBeenCalledWith(expect.objectContaining({ ownsTransferLeg: true }), "i");
  });

  it("shows held transfers as selectable but not safe, and lets an owned transfer update take the real amount", () => {
    const base = {
      id: "i", runId: "r", flowId: "f", sequence: 0, sourceItemRef: envelope({}), targetItemRef: null, status: "planned", message: null,
      sourceEntityType: "transaction", sourceItemKey: "txn:a", sourceTransactionId: "a", sourceSplitId: null, sourceFingerprint: "fp",
      duplicateConfidence: "none", errors: null, selectedForApply: false, applyState: "pending", createdTargetTransactionId: null, createdTargetMarker: null, createdAt: "", updatedAt: null,
    } as const;
    const fx = { sourceAmount: 410000, sourceCurrency: "AUD", targetCurrency: "AED", rate: "2.5", requestedDate: "2026-11-20", effectiveDate: "2026-11-20", source: "frankfurter", provider: "frankfurter", fxRateId: "r" };
    const heldRow = toPreviewRow({ ...base, plannedAction: "create", classification: "new", warnings: envelope({ flags: ["transfer_may_duplicate"] }), plannedTargetPayload: envelope({ amount: 1025000, fx }) } as unknown as SyncFlowRunItem);
    expect(heldRow).toMatchObject({ isSafeNew: false, selectable: true, canOverrideAmount: true });
    const ownedUpdate = toPreviewRow({ ...base, plannedAction: "update", classification: "source_changed_since_sync", warnings: null, plannedTargetPayload: envelope({ amount: 1025000, fx, linkedTransfer: "owned" }) } as unknown as SyncFlowRunItem);
    expect(ownedUpdate.canOverrideAmount).toBe(true);
    const externalUpdate = toPreviewRow({ ...base, plannedAction: "update", classification: "source_changed_since_sync", warnings: null, plannedTargetPayload: envelope({ amount: 1025000, fx, linkedTransfer: "external" }) } as unknown as SyncFlowRunItem);
    expect(externalUpdate.canOverrideAmount).toBe(false);
  });
});

describe("mapping storage", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "xfer-"));
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps whether the sync created a transfer's other leg", () => {
    const db = getAppDb(join(root, "app.sqlite"));
    db.prepare("INSERT INTO sync_flows (id, name, enabled, flow_type, created_at, updated_at, source_ref_json, target_ref_json, filter_json, transform_json, options_json) VALUES ('f', 'x', 1, 'transaction_sync', '', '', '{}', '{}', '{}', '{}', '{}')").run();
    const input = {
      flowId: "f", sourceConnectionFingerprint: "s", sourceBudgetId: "S", sourceAccountId: "sa", sourceEntityType: "transaction" as const,
      sourceTransactionId: "a", sourceSplitId: null, sourceItemKey: "txn:a", sourceFingerprint: "fp", targetConnectionFingerprint: "t",
      targetBudgetId: "T", targetAccountId: "ta", targetEntityType: "transaction" as const, targetTransactionId: "T1", targetItemKey: "txn:T1",
      targetFingerprint: null, targetMarker: null, createdRunId: null, lastAppliedAt: null,
    };
    const plain = createSyncMapping(db, input);
    expect(plain.ownsTransferLeg).toBe(false);
    const owned = createSyncMapping(db, { ...input, sourceItemKey: "txn:b", ownsTransferLeg: true });
    expect(owned.ownsTransferLeg).toBe(true);
    // A patch that does not mention it keeps it.
    expect(updateSyncMapping(db, owned.id, { status: "source_missing" })?.ownsTransferLeg).toBe(true);
    expect(updateSyncMapping(db, plain.id, { ownsTransferLeg: true })?.ownsTransferLeg).toBe(true);
    expect(getSyncMapping(db, plain.id)?.ownsTransferLeg).toBe(true);
  });
});

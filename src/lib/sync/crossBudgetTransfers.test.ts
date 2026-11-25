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
import { hashTargetFields, targetBaseline } from "./targetFingerprint";
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

  it("keeps a transfer's recorded rate when only its notes change, even when the flow follows rates", () => {
    const [item] = expandSourceTransactions([txn("a", { notes: "rent" })], { groupSplits: false });
    const linked = target({ transactions: [{ id: "T1", date: "2026-11-20", amount: 1025000, payeeName: "AED Current", categoryId: null, transferId: "L1" }] });
    const result = planExpandedItems({
      config: { ...config(), fxUpdateOnRateChange: true },
      capabilities,
      sourceItems: [item],
      target: linked,
      existingMappings: [mapping("txn:a", "before-notes", "T1", { ownsTransferLeg: true })],
      fxRateByDate: new Map([["2026-11-20", { ...rate, rate: "2.6" }]]),
      manualFxRates: new Map([["T1", { rate: "2.5", requestedDate: "2026-11-20", effectiveDate: "2026-11-20", source: "frankfurter", provider: "frankfurter", fxRateId: "r", isManual: false }]]) as never,
    });
    expect(result.items[0].action).toBe("update");
    expect(result.items[0].plannedTargetPayload).toMatchObject({ amount: 1025000, notes: expect.stringContaining("rent") });
  });

  it("checks a recreated transfer for a row already on its other side", () => {
    const [item] = expandSourceTransactions([txn("a")], { groupSplits: false });
    const gone = target({ allTransactionIds: new Set() });
    const [planned] = plan([txn("a")], gone, [mapping("txn:a", item.fingerprint, "T1", { ownsTransferLeg: true })]).items;
    expect(planned).toMatchObject({ classification: "target_missing", action: "create", selectedForApply: false });
    expect(planned.flags).toEqual(expect.arrayContaining(["target_missing_review", "creates_transfer"]));
    expect(planned.message).toContain("Creates a transfer to AED Current");
  });

  it("marks a grouped split whose line is a transfer, so its other side is checked too", () => {
    const split = txn("s", {
      payeeName: "Cafe", isParent: true,
      splitLines: [
        { id: "l1", amount: 400000, payeeId: "p", payeeName: "AED Current", categoryId: null, categoryName: null, notes: null },
        { id: "l2", amount: 10000, payeeId: "c", payeeName: "Cafe", categoryId: null, categoryName: null, notes: null },
      ],
    });
    const [item] = planExpandedItems({
      config: { ...config(), createTargetSplits: true },
      capabilities,
      sourceItems: expandSourceTransactions([split], { groupSplits: true }),
      target: target(),
      existingMappings: [],
      fxRateByDate: new Map([["2026-11-20", rate]]),
    }).items;
    expect(item.flags).toContain("creates_transfer");
    expect(item.plannedTargetPayload?.transferAccountId).toBeUndefined();
    expect(item.plannedTargetPayload?.subtransactions?.[0]).toMatchObject({ payeeId: "to-aed", transferAccountId: "aed", transferAccountName: "AED Current", amount: 1000000 });
    expect(item.message).toContain("Creates a transfer to AED Current.");
    expect(item.message).not.toContain("Set the amount");
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

  /** Reads honour the date range, so an other leg on another day is missed by a one-day read. */
  function datedTransport(otherLeg: typeof other | null, targetRows: () => (typeof leg)[] = () => [leg]) {
    const inRange = (date: string, range: { startDate?: string; endDate?: string }) =>
      (!range.startDate || date >= range.startDate) && (!range.endDate || date <= range.endDate);
    const updateTransactionForSync = jest.fn<Promise<null>, [Record<string, unknown>]>(async () => null);
    const deleteTransactionForSync = jest.fn(async () => {});
    const transport = {
      listTransactionsForSync: async (range: { accountId: string; startDate?: string; endDate?: string }) =>
        (range.accountId === "aed" ? (otherLeg ? [otherLeg] : []) : targetRows().map((row) => ({ ...row, accountId: "ta", reconciled: false })))
          .filter((row) => inRange(row.date, range)),
      getPayees: async () => [{ id: "to-aed", name: "AED Current", transferAccountId: "aed" }],
      updateTransactionForSync,
      deleteTransactionForSync,
    } as unknown as ActualBenchTransport;
    return { transport, updateTransactionForSync, deleteTransactionForSync };
  }

  it("finds the other leg on another date before deleting, and never deletes when it cannot be found", async () => {
    const elsewhere = datedTransport({ ...other, date: "2026-11-25", reconciled: true });
    const [held] = await adapter.deleteBatch!(elsewhere.transport, flow(), [input({}, true)]);
    expect(held).toMatchObject({ outcome: "skipped", mappingPatch: { status: "source_missing" } });
    expect(elsewhere.deleteTransactionForSync).not.toHaveBeenCalled();

    const missing = datedTransport(null);
    const [kept] = await adapter.deleteBatch!(missing.transport, flow(), [input({}, true)]);
    expect(kept).toMatchObject({ outcome: "skipped", message: "The transfer's other leg could not be found; not deleted." });
    expect(missing.deleteTransactionForSync).not.toHaveBeenCalled();
  });

  it("checks the other leg again before each later delete", async () => {
    const second = { ...leg, id: "T2", transferId: "L2" };
    let reconciledNow = false;
    const legs = (id: string) => ({ ...other, id, transferId: id === "L1" ? "T1" : "T2", reconciled: id === "L2" && reconciledNow });
    const deleteTransactionForSync = jest.fn(async () => { reconciledNow = true; });
    const transport = {
      listTransactionsForSync: async ({ accountId }: { accountId: string }) =>
        accountId === "aed" ? [legs("L1"), legs("L2")] : [leg, second].map((row) => ({ ...row, accountId: "ta", reconciled: false })),
      getPayees: async () => [{ id: "to-aed", name: "AED Current", transferAccountId: "aed" }],
      deleteTransactionForSync,
    } as unknown as ActualBenchTransport;
    const results = await adapter.deleteBatch!(transport, flow(), [input({}, true), { ...input({}, true), itemId: "j", targetId: "T2", expectedTargetFingerprint: hashTargetFields(second) }]);
    expect(results.map((r) => r.outcome)).toEqual(["deleted", "skipped"]);
    expect(results[1].message).toContain("reconciled");
    expect(deleteTransactionForSync).toHaveBeenCalledTimes(1);
  });

  it("reads the target again before writing, and skips it if it was edited meanwhile", async () => {
    let reads = 0;
    const { transport, updateTransactionForSync } = datedTransport(other, () => (reads++ === 0 ? [leg] : [{ ...leg, notes: "edited by hand" }]));
    const [result] = await adapter.updateBatch!(transport, flow(), [input({ date: "2026-11-20", amount: 1050000, notes: "n" }, true)]);
    expect(result).toMatchObject({ outcome: "skipped", message: "Target was edited outside sync; left unchanged." });
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });

  it("puts the target back when the other leg's date cannot be moved", async () => {
    const { transport, updateTransactionForSync } = datedTransport(other);
    updateTransactionForSync.mockImplementation(async (call: Record<string, unknown>) => {
      if (call.transactionId === "L1") throw new Error("server down");
      return null;
    });
    const [result] = await adapter.updateBatch!(transport, flow(), [input({ date: "2026-11-21", amount: 1050000, notes: "new" }, true)]);
    expect(result).toMatchObject({ outcome: "failed" });
    expect(result.message).toContain("server down");
    const calls = updateTransactionForSync.mock.calls.map(([call]) => call);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual({ transactionId: "T1", accountId: "ta", date: "2026-11-20", amount: 1000000, notes: "n", returnApplied: false });
  });
});

describe("a split whose lines are transfers", () => {
  const lines = [
    { id: "c1", amount: 1000000, notes: null, payeeId: "to-aed", categoryId: null, reconciled: false, transferId: "L1" },
    { id: "c2", amount: 10000, notes: null, payeeId: "cafe", categoryId: null, reconciled: false, transferId: null },
  ];
  const split = { id: "S1", amount: 1010000, date: "2026-11-20", cleared: false, categoryId: null, payeeId: null, notes: null, transferId: null, isParent: true, splitLines: lines };
  const baseline = targetBaseline(split);
  const transportWith = (otherReconciled: boolean) => {
    const deleteTransactionForSync = jest.fn(async () => {});
    const updateTransactionForSync = jest.fn(async () => null);
    const transport = {
      listTransactionsForSync: async ({ accountId }: { accountId: string }) =>
        accountId === "aed"
          ? [txn("L1", { accountId: "aed", amount: -1000000, payeeId: "to-aud", transferId: "c1", reconciled: otherReconciled })]
          : [{ ...txn("S1", { accountId: "ta", amount: 1010000, payeeId: null as never, isParent: true }), splitLines: lines }],
      getPayees: async () => [{ id: "to-aed", name: "AED Current", transferAccountId: "aed" }],
      deleteTransactionForSync,
      updateTransactionForSync,
    } as unknown as ActualBenchTransport;
    return { transport, deleteTransactionForSync, updateTransactionForSync };
  };
  const input = (ownsTransferLeg: boolean, payload: JsonObject = {}) => ({ itemId: "i", targetId: "S1", expectedTargetFingerprint: baseline, payload, sourceFingerprint: "new", ownsTransferLeg });

  it("deletes only a split this sync made, and not once a line's other leg is reconciled", async () => {
    const owned = transportWith(false);
    expect((await adapter.deleteBatch!(owned.transport, flow(), [input(true)]))[0].outcome).toBe("deleted");

    const reconciled = transportWith(true);
    const [held] = await adapter.deleteBatch!(reconciled.transport, flow(), [input(true)]);
    expect(held).toMatchObject({ outcome: "skipped", mappingPatch: { status: "source_missing" } });
    expect(held.message).toContain("reconciled");
    expect(reconciled.deleteTransactionForSync).not.toHaveBeenCalled();

    const external = transportWith(false);
    const [kept] = await adapter.deleteBatch!(external.transport, flow(), [input(false)]);
    expect(kept).toMatchObject({ outcome: "skipped", mappingPatch: { status: "source_missing" } });
    expect(external.deleteTransactionForSync).not.toHaveBeenCalled();
  });

  it("does not rewrite a split's lines when a line's other leg is reconciled", async () => {
    const { transport, updateTransactionForSync } = transportWith(true);
    const payload = { date: "2026-11-20", amount: 1020000, notes: null, subtransactions: [{ amount: 1010000, notes: null }, { amount: 10000, notes: null }] };
    const [result] = await adapter.updateBatch!(transport, flow(), [input(true, payload)]);
    expect(result).toMatchObject({ outcome: "skipped", mappingPatch: { sourceFingerprint: "new" } });
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });
});

describe("an update that turns a row into a transfer", () => {
  it("is flagged, and held like a new transfer when the other side is already there", async () => {
    const plainRow = target({ transactions: [{ id: "T1", date: "2026-11-20", amount: 1025000, payeeName: null, categoryId: null, transferId: null }] });
    const [planned] = plan([txn("a")], plainRow, [mapping("txn:a", "before", "T1")]).items;
    expect(planned.action).toBe("update");
    expect(planned.flags).toContain("creates_transfer");
    expect(planned.plannedTargetPayload).toMatchObject({ payeeId: "to-aed", transferAccountId: "aed" });
    expect(planned.message).toContain("becomes a transfer to AED Current");

    const t = { listTransactionsForSync: jest.fn(async () => [txn("r", { accountId: "aed", payeeName: null, amount: -1025000 })]) };
    const reviewed = await adapter.reviewPlan!(t as unknown as ActualBenchTransport, flow(), { flowId: "f", counts: {}, items: [planned] });
    expect(reviewed.items[0].selectedForApply).toBe(false);
    expect(reviewed.items[0].flags).toContain("transfer_may_duplicate");
  });

  it("is left out of a bulk apply when held", async () => {
    const saved = flow({}, { fxEnabled: false });
    const run: SyncFlowRun = { id: "r", flowId: "f", status: "draft_preview", startedAt: new Date().toISOString(), finishedAt: null, summary: envelope({ flowPlanHash: flowPlanHash(saved) }), error: null, createdByTrigger: "manual_preview", sourceSnapshotSummary: null, targetSnapshotSummary: null, counts: null };
    const held: SyncFlowRunItem = {
      id: "i", runId: "r", flowId: "f", sequence: 0, sourceItemRef: envelope({}), targetItemRef: envelope({ targetTransactionId: "T1" }), status: "planned", message: null,
      sourceEntityType: "transaction", sourceItemKey: "txn:a", sourceTransactionId: "a", sourceSplitId: null, sourceFingerprint: "fp",
      plannedAction: "update", classification: "source_changed_since_sync", duplicateConfidence: "none", warnings: envelope({ flags: ["creates_transfer", "transfer_may_duplicate"] }), errors: null, selectedForApply: false,
      applyState: "pending", createdTargetTransactionId: null, createdTargetMarker: null, createdAt: "", updatedAt: null,
      plannedTargetPayload: envelope({ accountId: "ta", date: "2026-11-20", amount: 1025000, payeeId: "to-aed", payeeName: null, categoryId: null, notes: null, cleared: false, importedId: "m", transferAccountId: "aed" }),
    };
    const store = {
      loadRun: async () => run, loadRunItems: async () => [held], loadFlow: async () => saved, getMappingBySource: async () => null,
      createMapping: async () => {}, updateMapping: async () => {}, updateRunStatus: async () => {},
      updateRunItemStatus: async () => {}, persistApplyFailure: async () => {}, persistFxSnapshot: async () => {},
    } as unknown as ApplyStore;
    const t = { listTransactionsForSync: async () => [] } as unknown as ActualBenchTransport;
    const bulk = await applySyncRun({ runId: "r", targetConnection: connection("T") }, { transport: { openTransport: async () => t }, store });
    expect(bulk.error?.code).toBe("no_eligible_items");
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

  it("holds every transfer that matches the same row", async () => {
    const one = planned(1000000);
    const two = { ...one.items[0], sourceItemKey: "txn:b", sourceTransactionId: "b" };
    const t = transport([{ amount: -1000000 }]);
    const reviewed = await adapter.reviewPlan!(t as unknown as ActualBenchTransport, flow(), { ...one, items: [one.items[0], two] });
    expect(reviewed.items.map((item) => item.selectedForApply)).toEqual([false, false]);
    expect(reviewed.items.every((item) => item.flags.includes("transfer_may_duplicate"))).toBe(true);
  });

  it("holds the transfer when the other account cannot be read", async () => {
    const t = { listTransactionsForSync: jest.fn(async () => { throw new Error("offline"); }) };
    const reviewed = await adapter.reviewPlan!(t as unknown as ActualBenchTransport, flow(), planned(1000000));
    expect(reviewed.items[0]).toMatchObject({ selectedForApply: false });
    expect(reviewed.items[0].flags).toContain("transfer_may_duplicate");
    expect(reviewed.items[0].message).toContain("AED Current could not be read");
  });

  it("checks a grouped split's transfer line", async () => {
    const base = planned(1010000);
    const payload = { ...base.items[0].plannedTargetPayload!, transferAccountId: undefined, transferAccountName: undefined, subtransactions: [
      { amount: 1000000, categoryId: null, payeeId: "to-aed", payeeName: null, notes: null, transferAccountId: "aed", transferAccountName: "AED Current" },
      { amount: 10000, categoryId: null, payeeId: "cafe", payeeName: null, notes: null },
    ] };
    const t = transport([{ amount: -1000000 }]);
    const reviewed = await adapter.reviewPlan!(t as unknown as ActualBenchTransport, flow(), { ...base, items: [{ ...base.items[0], plannedTargetPayload: payload }] });
    expect(reviewed.items[0].selectedForApply).toBe(false);
    expect(reviewed.items[0].message).toContain("AED Current already has -10,000.00");
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

  it("claims a found transfer's other leg only when this item's own earlier write made it", async () => {
    const marker = "absync:S:T:ta:txn:a";
    const repairWith = async (createdTargetTransactionId: string | null) => {
      const saved = flow({}, { fxEnabled: false });
      const run: SyncFlowRun = { id: "r", flowId: "f", status: "draft_preview", startedAt: new Date().toISOString(), finishedAt: null, summary: envelope({ flowPlanHash: flowPlanHash(saved) }), error: null, createdByTrigger: "manual_preview", sourceSnapshotSummary: null, targetSnapshotSummary: null, counts: null };
      const item: SyncFlowRunItem = {
        id: "i", runId: "r", flowId: "f", sequence: 0, sourceItemRef: envelope({}), targetItemRef: null, status: "planned", message: null,
        sourceEntityType: "transaction", sourceItemKey: "txn:a", sourceTransactionId: "a", sourceSplitId: null, sourceFingerprint: "fp",
        plannedAction: "create", classification: "new", duplicateConfidence: "none", warnings: envelope({ flags: ["creates_transfer"] }), errors: null, selectedForApply: true,
        applyState: createdTargetTransactionId ? "failed" : "pending", createdTargetTransactionId, createdTargetMarker: null, createdAt: "", updatedAt: null,
        plannedTargetPayload: envelope({ accountId: "ta", date: "2026-11-20", amount: 1000000, payeeId: "to-aed", payeeName: null, categoryId: null, notes: null, cleared: false, importedId: marker, transferAccountId: "aed" }),
      };
      const createMapping = jest.fn(async () => {});
      const store = {
        loadRun: async () => run, loadRunItems: async () => [item], loadFlow: async () => saved, getMappingBySource: async () => null,
        createMapping, updateMapping: async () => {}, updateRunStatus: async (_: string, patch: { status: SyncFlowRun["status"] }) => { run.status = patch.status; },
        updateRunItemStatus: async () => {}, persistApplyFailure: async () => {}, persistFxSnapshot: async () => {},
      } as unknown as ApplyStore;
      const createTransactionsForSync = jest.fn();
      const t = {
        listTransactionsForSync: async () => [txn("T1", { accountId: "ta", amount: 1000000, payeeId: "to-aed", importedId: marker, transferId: "L1" })],
        createTransactionsForSync,
      } as unknown as ActualBenchTransport;
      await applySyncRun({ runId: "r", targetConnection: connection("T"), selection: { selectedItemIds: ["i"] } }, { transport: { openTransport: async () => t }, store });
      expect(createTransactionsForSync).not.toHaveBeenCalled();
      return (createMapping.mock.calls[0] as unknown as [{ ownsTransferLeg?: boolean }])[0].ownsTransferLeg === true;
    };
    // Found on the target but not written by this item: it may be linked to the user's own row.
    expect(await repairWith(null)).toBe(false);
    // A Retry after this item wrote the row and its mapping failed.
    expect(await repairWith("T1")).toBe(true);
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

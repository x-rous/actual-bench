import { transactionAdapter } from "./transactionAdapter";
import { hashTargetFields } from "../targetFingerprint";
import type { ActualBenchTransport, SyncAppliedSnapshot } from "@/lib/actual/transport";
import type { AdapterMutateInput } from "../syncKind";
import type { SyncFlow } from "@/lib/app-db/types";

/**
 * RD-057 §4/§5: the transaction adapter's update/delete batches must re-read the
 * live target and refuse to overwrite or delete a target edited outside sync.
 */

function flow(): SyncFlow {
  return {
    id: "flow-1", name: "x", enabled: true, flowType: "transaction_sync",
    description: null, createdAt: "", updatedAt: "",
    legs: [{
      id: "leg-1", flowId: "flow-1", position: 0,
      sourceRef: { version: 1, data: { budgetId: "b-src", accountId: "a-src" } },
      targetRef: { version: 1, data: { budgetId: "b-tgt", accountId: "a-tgt" } },
      filter: { version: 1, data: {} }, transform: { version: 1, data: {} }, options: { version: 1, data: {} },
      createdAt: "", updatedAt: "",
    }],
  };
}

const liveTarget: SyncAppliedSnapshot = {
  amount: -1250, date: "2026-07-01", cleared: true, categoryId: "c1", payeeId: "p1", notes: "flat white",
};

function makeTransport(overrides: Partial<ActualBenchTransport> = {}) {
  const updateTransactionForSync = jest.fn(async () => ({ ...liveTarget, amount: -2000 }));
  const deleteTransactionForSync = jest.fn(async () => {});
  const readTargetTransactionForSync = jest.fn(async () => liveTarget);
  const transport = {
    readTargetTransactionForSync,
    updateTransactionForSync,
    deleteTransactionForSync,
    ...overrides,
  } as unknown as ActualBenchTransport;
  return { transport, updateTransactionForSync, deleteTransactionForSync, readTargetTransactionForSync };
}

const updateInput = (fp: string | null): AdapterMutateInput => ({
  itemId: "i1",
  targetId: "tgt-1",
  expectedTargetFingerprint: fp,
  payload: { date: "2026-07-01", amount: -2000, payeeId: "p1", categoryId: "c1", notes: "flat white", cleared: true },
});

describe("transactionAdapter.updateBatch (RD-057 §4)", () => {
  it("updates when the live target still matches the recorded fingerprint", async () => {
    const { transport, updateTransactionForSync } = makeTransport();
    const res = await transactionAdapter.updateBatch!(transport, flow(), [updateInput(hashTargetFields(liveTarget))]);
    expect(res[0].outcome).toBe("updated");
    expect(updateTransactionForSync).toHaveBeenCalledTimes(1);
    expect(res[0].targetFingerprint).toBe(hashTargetFields({ ...liveTarget, amount: -2000 }));
  });

  it("skips (never overwrites) when the target was edited outside sync", async () => {
    const { transport, updateTransactionForSync } = makeTransport();
    const res = await transactionAdapter.updateBatch!(transport, flow(), [updateInput("some-other-hash")]);
    expect(res[0].outcome).toBe("skipped");
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });

  it("skips when the target no longer exists", async () => {
    const { transport, updateTransactionForSync } = makeTransport({
      readTargetTransactionForSync: jest.fn(async () => null),
    });
    const res = await transactionAdapter.updateBatch!(transport, flow(), [updateInput(hashTargetFields(liveTarget))]);
    expect(res[0].outcome).toBe("skipped");
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });

  it("refuses to overwrite when there is no recorded baseline fingerprint", async () => {
    const { transport, updateTransactionForSync } = makeTransport();
    const res = await transactionAdapter.updateBatch!(transport, flow(), [updateInput(null)]);
    expect(res[0].outcome).toBe("skipped");
    expect(updateTransactionForSync).not.toHaveBeenCalled();
  });

  it("reports a failed item without discarding the rest of the batch", async () => {
    const updateTransactionForSync = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ...liveTarget, amount: -2000 });
    const { transport } = makeTransport({ updateTransactionForSync });
    const res = await transactionAdapter.updateBatch!(transport, flow(), [
      { ...updateInput(hashTargetFields(liveTarget)), itemId: "a" },
      { ...updateInput(hashTargetFields(liveTarget)), itemId: "b" },
    ]);
    expect(res.map((r) => `${r.itemId}:${r.outcome}`)).toEqual(["a:failed", "b:updated"]);
  });
});

describe("transactionAdapter.deleteBatch (RD-057 §5)", () => {
  it("deletes when the target still matches the recorded fingerprint", async () => {
    const { transport, deleteTransactionForSync } = makeTransport();
    const res = await transactionAdapter.deleteBatch!(transport, flow(), [
      { itemId: "i1", targetId: "tgt-1", expectedTargetFingerprint: hashTargetFields(liveTarget) },
    ]);
    expect(res[0].outcome).toBe("deleted");
    expect(deleteTransactionForSync).toHaveBeenCalledWith({ transactionId: "tgt-1" });
  });

  it("does not delete a target without a recorded baseline fingerprint", async () => {
    const { transport, deleteTransactionForSync } = makeTransport();
    const res = await transactionAdapter.deleteBatch!(transport, flow(), [
      { itemId: "i1", targetId: "tgt-1", expectedTargetFingerprint: null },
    ]);
    expect(res[0].outcome).toBe("skipped");
    expect(deleteTransactionForSync).not.toHaveBeenCalled();
  });

  it("does not delete a target edited outside sync", async () => {
    const { transport, deleteTransactionForSync } = makeTransport();
    const res = await transactionAdapter.deleteBatch!(transport, flow(), [
      { itemId: "i1", targetId: "tgt-1", expectedTargetFingerprint: "different" },
    ]);
    expect(res[0].outcome).toBe("skipped");
    expect(deleteTransactionForSync).not.toHaveBeenCalled();
  });
});

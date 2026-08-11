import type { ReconciliationTransport } from "@/lib/reconciliation/ports";
import type { ActualTransactionSnapshot } from "@/lib/reconciliation/types";
import { loadLatestForDrift } from "./loadDrift";

function transaction(id: string, over: Partial<ActualTransactionSnapshot> = {}) {
  return {
    id,
    accountId: "a1",
    date: "2026-07-04",
    amount: -1000,
    payeeId: null,
    payeeName: null,
    importedPayee: null,
    categoryId: null,
    categoryName: null,
    notes: null,
    cleared: false,
    reconciled: false,
    importedId: null,
    transferId: null,
    scheduleId: null,
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
    ...over,
  } satisfies ActualTransactionSnapshot;
}

function transportWith(input: {
  window: ActualTransactionSnapshot[];
  single?: Record<string, ActualTransactionSnapshot | null>;
}) {
  const loadTransactions = jest.fn().mockResolvedValue({
    transactions: input.window,
    transfersReported: true,
  });
  const readTransaction = jest
    .fn()
    .mockImplementation(async ({ transactionId }: { transactionId: string }) =>
      input.single?.[transactionId] ?? null
    );

  return {
    transport: { loadTransactions, readTransaction } as unknown as ReconciliationTransport,
    loadTransactions,
    readTransaction,
  };
}

describe("re-reading the rows an apply is about to write", () => {
  it("reads the whole window once rather than one row at a time", () => {
    // The reason this exists: a read per row is what made applying slow in the
    // first place, and a pre-flight check that costs as much as the write would
    // not survive contact with a real statement.
    const { transport, loadTransactions, readTransaction } = transportWith({
      window: [transaction("t1"), transaction("t2"), transaction("t3")],
    });

    return loadLatestForDrift({
      transport,
      accountId: "a1",
      transactionIds: ["t1", "t2", "t3"],
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    }).then((latest) => {
      expect(loadTransactions).toHaveBeenCalledTimes(1);
      expect(readTransaction).not.toHaveBeenCalled();
      expect(latest.get("t2")?.id).toBe("t2");
    });
  });

  it("reads individually only the rows the window could not account for", async () => {
    const { transport, readTransaction } = transportWith({
      window: [transaction("t1")],
      single: { t2: transaction("t2", { date: "2026-09-30" }) },
    });

    const latest = await loadLatestForDrift({
      transport,
      accountId: "a1",
      transactionIds: ["t1", "t2"],
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });

    expect(readTransaction).toHaveBeenCalledTimes(1);
    // Moved out of the window rather than deleted — a distinction the user is
    // owed, since the two call for completely different words.
    expect(latest.get("t2")?.date).toBe("2026-09-30");
  });

  it("records a genuinely deleted row as gone", async () => {
    const { transport } = transportWith({ window: [], single: {} });

    const latest = await loadLatestForDrift({
      transport,
      accountId: "a1",
      transactionIds: ["t1"],
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });

    expect(latest.has("t1")).toBe(true);
    expect(latest.get("t1")).toBeNull();
  });

  it("does not touch the transport when there is nothing to check", async () => {
    const { transport, loadTransactions } = transportWith({ window: [] });

    const latest = await loadLatestForDrift({
      transport,
      accountId: "a1",
      transactionIds: [],
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });

    expect(latest.size).toBe(0);
    expect(loadTransactions).not.toHaveBeenCalled();
  });
});

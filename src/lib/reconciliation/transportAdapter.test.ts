import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import {
  createReconciliationTransport,
  toActualSnapshot,
  transferStatusOf,
  transportReportsTransfers,
} from "./transportAdapter";

function sourceRow(overrides: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction {
  return {
    id: "t1",
    accountId: "acct-1",
    date: "2026-07-01",
    amount: -4250,
    payeeId: "p1",
    payeeName: "Starbucks",
    categoryId: "c1",
    categoryName: "Coffee",
    notes: "flat white",
    cleared: true,
    reconciled: false,
    importedId: "bank-1",
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
    ...overrides,
  };
}

function fakeTransport(rows: SyncSourceTransaction[]): ActualBenchTransport {
  return {
    listTransactionsForSync: jest.fn().mockResolvedValue(rows),
    readTargetTransactionForSync: jest.fn(),
    createTransactionsForSync: jest.fn(),
    updateTransactionForSync: jest.fn(),
    deleteTransactionForSync: jest.fn(),
    createOrResolvePayee: jest.fn(),
  } as unknown as ActualBenchTransport;
}

describe("transportReportsTransfers", () => {
  it("is true when any row carries the field, even as null", () => {
    expect(transportReportsTransfers([sourceRow({ transferId: null })])).toBe(true);
  });

  it("is false when no row carries the field at all", () => {
    expect(transportReportsTransfers([sourceRow(), sourceRow({ id: "t2" })])).toBe(false);
  });

  it("is false for an empty window", () => {
    expect(transportReportsTransfers([])).toBe(false);
  });
});

describe("transferStatusOf", () => {
  const reported = toActualSnapshot(sourceRow({ transferId: "xfer-1" }), {
    transfersReported: true,
  });
  const notATransfer = toActualSnapshot(sourceRow({ transferId: null }), {
    transfersReported: true,
  });
  const unreported = toActualSnapshot(sourceRow(), { transfersReported: false });

  it("reports a transfer leg", () => {
    expect(transferStatusOf(reported, true)).toBe("yes");
  });

  it("reports a non-transfer when the transport does expose the field", () => {
    expect(transferStatusOf(notATransfer, true)).toBe("no");
  });

  it("reports unknown when the transport never exposes the field", () => {
    // The important case: "no transfers reported" must not be read as "no
    // transfers exist", or the delete guardrail would silently allow deleting
    // one leg of a transfer and mutate another account.
    expect(transferStatusOf(unreported, false)).toBe("unknown");
  });
});

describe("toActualSnapshot", () => {
  it("normalizes absent optional fields to null", () => {
    const snapshot = toActualSnapshot(sourceRow(), { transfersReported: false });
    expect(snapshot.importedPayee).toBeNull();
    expect(snapshot.transferId).toBeNull();
    expect(snapshot.scheduleId).toBeNull();
  });

  it("keeps the imported payee separate from the curated payee", () => {
    const snapshot = toActualSnapshot(
      sourceRow({ payeeName: "Amazon", importedPayee: "AMZN Mktp AE*2J8G4" }),
      { transfersReported: true }
    );
    expect(snapshot.payeeName).toBe("Amazon");
    expect(snapshot.importedPayee).toBe("AMZN Mktp AE*2J8G4");
  });

  it("carries split children through for display", () => {
    const snapshot = toActualSnapshot(
      sourceRow({
        isParent: true,
        splitLines: [
          {
            id: "c1",
            amount: -1000,
            payeeId: null,
            payeeName: null,
            categoryId: "g",
            categoryName: "Groceries",
            notes: null,
          },
        ],
      }),
      { transfersReported: true }
    );
    expect(snapshot.splitLines).toEqual([
      { id: "c1", amount: -1000, payeeName: null, categoryId: "g", categoryName: "Groceries", notes: null },
    ]);
  });
});

describe("createReconciliationTransport", () => {
  it("loads the window and excludes split children", async () => {
    const transport = createReconciliationTransport(
      fakeTransport([
        sourceRow({ id: "parent", isParent: true }),
        sourceRow({ id: "child", isChild: true, parentId: "parent" }),
      ])
    );

    const loaded = await transport.loadTransactions({
      accountId: "acct-1",
      startDate: "2026-06-24",
      endDate: "2026-08-07",
    });

    expect(loaded.transactions.map((r) => r.id)).toEqual(["parent"]);
  });

  it("passes the date window straight through", async () => {
    const inner = fakeTransport([]);
    await createReconciliationTransport(inner).loadTransactions({
      accountId: "acct-1",
      startDate: "2026-06-24",
      endDate: "2026-08-07",
    });

    expect(inner.listTransactionsForSync).toHaveBeenCalledWith({
      accountId: "acct-1",
      startDate: "2026-06-24",
      endDate: "2026-08-07",
    });
  });

  it("returns null when a re-read finds the transaction gone", async () => {
    const inner = fakeTransport([]);
    (inner.readTargetTransactionForSync as jest.Mock).mockResolvedValue(null);

    const result = await createReconciliationTransport(inner).readTransaction({
      accountId: "acct-1",
      transactionId: "t1",
    });

    expect(result).toBeNull();
  });

  it("maps a re-read into a snapshot carrying the drift-relevant fields", async () => {
    const inner = fakeTransport([]);
    (inner.readTargetTransactionForSync as jest.Mock).mockResolvedValue({
      amount: -4250,
      date: "2026-07-02",
      cleared: true,
      categoryId: "c9",
      payeeId: "p9",
      notes: "Imported #One | Paid by Manaf",
    });

    const result = await createReconciliationTransport(inner).readTransaction({
      accountId: "acct-1",
      transactionId: "t1",
    });

    expect(result).toMatchObject({
      id: "t1",
      notes: "Imported #One | Paid by Manaf",
      categoryId: "c9",
      amount: -4250,
    });
  });

  it("forwards the deterministic marker on create", async () => {
    const inner = fakeTransport([]);
    (inner.createTransactionsForSync as jest.Mock).mockResolvedValue({
      created: [{ requestIndex: 0, transactionId: "new-1", importedId: "recon:abc" }],
    });

    const created = await createReconciliationTransport(inner).createTransactions([
      {
        accountId: "acct-1",
        date: "2026-07-05",
        amount: -6850,
        payeeName: "Dubai Taxi",
        importedId: "recon:abc",
      },
    ]);

    expect(inner.createTransactionsForSync).toHaveBeenCalledWith([
      expect.objectContaining({ importedId: "recon:abc" }),
    ]);
    expect(created).toEqual([
      { requestIndex: 0, transactionId: "new-1", importedId: "recon:abc" },
    ]);
  });

  it("forwards the bank's merchant text on create, beside the payee", async () => {
    const inner = fakeTransport([]);
    (inner.createTransactionsForSync as jest.Mock).mockResolvedValue({ created: [] });

    await createReconciliationTransport(inner).createTransactions([
      {
        accountId: "acct-1",
        date: "2026-08-01",
        amount: -12550,
        payeeId: "payee-amazon",
        importedPayee: "AMZN Mktp AE*23981",
        importedId: "recon:abc",
      },
    ]);

    expect(inner.createTransactionsForSync).toHaveBeenCalledWith([
      expect.objectContaining({
        payeeId: "payee-amazon",
        importedPayee: "AMZN Mktp AE*23981",
      }),
    ]);
  });

  it("forwards provenance on an update without inventing other fields", async () => {
    const inner = fakeTransport([]);
    (inner.updateTransactionForSync as jest.Mock).mockResolvedValue(null);

    await createReconciliationTransport(inner).updateTransaction({
      transactionId: "t1",
      accountId: "acct-1",
      date: "2026-08-01",
      amount: -12550,
      importedPayee: "AMZN Mktp AE*23981",
    });

    const [input] = (inner.updateTransactionForSync as jest.Mock).mock.calls[0];
    expect(input).toMatchObject({
      transactionId: "t1",
      importedPayee: "AMZN Mktp AE*23981",
      returnApplied: false,
    });
    expect(input.notes).toBeUndefined();
    expect(input.payeeId).toBeUndefined();
  });
});

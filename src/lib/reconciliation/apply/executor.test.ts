import type { ReconciliationTransport } from "../ports";
import { executeApplyPlan } from "./executor";
import type { ApplyOperation, ApplyPlan, OperationResult } from "./operations";

function fakeTransport(overrides: Partial<ReconciliationTransport> = {}): ReconciliationTransport {
  return {
    loadTransactions: jest.fn(),
    readTransaction: jest.fn(),
    createTransactions: jest
      .fn()
      .mockResolvedValue([{ requestIndex: 0, transactionId: "new-1", importedId: "recon:abc" }]),
    updateTransaction: jest.fn().mockResolvedValue(null),
    deleteTransaction: jest.fn().mockResolvedValue(undefined),
    resolvePayee: jest.fn(),
    ...overrides,
  } as unknown as ReconciliationTransport;
}

const CREATE: ApplyOperation = {
  id: "create:i1",
  kind: "create",
  itemId: "i1",
  statementRowId: "s1",
  accountId: "acct-1",
  date: "2026-07-12",
  amount: -6850,
  payeeId: null,
  payeeName: "DUBAI TAXI",
  importedPayee: null,
  categoryId: null,
  notes: null,
  marker: "recon:abc",
};

const UPDATE: ApplyOperation = {
  id: "update:i2",
  kind: "update",
  itemId: "i2",
  transactionId: "t1",
  accountId: "acct-1",
  date: "2026-07-12",
  amount: -6850,
  patch: { notes: { original: "#API X", staged: "#2026-07 X", source: "transform" } },
};

const DELETE: ApplyOperation = {
  id: "delete:i3",
  kind: "delete",
  itemId: "i3",
  transactionId: "t2",
  accountId: "acct-1",
  date: "2026-07-13",
  amount: -100,
};

/** The payload one operation produces, for asserting what is *not* sent. */
function transportCallFor(operation: ApplyOperation): unknown {
  const transport = fakeTransport();
  void executeApplyPlan({ plan: planOf([operation]), transport });
  return (transport.updateTransaction as jest.Mock).mock.calls[0]?.[0];
}

function planOf(operations: ApplyOperation[]): ApplyPlan {
  return { operations, alreadyApplied: 0, noWriteMatches: 0, unresolved: 0, blocked: [] };
}

describe("executeApplyPlan", () => {
  it("applies each operation and reports the tally", async () => {
    const transport = fakeTransport();
    const result = await executeApplyPlan({
      plan: planOf([CREATE, UPDATE, DELETE]),
      transport,
    });

    expect(result.applied).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.complete).toBe(true);
    expect(transport.createTransactions).toHaveBeenCalledTimes(1);
    expect(transport.updateTransaction).toHaveBeenCalledTimes(1);
    expect(transport.deleteTransaction).toHaveBeenCalledTimes(1);
  });

  it("writes the deterministic marker on a create", async () => {
    const transport = fakeTransport();
    await executeApplyPlan({ plan: planOf([CREATE]), transport });

    expect(transport.createTransactions).toHaveBeenCalledWith([
      expect.objectContaining({ importedId: "recon:abc" }),
    ]);
  });

  it("sends only the staged fields on an update", async () => {
    // undefined means "leave alone"; collapsing it to null would wipe a
    // category the user never touched.
    const transport = fakeTransport();
    await executeApplyPlan({ plan: planOf([UPDATE]), transport });

    expect(transport.updateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "t1",
        notes: "#2026-07 X",
        payeeId: undefined,
      })
    );
  });

  it("never sends a category, so an update cannot clear one", () => {
    // Categorising belongs in Actual. The field is absent from the model, so
    // there is no path by which reconciliation can set or clear it.
    const sent = Object.keys(
      (transportCallFor(UPDATE) ?? {}) as Record<string, unknown>
    );
    expect(sent).not.toContain("categoryId");
  });

  it("distinguishes clearing a field from leaving it alone", async () => {
    const transport = fakeTransport();
    await executeApplyPlan({
      plan: planOf([
        {
          ...UPDATE,
          patch: { payeeId: { original: "p1", staged: null, source: "manual" } },
        } as ApplyOperation,
      ]),
      transport,
    });

    // null means clear it; undefined means leave it alone. Collapsing the two
    // is what wiped fields nobody asked to change.
    expect(transport.updateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ payeeId: null, notes: undefined })
    );
  });
});

describe("partial failure (feature spec §40)", () => {
  it("keeps going after a failure and reports it", async () => {
    const transport = fakeTransport({
      updateTransaction: jest.fn().mockRejectedValue(new Error("server said no")),
    });

    const result = await executeApplyPlan({
      plan: planOf([CREATE, UPDATE, DELETE]),
      transport,
    });

    expect(result.applied).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.complete).toBe(false);
    // The delete after the failure still ran.
    expect(transport.deleteTransaction).toHaveBeenCalled();

    const failure = result.results.find((entry) => entry.status === "failed");
    expect(failure?.error).toBe("server said no");
  });

  it("persists each outcome before attempting the next write", async () => {
    // A crash between two writes must leave a record of the first, or the retry
    // is blind to what already happened.
    const seen: string[] = [];
    const transport = fakeTransport({
      updateTransaction: jest.fn().mockImplementation(async () => {
        seen.push("update-write");
        return null;
      }),
    });

    await executeApplyPlan({
      plan: planOf([UPDATE, DELETE]),
      transport,
      onResult: async (result) => {
        seen.push(`persisted:${result.operationId}`);
      },
    });

    expect(seen).toEqual(["update-write", "persisted:update:i2", "persisted:delete:i3"]);
  });

  it("reports progress as it goes", async () => {
    const progress: number[] = [];
    await executeApplyPlan({
      plan: planOf([CREATE, UPDATE]),
      transport: fakeTransport(),
      onProgress: (entry) => progress.push(entry.completed),
    });

    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(2);
  });
});

describe("retry safety (RD-071 D14)", () => {
  it("never recreates a transaction an earlier attempt already created", async () => {
    const transport = fakeTransport();
    const result = await executeApplyPlan({
      plan: planOf([CREATE]),
      transport,
      existingMarkers: new Set(["recon:abc"]),
    });

    expect(transport.createTransactions).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.results[0].skippedBecause).toMatch(/already created/i);
    // A skip is not a failure: the session is still complete.
    expect(result.complete).toBe(true);
  });

  it("does not repeat an operation recorded as applied in a previous run", async () => {
    const transport = fakeTransport();
    const previousResults: OperationResult[] = [
      { operationId: "update:i2", status: "applied", transactionId: "t1" },
    ];

    const result = await executeApplyPlan({
      plan: planOf([UPDATE, DELETE]),
      transport,
      previousResults,
    });

    expect(transport.updateTransaction).not.toHaveBeenCalled();
    expect(transport.deleteTransaction).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(2);
  });

  it("does retry an operation that previously failed", async () => {
    const transport = fakeTransport();
    const result = await executeApplyPlan({
      plan: planOf([UPDATE]),
      transport,
      previousResults: [{ operationId: "update:i2", status: "failed", error: "timeout" }],
    });

    expect(transport.updateTransaction).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(1);
  });

  it("applies a full retry of a half-applied plan with no duplicates", async () => {
    const transport = fakeTransport();
    const plan = planOf([CREATE, UPDATE, DELETE]);

    const first = await executeApplyPlan({
      plan,
      transport: fakeTransport({
        updateTransaction: jest.fn().mockRejectedValue(new Error("boom")),
      }),
    });
    expect(first.failed).toBe(1);

    const second = await executeApplyPlan({
      plan,
      transport,
      previousResults: first.results,
      // The create succeeded first time round, so its marker is now in Actual.
      existingMarkers: new Set(["recon:abc"]),
    });

    expect(transport.createTransactions).not.toHaveBeenCalled();
    expect(transport.deleteTransaction).not.toHaveBeenCalled();
    expect(transport.updateTransaction).toHaveBeenCalledTimes(1);
    expect(second.complete).toBe(true);
  });
});

describe("an empty plan", () => {
  it("does nothing and reports complete", async () => {
    const transport = fakeTransport();
    const result = await executeApplyPlan({ plan: planOf([]), transport });

    expect(result.applied).toBe(0);
    expect(result.complete).toBe(true);
    expect(transport.createTransactions).not.toHaveBeenCalled();
  });
});

describe("creates are sent as one batch", () => {
  const secondCreate: ApplyOperation = {
    ...CREATE,
    id: "create:i9",
    itemId: "i9",
    statementRowId: "s9",
    marker: "recon:def",
  };

  it("issues a single call for many creates", async () => {
    // The transport resolves every payee in the budget once per call and reads
    // the account back to recover ids, so one call per row repeats that work
    // for every row — the difference between seconds and minutes.
    const transport = fakeTransport({
      createTransactions: jest.fn().mockResolvedValue([
        { requestIndex: 0, transactionId: "new-1", importedId: "recon:abc" },
        { requestIndex: 1, transactionId: "new-2", importedId: "recon:def" },
      ]),
    });

    const result = await executeApplyPlan({
      plan: planOf([CREATE, secondCreate]),
      transport,
    });

    expect(transport.createTransactions).toHaveBeenCalledTimes(1);
    expect((transport.createTransactions as jest.Mock).mock.calls[0][0]).toHaveLength(2);
    expect(result.applied).toBe(2);
  });

  it("maps each created id back to the operation that asked for it", async () => {
    const transport = fakeTransport({
      createTransactions: jest.fn().mockResolvedValue([
        { requestIndex: 0, transactionId: "new-1", importedId: "recon:abc" },
        { requestIndex: 1, transactionId: "new-2", importedId: "recon:def" },
      ]),
    });

    const result = await executeApplyPlan({
      plan: planOf([CREATE, secondCreate]),
      transport,
    });

    const byOperation = new Map(result.results.map((entry) => [entry.operationId, entry]));
    expect(byOperation.get("create:i1")?.transactionId).toBe("new-1");
    expect(byOperation.get("create:i9")?.transactionId).toBe("new-2");
  });

  it("leaves an already-created row out of the batch", async () => {
    const transport = fakeTransport({
      createTransactions: jest
        .fn()
        .mockResolvedValue([{ requestIndex: 0, transactionId: "new-2", importedId: "recon:def" }]),
    });

    const result = await executeApplyPlan({
      plan: planOf([CREATE, secondCreate]),
      transport,
      existingMarkers: new Set(["recon:abc"]),
    });

    expect((transport.createTransactions as jest.Mock).mock.calls[0][0]).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.applied).toBe(1);
  });

  it("reports every create as failed when the batch fails", async () => {
    // One call means one outcome; each is still reported rather than left
    // unexplained.
    const transport = fakeTransport({
      createTransactions: jest.fn().mockRejectedValue(new Error("server said no")),
    });

    const result = await executeApplyPlan({
      plan: planOf([CREATE, secondCreate, DELETE]),
      transport,
    });

    expect(result.failed).toBe(2);
    // The delete still ran.
    expect(transport.deleteTransaction).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(1);
  });

  it("still reports results in plan order", async () => {
    const transport = fakeTransport({
      createTransactions: jest
        .fn()
        .mockResolvedValue([{ requestIndex: 0, transactionId: "new-1", importedId: "recon:abc" }]),
    });

    const result = await executeApplyPlan({
      plan: planOf([UPDATE, CREATE, DELETE]),
      transport,
    });

    expect(result.results.map((entry) => entry.operationId)).toEqual([
      "update:i2",
      "create:i1",
      "delete:i3",
    ]);
  });
});

describe("updates and deletes go together where the transport allows", () => {
  const secondUpdate: ApplyOperation = { ...UPDATE, id: "update:i7", itemId: "i7", transactionId: "t7" };

  function batchingTransport(overrides: Partial<ReconciliationTransport> = {}) {
    return fakeTransport({ batchWrite: jest.fn().mockResolvedValue(undefined), ...overrides });
  }

  it("sends them in one call instead of one each", async () => {
    const transport = batchingTransport();
    const result = await executeApplyPlan({
      plan: planOf([UPDATE, secondUpdate, DELETE]),
      transport,
    });

    expect(transport.batchWrite).toHaveBeenCalledTimes(1);
    expect(transport.updateTransaction).not.toHaveBeenCalled();
    expect(transport.deleteTransaction).not.toHaveBeenCalled();
    expect(result.applied).toBe(3);
  });

  it("carries only the staged fields into the batch", async () => {
    const transport = batchingTransport();
    await executeApplyPlan({ plan: planOf([UPDATE, secondUpdate]), transport });

    const sent = (transport.batchWrite as jest.Mock).mock.calls[0][0];
    expect(sent.updated[0]).toMatchObject({ transactionId: "t1", notes: "#2026-07 X" });
    expect(sent.updated[0].payeeId).toBeUndefined();
  });

  it("reports each operation as failed when the batch fails", async () => {
    const transport = batchingTransport({
      batchWrite: jest.fn().mockRejectedValue(new Error("server said no")),
    });

    const result = await executeApplyPlan({
      plan: planOf([UPDATE, secondUpdate]),
      transport,
    });

    expect(result.failed).toBe(2);
    expect(result.results.every((entry) => entry.error === "server said no")).toBe(true);
  });

  it("leaves already-applied operations out of the batch", async () => {
    const thirdUpdate: ApplyOperation = {
      ...UPDATE,
      id: "update:i8",
      itemId: "i8",
      transactionId: "t8",
    };
    const transport = batchingTransport();
    await executeApplyPlan({
      plan: planOf([UPDATE, secondUpdate, thirdUpdate]),
      transport,
      previousResults: [{ operationId: "update:i2", status: "applied", transactionId: "t1" }],
    });

    const sent = (transport.batchWrite as jest.Mock).mock.calls[0][0];
    expect(sent.updated.map((entry: { transactionId: string }) => entry.transactionId)).toEqual([
      "t7",
      "t8",
    ]);
  });

  it("writes one at a time when the transport cannot batch", async () => {
    // HTTP mode has no batch primitive; the sequential path must still work.
    const transport = fakeTransport();
    const result = await executeApplyPlan({
      plan: planOf([UPDATE, secondUpdate, DELETE]),
      transport,
    });

    expect(transport.updateTransaction).toHaveBeenCalledTimes(2);
    expect(transport.deleteTransaction).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(3);
  });

  it("does not batch a single write", async () => {
    const transport = batchingTransport();
    await executeApplyPlan({ plan: planOf([UPDATE]), transport });

    expect(transport.batchWrite).not.toHaveBeenCalled();
    expect(transport.updateTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("bank provenance through the executor (RD-072)", () => {
  it("sends the create's imported payee to the transport", async () => {
    const transport = fakeTransport();
    await executeApplyPlan({
      plan: planOf([{ ...CREATE, importedPayee: "AMZN Mktp AE*23981" } as ApplyOperation]),
      transport,
    });

    expect((transport.createTransactions as jest.Mock).mock.calls[0][0][0]).toMatchObject({
      importedPayee: "AMZN Mktp AE*23981",
      importedId: "recon:abc",
    });
  });

  it("sends an enrichment-only update as provenance and nothing else", async () => {
    const transport = fakeTransport();
    await executeApplyPlan({
      plan: planOf([
        {
          id: "update:i9",
          kind: "update",
          itemId: "i9",
          transactionId: "t9",
          accountId: "acct-1",
          date: "2026-08-01",
          amount: -12550,
          patch: {},
          importedPayee: "AMZN Mktp AE*23981",
        } as ApplyOperation,
      ]),
      transport,
    });

    const [payload] = (transport.updateTransaction as jest.Mock).mock.calls[0];
    expect(payload.importedPayee).toBe("AMZN Mktp AE*23981");
    // The user's fields are absent, which is what stops a provenance write from
    // clearing a note or a payee.
    expect(payload.notes).toBeUndefined();
    expect(payload.payeeId).toBeUndefined();
  });

  it("leaves provenance undefined on an ordinary staged update", async () => {
    const transport = fakeTransport();
    await executeApplyPlan({ plan: planOf([UPDATE]), transport });

    const [payload] = (transport.updateTransaction as jest.Mock).mock.calls[0];
    expect(payload.importedPayee).toBeUndefined();
  });
});

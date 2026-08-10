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

function planOf(operations: ApplyOperation[]): ApplyPlan {
  return { operations, noWriteMatches: 0, unresolved: 0, blocked: [] };
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
        categoryId: undefined,
        payeeId: undefined,
      })
    );
  });

  it("distinguishes clearing a field from leaving it alone", async () => {
    const transport = fakeTransport();
    await executeApplyPlan({
      plan: planOf([
        {
          ...UPDATE,
          patch: { categoryId: { original: "c1", staged: null, source: "manual" } },
        } as ApplyOperation,
      ]),
      transport,
    });

    expect(transport.updateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: null, notes: undefined })
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

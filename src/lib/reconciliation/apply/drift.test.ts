import type { ActualTransactionSnapshot } from "../types";
import { driftTargets, reconcilePlanWithDrift } from "./drift";
import type { ApplyPlan, UpdateOperation } from "./operations";

function snapshot(over: Partial<ActualTransactionSnapshot> = {}): ActualTransactionSnapshot {
  return {
    id: "t1",
    accountId: "a1",
    date: "2026-07-04",
    amount: -4250,
    payeeId: "p1",
    payeeName: "Shop",
    importedPayee: null,
    categoryId: "c1",
    categoryName: "Groceries",
    notes: "Imported #One",
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
  };
}

function updateOperation(over: Partial<UpdateOperation> = {}): UpdateOperation {
  return {
    id: "op1",
    kind: "update",
    itemId: "i1",
    transactionId: "t1",
    accountId: "a1",
    date: "2026-07-04",
    amount: -4250,
    patch: {},
    ...over,
  };
}

function planOf(...operations: ApplyPlan["operations"]): ApplyPlan {
  return { operations, alreadyApplied: 0, noWriteMatches: 0, unresolved: 0, blocked: [] };
}

describe("checking a plan against what Actual says now", () => {
  it("lets an untouched row through", () => {
    const { report, plan } = reconcilePlanWithDrift({
      plan: planOf(
        updateOperation({
          patch: { notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" } },
        })
      ),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot()]]),
    });

    expect(report.clean).toBe(true);
    expect(plan.operations).toHaveLength(1);
  });

  it("replays a staged tag rename onto a note edited in the meantime", () => {
    const { report, plan } = reconcilePlanWithDrift({
      plan: planOf(
        updateOperation({
          patch: { notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" } },
        })
      ),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot({ notes: "Imported #One | Manual text" })]]),
    });

    expect(report.withheld).toHaveLength(0);
    const written = plan.operations[0] as UpdateOperation;
    expect(written.patch.notes?.staged).toBe("Imported #Two | Manual text");
    // The recorded original moves to what Actual says now, so the diff shown
    // afterwards describes the write that will actually happen.
    expect(written.patch.notes?.original).toBe("Imported #One | Manual text");
    expect(report.verdicts[0]).toMatchObject({ status: "rebased" });
  });

  it("withholds a row whose note moved in a way it cannot replay", () => {
    const { report, plan } = reconcilePlanWithDrift({
      plan: planOf(
        updateOperation({
          patch: { notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" } },
        })
      ),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot({ notes: "Imported #Three" })]]),
    });

    expect(plan.operations).toHaveLength(0);
    expect(report.withheld[0]).toMatchObject({ status: "conflict", fields: ["notes"] });
  });

  it("withholds a row whose payee changed under a staged payee change", () => {
    // No merge is defensible here: one of the two payees has to lose, and that
    // is the user's call rather than this module's.
    const { report } = reconcilePlanWithDrift({
      plan: planOf(
        updateOperation({
          patch: { payeeId: { original: "p1", staged: "p2", source: "manual" } },
        })
      ),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot({ payeeId: "p9", payeeName: "Elsewhere" })]]),
    });

    expect(report.withheld[0]).toMatchObject({ status: "conflict", fields: ["payeeId"] });
    expect(report.withheld[0]).toHaveProperty("reason", expect.stringContaining("payee"));
  });

  it("refreshes an amount corrected in Actual rather than writing the old one back", () => {
    // The hazard that has nothing to do with staged fields: an update carries
    // the amount whether or not it is changing it, so a stale copy silently
    // reverts a correction made elsewhere.
    const { report, plan } = reconcilePlanWithDrift({
      plan: planOf(
        updateOperation({
          patch: { notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" } },
        })
      ),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot({ amount: -9900 })]]),
    });

    expect((plan.operations[0] as UpdateOperation).amount).toBe(-9900);
    expect(report.verdicts[0]).toMatchObject({ status: "refreshed", fields: ["amount"] });
  });

  it("refreshes a date moved in Actual the same way", () => {
    const { plan } = reconcilePlanWithDrift({
      plan: planOf(updateOperation({ cleared: true })),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot({ date: "2026-07-06" })]]),
    });

    expect((plan.operations[0] as UpdateOperation).date).toBe("2026-07-06");
  });

  it("does not refresh a field the user is deliberately changing", () => {
    const { plan } = reconcilePlanWithDrift({
      plan: planOf(
        updateOperation({
          amount: -4250,
          patch: { amount: { original: -4250, staged: -5000, source: "manual" } },
        })
      ),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot()]]),
    });

    expect((plan.operations[0] as UpdateOperation).amount).toBe(-4250);
  });

  it("withholds an update whose transaction was deleted in Actual", () => {
    const { report, plan } = reconcilePlanWithDrift({
      plan: planOf(updateOperation({ cleared: true })),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", null]]),
    });

    expect(plan.operations).toHaveLength(0);
    expect(report.withheld[0]).toMatchObject({ status: "vanished" });
  });

  it("drops a delete whose target is already gone without calling it a problem", () => {
    const { report, plan } = reconcilePlanWithDrift({
      plan: planOf({
        id: "op1",
        kind: "delete",
        itemId: "i1",
        transactionId: "t1",
        accountId: "a1",
        date: "2026-07-04",
        amount: -4250,
      }),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", null]]),
    });

    expect(plan.operations).toHaveLength(0);
    expect(report.verdicts[0]).toMatchObject({ status: "vanished" });
  });

  it("withholds a delete whose target was edited after being marked a duplicate", () => {
    // The reason it was safe to delete was that it duplicated another row. Once
    // someone has edited it, that reasoning no longer holds.
    const { report } = reconcilePlanWithDrift({
      plan: planOf({
        id: "op1",
        kind: "delete",
        itemId: "i1",
        transactionId: "t1",
        accountId: "a1",
        date: "2026-07-04",
        amount: -4250,
      }),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot({ amount: -5000 })]]),
    });

    expect(report.withheld[0]).toMatchObject({ status: "conflict" });
  });

  it("withholds a row reconciled in Actual since the session loaded it", () => {
    const { report } = reconcilePlanWithDrift({
      plan: planOf(updateOperation({ cleared: true })),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot({ reconciled: true })]]),
    });

    expect(report.withheld[0]).toMatchObject({ status: "conflict", fields: ["reconciled"] });
  });

  it("drops a redundant clear when Actual already cleared the row", () => {
    const { plan } = reconcilePlanWithDrift({
      plan: planOf(updateOperation({ cleared: true })),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map([["t1", snapshot({ cleared: true })]]),
    });

    expect((plan.operations[0] as UpdateOperation).cleared).toBeUndefined();
  });

  it("leaves creates alone, since they target nothing that can drift", () => {
    const { report, plan } = reconcilePlanWithDrift({
      plan: planOf({
        id: "op1",
        kind: "create",
        itemId: "i1",
        statementRowId: "s1",
        accountId: "a1",
        date: "2026-07-04",
        amount: -4250,
        payeeName: "Shop",
        importedPayee: null,
        payeeId: null,
        categoryId: null,
        notes: null,
        marker: "recon:abc",
      }),
      snapshots: new Map(),
      latest: new Map(),
    });

    expect(plan.operations).toHaveLength(1);
    expect(report.clean).toBe(true);
  });

  it("assumes a row that was not re-read is unchanged", () => {
    // A partial re-read must degrade to the previous behaviour rather than
    // withholding work on rows it knows nothing about.
    const { plan } = reconcilePlanWithDrift({
      plan: planOf(updateOperation({ cleared: true })),
      snapshots: new Map([["t1", snapshot()]]),
      latest: new Map(),
    });

    expect(plan.operations).toHaveLength(1);
  });
});

describe("choosing which rows to re-read", () => {
  it("names every transaction the plan would touch, once", () => {
    const plan = planOf(
      updateOperation({ id: "op1", transactionId: "t1", cleared: true }),
      updateOperation({ id: "op2", transactionId: "t1", cleared: true }),
      {
        id: "op3",
        kind: "delete",
        itemId: "i3",
        transactionId: "t2",
        accountId: "a1",
        date: "2026-07-04",
        amount: -1,
      },
      {
        id: "op4",
        kind: "create",
        itemId: "i4",
        statementRowId: "s1",
        accountId: "a1",
        date: "2026-07-04",
        amount: -1,
        payeeName: null,
        importedPayee: null,
        payeeId: null,
        categoryId: null,
        notes: null,
        marker: "recon:abc",
      }
    );

    expect(driftTargets(plan).sort()).toEqual(["t1", "t2"]);
  });
});

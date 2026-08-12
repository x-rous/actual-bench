import type { ActualTransactionSnapshot } from "../types";
import type { ApplyOperation, ApplyPlan, OperationResult } from "./operations";
import { verifyApply } from "./verification";

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

const createOperation: ApplyOperation = {
  id: "op-create",
  kind: "create",
  itemId: "i1",
  statementRowId: "s1",
  accountId: "a1",
  date: "2026-07-04",
  amount: -1000,
  payeeName: "Shop",
  importedPayee: null,
  payeeId: null,
  categoryId: null,
  notes: null,
  marker: "recon:abc",
};

const updateOperation: ApplyOperation = {
  id: "op-update",
  kind: "update",
  itemId: "i2",
  transactionId: "t1",
  accountId: "a1",
  date: "2026-07-04",
  amount: -4250,
  patch: { notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" } },
};

const deleteOperation: ApplyOperation = {
  id: "op-delete",
  kind: "delete",
  itemId: "i3",
  transactionId: "t9",
  accountId: "a1",
  date: "2026-07-04",
  amount: -100,
};

function planOf(...operations: ApplyOperation[]): ApplyPlan {
  return { operations, alreadyApplied: 0, noWriteMatches: 0, unresolved: 0, blocked: [] };
}

function allApplied(plan: ApplyPlan): OperationResult[] {
  return plan.operations.map((operation) => ({
    operationId: operation.id,
    status: "applied" as const,
  }));
}

describe("reading the account back after applying", () => {
  it("passes when the account says what was approved", () => {
    const plan = planOf(createOperation, updateOperation, deleteOperation);
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [
        snapshot({ id: "t2", importedId: "recon:abc" }),
        snapshot({ id: "t1", notes: "Imported #Two" }),
      ],
      snapshots: new Map([["t1", snapshot()]]),
    });

    expect(report.ok).toBe(true);
    expect(report.checked).toBe(3);
  });

  it("catches a create the transport claimed but never made", () => {
    const plan = planOf(createOperation);
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [],
      snapshots: new Map(),
    });

    expect(report.issues).toEqual([
      expect.objectContaining({ kind: "missing-create", operationId: "op-create" }),
    ]);
  });

  it("catches the same transaction created twice", () => {
    // The failure the deterministic marker exists to prevent, which is exactly
    // why it is worth confirming rather than assuming.
    const plan = planOf(createOperation);
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [
        snapshot({ id: "t2", importedId: "recon:abc" }),
        snapshot({ id: "t3", importedId: "recon:abc" }),
      ],
      snapshots: new Map(),
    });

    expect(report.issues[0]).toMatchObject({ kind: "duplicate-create" });
    expect(report.issues[0].detail).toContain("2 times");
  });

  it("catches a field the transport reported and dropped", () => {
    const plan = planOf(updateOperation);
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [snapshot({ notes: "Imported #One" })],
      snapshots: new Map([["t1", snapshot()]]),
    });

    expect(report.issues[0]).toMatchObject({ kind: "unapplied-field" });
    expect(report.issues[0].detail).toContain("notes");
  });

  it("catches provenance the transport accepted and dropped", () => {
    // The likeliest silent failure of the whole feature: `imported_payee` is not
    // part of most transaction write paths, so a wrapper can take it and ignore
    // it without erroring.
    const plan = planOf({
      ...updateOperation,
      patch: {},
      importedPayee: "AMZN Mktp AE*23981",
    });
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [snapshot({ importedPayee: null })],
      snapshots: new Map([["t1", snapshot()]]),
    });

    expect(report.issues[0]).toMatchObject({ kind: "unapplied-field" });
    expect(report.issues[0].detail).toContain("imported payee");
  });

  it("passes an enrichment that landed", () => {
    const plan = planOf({
      ...updateOperation,
      patch: {},
      importedPayee: "AMZN Mktp AE*23981",
    });
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [snapshot({ importedPayee: "AMZN Mktp AE*23981" })],
      snapshots: new Map([["t1", snapshot()]]),
    });

    expect(report.ok).toBe(true);
  });

  it("catches a clear that did not take", () => {
    const plan = planOf({ ...updateOperation, patch: {}, cleared: true });
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [snapshot({ cleared: false })],
      snapshots: new Map([["t1", snapshot()]]),
    });

    expect(report.issues[0]).toMatchObject({ kind: "unapplied-field" });
  });

  it("catches a delete that did not happen", () => {
    const plan = planOf(deleteOperation);
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [snapshot({ id: "t9" })],
      snapshots: new Map(),
    });

    expect(report.issues[0]).toMatchObject({ kind: "surviving-delete" });
  });

  it("catches a split parent whose lines no longer add up", () => {
    const plan = planOf(updateOperation);
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [
        snapshot({
          notes: "Imported #Two",
          isParent: true,
          amount: -4250,
          splitLines: [
            { id: "l1", amount: -2000, payeeName: null, categoryId: null, categoryName: null, notes: null },
            { id: "l2", amount: -1000, payeeName: null, categoryId: null, categoryName: null, notes: null },
          ],
        }),
      ],
      snapshots: new Map([["t1", snapshot()]]),
    });

    expect(report.issues[0]).toMatchObject({ kind: "split-sum" });
  });

  it("catches a reconciled row that moved", () => {
    const plan = planOf(updateOperation);
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [snapshot({ notes: "Imported #Two", reconciled: true })],
      snapshots: new Map([["t1", snapshot({ reconciled: true })]]),
    });

    expect(report.issues).toEqual([
      expect.objectContaining({ kind: "reconciled-changed" }),
    ]);
  });

  it("checks only what was actually applied", () => {
    // A failed operation's absence from the account is the expected outcome,
    // not a discrepancy to report on top of the failure the user already saw.
    const plan = planOf(createOperation);
    const report = verifyApply({
      plan,
      results: [{ operationId: "op-create", status: "failed", error: "network" }],
      latest: [],
      snapshots: new Map(),
    });

    expect(report.checked).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("does not treat a skipped create as missing", () => {
    const plan = planOf(createOperation);
    const report = verifyApply({
      plan,
      results: [
        { operationId: "op-create", status: "skipped", skippedBecause: "already created" },
      ],
      latest: [],
      snapshots: new Map(),
    });

    expect(report.ok).toBe(true);
  });
});

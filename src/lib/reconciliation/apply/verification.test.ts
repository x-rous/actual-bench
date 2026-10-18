import { recoverApply } from "./recovery";
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
  return { operations, alreadyApplied: 0, noWriteMatches: 0, unresolved: 0, blocked: [], unreconciledDifferences: [] };
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
        snapshot({ id: "t2", amount: -1000, importedId: "recon:abc" }),
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
        snapshot({ id: "t2", amount: -1000, importedId: "recon:abc" }),
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

  it("catches a created transaction that landed without its imported payee", () => {
    // Creates are the main provenance path, so the check that exists for
    // updates has to exist here too — otherwise the transport most likely to
    // drop the field is the one nothing verifies.
    const plan = planOf({ ...createOperation, importedPayee: "AMZN Mktp AE*23981" });
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [snapshot({ importedId: "recon:abc", importedPayee: null })],
      snapshots: new Map(),
    });

    expect(report.issues[0]).toMatchObject({ kind: "unapplied-field" });
    expect(report.issues[0].detail).toContain("imported payee");
  });

  it("passes a created transaction that carries its imported payee", () => {
    const plan = planOf({ ...createOperation, importedPayee: "AMZN Mktp AE*23981" });
    const report = verifyApply({
      plan,
      results: allApplied(plan),
      latest: [snapshot({ amount: -1000, importedId: "recon:abc", importedPayee: "AMZN Mktp AE*23981" })],
      snapshots: new Map(),
    });

    expect(report.ok).toBe(true);
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


it("does not verify a create whose amount/date/clearing differs from approval", () => {
  const plan = planOf({ ...createOperation, cleared: true });
  const report = verifyApply({ plan, results: allApplied(plan), latest: [snapshot({ importedId: "recon:abc" })], snapshots: new Map() });
  expect(report.ok).toBe(false);
  expect(report.issues.map((issue) => issue.detail).join(" ")).toContain("amount");
  expect(report.issues.map((issue) => issue.detail).join(" ")).toContain("cleared");
});

it("recovers only confirmed outcomes and leaves incomplete changes retryable", () => {
  const plan = planOf(createOperation, updateOperation, deleteOperation);
  const input = { plan, snapshots: new Map([["t1", snapshot()]]), latest: [snapshot({ id: "created", importedId: "recon:abc", amount: -1000 })] };
  const results = recoverApply(input);
  expect(results.find((result) => result.operationId === createOperation.id)).toMatchObject({ status: "skipped", transactionId: "created" });
  expect(results.find((result) => result.operationId === updateOperation.id)?.status).toBe("failed");
  expect(results.find((result) => result.operationId === deleteOperation.id)?.status).toBe("skipped");
  const duplicates = recoverApply({ ...input, latest: [...input.latest, snapshot({ id: "duplicate", importedId: "recon:abc", amount: -1000 })] });
  expect(duplicates.find((result) => result.operationId === createOperation.id)?.status).toBe("failed");
});

it("confirms and recovers a create after Actual rules rewrite its payee and notes", () => {
  const plan = planOf({ ...createOperation, payeeId: "approved-payee", notes: "Approved note", cleared: true });
  const input = {
    plan, snapshots: new Map(),
    latest: [snapshot({ id: "created", importedId: "recon:abc", amount: -1000,
      payeeId: "rule-payee", notes: "Rule note", cleared: true })],
  };
  expect(verifyApply({ ...input, results: allApplied(plan) })).toMatchObject({ ok: true, checked: 1, issues: [] });
  expect(recoverApply(input)).toEqual([expect.objectContaining({
    operationId: createOperation.id, status: "skipped", transactionId: "created",
  })]);
});

it.each([
  ["accountId", "another-account"],
  ["amount", -9999],
  ["date", "2026-07-05"],
  ["cleared", false],
])("still rejects and refuses to recover a create with a mismatched %s", (field, value) => {
  const plan = planOf({ ...createOperation, cleared: true });
  const input = {
    plan, snapshots: new Map(),
    latest: [snapshot({ importedId: "recon:abc", amount: -1000, cleared: true, [field]: value })],
  };
  expect(verifyApply({ ...input, results: allApplied(plan) })).toMatchObject({
    ok: false, issues: [expect.objectContaining({ kind: "unapplied-field" })],
  });
  expect(recoverApply(input)[0].status).toBe("failed");
});

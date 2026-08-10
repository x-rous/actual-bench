import { planCounts, totalChanges } from "../apply/operations";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StagedPatch,
  StatementRow,
} from "../types";
import { buildApplyPlan, createMarker, type ApplyConfig } from "./plan";

function row(overrides: Partial<StatementRow> & Pick<StatementRow, "id">): StatementRow {
  return {
    sourceRowNumber: 1,
    postedDate: "2026-07-12",
    amount: -6850,
    description: "DUBAI TAXI CORPORATION",
    raw: {},
    fingerprint: `fp-${overrides.id}`,
    ...overrides,
  };
}

function txn(
  overrides: Partial<ActualTransactionSnapshot> & Pick<ActualTransactionSnapshot, "id">
): ActualTransactionSnapshot {
  return {
    accountId: "acct-1",
    date: "2026-07-12",
    amount: -6850,
    payeeId: "p1",
    payeeName: "Dubai Taxi",
    importedPayee: null,
    categoryId: "c1",
    categoryName: "Transport",
    notes: "#API DUBAI TAXI",
    cleared: true,
    reconciled: false,
    importedId: null,
    transferId: null,
    scheduleId: null,
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
    ...overrides,
  };
}

function item(overrides: Partial<ReconciliationItem> & Pick<ReconciliationItem, "id">): ReconciliationItem {
  return {
    statementRowIds: [],
    actualTransactionIds: [],
    disposition: "unresolved",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    ...overrides,
  };
}

function plan(
  items: ReconciliationItem[],
  rows: StatementRow[] = [],
  transactions: ActualTransactionSnapshot[] = [],
  applyConfig?: ApplyConfig
) {
  return buildApplyPlan({
    applyConfig,
    sessionId: "sess-1",
    budgetSyncId: "budget-1",
    accountId: "acct-1",
    items,
    statementRows: new Map(rows.map((r) => [r.id, r])),
    transactions: new Map(transactions.map((t) => [t.id, t])),
  });
}

const NOTES_PATCH: StagedPatch = {
  notes: { original: "#API DUBAI TAXI", staged: "#2026-07 DUBAI TAXI", source: "transform" },
};

describe("a matched row with nothing staged is not a change", () => {
  it("emits no operation", () => {
    const result = plan(
      [item({ id: "i1", disposition: "matched", actualTransactionIds: ["t1"] })],
      [],
      [txn({ id: "t1" })]
    );

    expect(result.operations).toHaveLength(0);
    expect(result.noWriteMatches).toBe(1);
    expect(totalChanges(result)).toBe(0);
  });

  it("counts an explicit keep as resolved without a write", () => {
    const result = plan([item({ id: "i1", disposition: "keep", actualTransactionIds: ["t1"] })], [], [txn({ id: "t1" })]);
    expect(result.operations).toHaveLength(0);
    expect(result.noWriteMatches).toBe(1);
  });

  it("leaves an undecided row alone entirely", () => {
    const result = plan([item({ id: "i1", disposition: "unresolved" })]);
    expect(result.operations).toHaveLength(0);
    expect(result.unresolved).toBe(1);
  });
});

describe("update operations", () => {
  it("carries only the staged fields", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "matched",
          actualTransactionIds: ["t1"],
          stagedChanges: NOTES_PATCH,
        }),
      ],
      [],
      [txn({ id: "t1" })]
    );

    expect(result.operations).toHaveLength(1);
    const operation = result.operations[0];
    expect(operation.kind).toBe("update");
    if (operation.kind === "update") {
      expect(operation.transactionId).toBe("t1");
      expect(operation.patch.notes?.staged).toBe("#2026-07 DUBAI TAXI");
      expect(operation.patch.payeeId).toBeUndefined();
    }
  });

  it("refuses to plan an edit a guardrail forbids, even if it was staged", () => {
    // Defence in depth: the plan is the last point before a write and must not
    // assume the UI behaved.
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "matched",
          actualTransactionIds: ["t1"],
          stagedChanges: NOTES_PATCH,
          guards: { protectedReconciled: true, splitParent: false, transfer: "no" },
        }),
      ],
      [],
      [txn({ id: "t1", reconciled: true })]
    );

    expect(result.operations).toHaveLength(0);
    expect(result.blocked[0]).toMatchObject({ itemId: "i1" });
    expect(result.blocked[0].reason).toMatch(/reconciled/i);
  });
});

describe("create operations", () => {
  it("takes the amount and date from the statement", () => {
    const result = plan(
      [item({ id: "i1", disposition: "create", statementRowIds: ["s1"] })],
      [row({ id: "s1" })]
    );

    const operation = result.operations[0];
    expect(operation.kind).toBe("create");
    if (operation.kind === "create") {
      expect(operation.amount).toBe(-6850);
      expect(operation.date).toBe("2026-07-12");
      expect(operation.payeeName).toBe("DUBAI TAXI CORPORATION");
    }
  });

  it("puts the description in the notes when asked", () => {
    const result = plan(
      [item({ id: "i1", disposition: "create", statementRowIds: ["s1"] })],
      [row({ id: "s1" })],
      [],
      { descriptionTarget: "notes", clearedTarget: "none" }
    );

    const operation = result.operations[0];
    if (operation.kind === "create") {
      expect(operation.notes).toBe("DUBAI TAXI CORPORATION");
      expect(operation.payeeName).toBeNull();
    }
  });

  it("never lets the description overwrite a note the user wrote", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "create",
          statementRowIds: ["s1"],
          stagedChanges: { notes: { original: null, staged: "Paid for Dad", source: "manual" } },
        }),
      ],
      [row({ id: "s1" })],
      [],
      { descriptionTarget: "notes", clearedTarget: "none" }
    );

    const operation = result.operations[0];
    if (operation.kind === "create") expect(operation.notes).toBe("Paid for Dad");
  });

  it("prefers a staged payee over the bank's text", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "create",
          statementRowIds: ["s1"],
          stagedChanges: { payeeId: { original: null, staged: "p9", source: "manual" } },
        }),
      ],
      [row({ id: "s1" })]
    );

    const operation = result.operations[0];
    if (operation.kind === "create") {
      expect(operation.payeeId).toBe("p9");
      expect(operation.payeeName).toBeNull();
    }
  });

  it("honours a staged date over the posted date", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "create",
          statementRowIds: ["s1"],
          stagedChanges: { date: { original: "2026-07-12", staged: "2026-07-11", source: "manual" } },
        }),
      ],
      [row({ id: "s1" })]
    );

    const operation = result.operations[0];
    if (operation.kind === "create") expect(operation.date).toBe("2026-07-11");
  });
});

describe("delete operations", () => {
  it("plans a delete the user explicitly chose", () => {
    const result = plan(
      [item({ id: "i1", disposition: "delete", actualTransactionIds: ["t1"] })],
      [],
      [txn({ id: "t1" })]
    );

    expect(result.operations[0].kind).toBe("delete");
  });

  it("refuses to delete a transfer leg", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "delete",
          actualTransactionIds: ["t1"],
          guards: { protectedReconciled: false, splitParent: false, transfer: "yes" },
        }),
      ],
      [],
      [txn({ id: "t1", transferId: "x1" })]
    );

    expect(result.operations).toHaveLength(0);
    expect(result.blocked[0].reason).toMatch(/transfer/i);
  });

  it("refuses to delete when transfer status is unknown", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "delete",
          actualTransactionIds: ["t1"],
          guards: { protectedReconciled: false, splitParent: false, transfer: "unknown" },
        }),
      ],
      [],
      [txn({ id: "t1" })]
    );

    expect(result.operations).toHaveLength(0);
  });
});

describe("correcting a wrong amount", () => {
  // The transaction is the right one; only its amount is wrong, because the
  // automation that created it extracted or converted badly. Fixing it must
  // never destroy the row, or the notes the user added to it go with it.
  const AMOUNT_PATCH: StagedPatch = {
    amount: { original: -2438, staged: -6615, source: "manual" },
  };

  it("updates in place rather than deleting and recreating", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "correct-amount",
          actualTransactionIds: ["t1"],
          stagedChanges: AMOUNT_PATCH,
        }),
      ],
      [],
      [txn({ id: "t1", amount: -2438 })]
    );

    expect(result.operations).toHaveLength(1);
    const operation = result.operations[0];
    expect(operation.kind).toBe("update");
    if (operation.kind === "update") {
      expect(operation.transactionId).toBe("t1");
      expect(operation.patch.amount?.staged).toBe(-6615);
    }
    // Nothing is deleted, so notes, payee, category and links all survive.
    expect(result.operations.some((entry) => entry.kind === "delete")).toBe(false);
  });

  it("emits nothing when no new amount has been chosen yet", () => {
    const result = plan(
      [item({ id: "i1", disposition: "correct-amount", actualTransactionIds: ["t1"] })],
      [],
      [txn({ id: "t1" })]
    );
    expect(result.operations).toHaveLength(0);
  });

  it("refuses on a split parent, whose amount must equal its split lines", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "correct-amount",
          actualTransactionIds: ["t1"],
          stagedChanges: AMOUNT_PATCH,
          guards: { protectedReconciled: false, splitParent: true, transfer: "no" },
        }),
      ],
      [],
      [txn({ id: "t1", isParent: true })]
    );

    expect(result.operations).toHaveLength(0);
    expect(result.blocked[0].reason).toMatch(/split/i);
  });

  it("refuses on a transfer leg, which would desync the other account", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "correct-amount",
          actualTransactionIds: ["t1"],
          stagedChanges: AMOUNT_PATCH,
          guards: { protectedReconciled: false, splitParent: false, transfer: "yes" },
        }),
      ],
      [],
      [txn({ id: "t1", transferId: "x1" })]
    );

    expect(result.operations).toHaveLength(0);
    expect(result.blocked[0].reason).toMatch(/transfer/i);
  });

  it("refuses on a reconciled transaction", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "correct-amount",
          actualTransactionIds: ["t1"],
          stagedChanges: AMOUNT_PATCH,
          guards: { protectedReconciled: true, splitParent: false, transfer: "no" },
        }),
      ],
      [],
      [txn({ id: "t1", reconciled: true })]
    );

    expect(result.operations).toHaveLength(0);
  });
});

describe("marking transactions cleared", () => {
  // Confirming that a transaction appeared on the statement is what a
  // reconciliation is for, so it is offered — but only where it would change
  // something, or the count the user approves would be inflated by writes that
  // do nothing.
  const cleared = (target: ApplyConfig["clearedTarget"]): ApplyConfig => ({
    descriptionTarget: "payee",
    clearedTarget: target,
  });

  it("leaves the cleared flag alone by default", () => {
    const result = plan(
      [item({ id: "i1", disposition: "matched", actualTransactionIds: ["t1"] })],
      [],
      [txn({ id: "t1", cleared: false })]
    );
    expect(result.operations).toHaveLength(0);
    expect(result.noWriteMatches).toBe(1);
  });

  it("marks a created transaction cleared when asked", () => {
    const result = plan(
      [item({ id: "i1", disposition: "create", statementRowIds: ["s1"] })],
      [row({ id: "s1" })],
      [],
      cleared("created")
    );
    const operation = result.operations[0];
    if (operation.kind === "create") expect(operation.cleared).toBe(true);
  });

  it("does not touch matched transactions when only creates are cleared", () => {
    const result = plan(
      [item({ id: "i1", disposition: "matched", actualTransactionIds: ["t1"] })],
      [],
      [txn({ id: "t1", cleared: false })],
      cleared("created")
    );
    expect(result.operations).toHaveLength(0);
  });

  it("clears a matched transaction that is not yet cleared", () => {
    const result = plan(
      [item({ id: "i1", disposition: "matched", actualTransactionIds: ["t1"] })],
      [],
      [txn({ id: "t1", cleared: false })],
      cleared("reconciled")
    );

    expect(result.operations).toHaveLength(1);
    const operation = result.operations[0];
    expect(operation.kind).toBe("update");
    if (operation.kind === "update") expect(operation.cleared).toBe(true);
  });

  it("writes nothing for a transaction already cleared", () => {
    const result = plan(
      [item({ id: "i1", disposition: "matched", actualTransactionIds: ["t1"] })],
      [],
      [txn({ id: "t1", cleared: true })],
      cleared("reconciled")
    );
    expect(result.operations).toHaveLength(0);
    expect(result.noWriteMatches).toBe(1);
  });

  it("leaves a reconciled transaction alone, which is already settled", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "matched",
          actualTransactionIds: ["t1"],
          guards: { protectedReconciled: true, splitParent: false, transfer: "no" },
        }),
      ],
      [],
      [txn({ id: "t1", cleared: false, reconciled: true })],
      cleared("reconciled")
    );
    expect(result.operations).toHaveLength(0);
  });

  it("adds the cleared flag to an update that was happening anyway", () => {
    const result = plan(
      [
        item({
          id: "i1",
          disposition: "matched",
          actualTransactionIds: ["t1"],
          stagedChanges: NOTES_PATCH,
        }),
      ],
      [],
      [txn({ id: "t1", cleared: false })],
      cleared("reconciled")
    );

    expect(result.operations).toHaveLength(1);
    const operation = result.operations[0];
    if (operation.kind === "update") {
      expect(operation.cleared).toBe(true);
      expect(operation.patch.notes?.staged).toBe("#2026-07 DUBAI TAXI");
    }
  });
});

describe("the create marker (RD-071 D14)", () => {
  const base = {
    budgetSyncId: "budget-1",
    accountId: "acct-1",
    sessionId: "sess-1",
    fingerprint: "abc123",
  };

  it("is stable for the same row in the same session", () => {
    expect(createMarker(base)).toBe(createMarker(base));
  });

  it("differs per statement row", () => {
    expect(createMarker(base)).not.toBe(createMarker({ ...base, fingerprint: "def456" }));
  });

  it("differs per session, account and budget", () => {
    expect(createMarker(base)).not.toBe(createMarker({ ...base, sessionId: "sess-2" }));
    expect(createMarker(base)).not.toBe(createMarker({ ...base, accountId: "acct-2" }));
    expect(createMarker(base)).not.toBe(createMarker({ ...base, budgetSyncId: "budget-2" }));
  });

  it("is carried on the create operation, so a retry can recognise its own work", () => {
    const result = plan(
      [item({ id: "i1", disposition: "create", statementRowIds: ["s1"] })],
      [row({ id: "s1" })]
    );
    const operation = result.operations[0];
    if (operation.kind === "create") {
      expect(operation.marker).toBe(
        createMarker({ ...base, fingerprint: "fp-s1" })
      );
    }
  });
});

describe("the plan as a whole", () => {
  it("counts each kind and totals the writes", () => {
    const result = plan(
      [
        item({ id: "i1", disposition: "create", statementRowIds: ["s1"] }),
        item({
          id: "i2",
          disposition: "matched",
          actualTransactionIds: ["t1"],
          stagedChanges: NOTES_PATCH,
        }),
        item({ id: "i3", disposition: "delete", actualTransactionIds: ["t2"] }),
        item({ id: "i4", disposition: "matched", actualTransactionIds: ["t3"] }),
        item({ id: "i5", disposition: "unresolved" }),
      ],
      [row({ id: "s1" })],
      [txn({ id: "t1" }), txn({ id: "t2" }), txn({ id: "t3" })]
    );

    expect(planCounts(result)).toEqual({ create: 1, update: 1, delete: 1 });
    expect(totalChanges(result)).toBe(3);
    expect(result.noWriteMatches).toBe(1);
    expect(result.unresolved).toBe(1);
  });

  it("gives each operation a stable id across replans", () => {
    const items = [item({ id: "i1", disposition: "create", statementRowIds: ["s1"] })];
    const rows = [row({ id: "s1" })];
    expect(plan(items, rows).operations[0].id).toBe(plan(items, rows).operations[0].id);
  });
});

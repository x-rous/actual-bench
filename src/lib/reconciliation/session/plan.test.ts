import { classifyPlan, planCounts, totalChanges } from "../apply/operations";
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
    importedPayee: "DUBAI TAXI CORPORATION",
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
  applyConfig?: ApplyConfig,
  appliedOperationIds?: Set<string>
) {
  return buildApplyPlan({
    applyConfig,
    appliedOperationIds,
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

  it("puts the bank's merchant text in the notes when asked", () => {
    const result = plan(
      [item({ id: "i1", disposition: "create", statementRowIds: ["s1"] })],
      [row({ id: "s1" })],
      [],
      {
        payeeStrategy: "leave-unset",
        notesStrategy: "imported-payee",
        clearedTarget: "none",
        enrichImportedPayee: true,
      }
    );

    const operation = result.operations[0];
    if (operation.kind === "create") {
      expect(operation.notes).toBe("DUBAI TAXI CORPORATION");
      expect(operation.payeeName).toBeNull();
    }
  });

  it("never lets the bank's text overwrite a note the user wrote", () => {
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
      {
        payeeStrategy: "leave-unset",
        notesStrategy: "imported-payee",
        clearedTarget: "none",
        enrichImportedPayee: true,
      }
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

describe("imported payee, payee and notes are three fields (RD-072)", () => {
  const withMemo = (id: string) =>
    row({ id, importedPayee: "AMZN Mktp AE*23981", bankNotes: "ONLINE CARD PURCHASE" });

  const createItem = (overrides: Partial<ReconciliationItem> = {}) =>
    item({ id: "i1", disposition: "create", statementRowIds: ["s1"], ...overrides });

  it("writes the bank's text as the imported payee whatever the payee strategy", () => {
    for (const payeeStrategy of ["imported-payee", "leave-unset"] as const) {
      const result = plan([createItem()], [withMemo("s1")], [], {
        payeeStrategy,
        notesStrategy: "bank-notes",
        clearedTarget: "none",
        enrichImportedPayee: true,
      });

      const operation = result.operations[0];
      if (operation.kind !== "create") throw new Error("expected a create");
      expect(operation.importedPayee).toBe("AMZN Mktp AE*23981");
    }
  });

  it("keeps the bank's text as provenance even when the user chose the payee", () => {
    const result = plan(
      [
        createItem({
          stagedChanges: { payeeId: { original: null, staged: "payee-amazon", source: "manual" } },
        }),
      ],
      [withMemo("s1")]
    );

    const operation = result.operations[0];
    if (operation.kind !== "create") throw new Error("expected a create");
    // The three fields, each answering its own question.
    expect(operation.importedPayee).toBe("AMZN Mktp AE*23981");
    expect(operation.payeeId).toBe("payee-amazon");
    expect(operation.payeeName).toBeNull();
    expect(operation.notes).toBe("ONLINE CARD PURCHASE");
  });

  it("puts the bank's memo in the notes, not its merchant text", () => {
    const result = plan([createItem()], [withMemo("s1")]);

    const operation = result.operations[0];
    if (operation.kind !== "create") throw new Error("expected a create");
    expect(operation.payeeName).toBe("AMZN Mktp AE*23981");
    expect(operation.notes).toBe("ONLINE CARD PURCHASE");
  });

  it("leaves the notes empty when the statement has no memo", () => {
    const result = plan([createItem()], [row({ id: "s1" })]);

    const operation = result.operations[0];
    if (operation.kind !== "create") throw new Error("expected a create");
    expect(operation.notes).toBeNull();
    expect(operation.importedPayee).toBe("DUBAI TAXI CORPORATION");
  });

  it("still prefers a real memo when the notes fall back to the merchant text", () => {
    const result = plan([createItem()], [withMemo("s1")], [], {
      payeeStrategy: "imported-payee",
      notesStrategy: "imported-payee",
      clearedTarget: "none",
      enrichImportedPayee: true,
    });

    const operation = result.operations[0];
    if (operation.kind !== "create") throw new Error("expected a create");
    expect(operation.notes).toBe("ONLINE CARD PURCHASE");
  });

  it("writes nothing into the notes when asked to leave them alone", () => {
    const result = plan([createItem()], [withMemo("s1")], [], {
      payeeStrategy: "imported-payee",
      notesStrategy: "leave-unset",
      clearedTarget: "none",
      enrichImportedPayee: true,
    });

    const operation = result.operations[0];
    if (operation.kind !== "create") throw new Error("expected a create");
    expect(operation.notes).toBeNull();
  });

  it("writes only notes when the statement's one text column is a memo", () => {
    // The mapping said this file has no merchant column, so there is no bank
    // provenance to record and no payee to resolve — but the memo is still a
    // note (RD-072 §2.1).
    const result = plan(
      [createItem()],
      [row({ id: "s1", importedPayee: "", bankNotes: "Transfer to savings" })]
    );

    const operation = result.operations[0];
    if (operation.kind !== "create") throw new Error("expected a create");
    expect(operation.importedPayee).toBeNull();
    expect(operation.payeeName).toBeNull();
    expect(operation.notes).toBe("Transfer to savings");
  });

  it("carries no imported payee when the statement supplied no text at all", () => {
    const result = plan([createItem()], [row({ id: "s1", importedPayee: "  " })]);

    const operation = result.operations[0];
    if (operation.kind !== "create") throw new Error("expected a create");
    expect(operation.importedPayee).toBeNull();
  });
});

describe("provenance on matched transactions (RD-072 §2.4)", () => {
  const matched = (overrides: Partial<ReconciliationItem> = {}) =>
    item({
      id: "i1",
      disposition: "matched",
      statementRowIds: ["s1"],
      actualTransactionIds: ["t1"],
      ...overrides,
    });

  it("attaches the bank's text without touching the curated payee, notes or category", () => {
    const result = plan(
      [matched()],
      [row({ id: "s1", importedPayee: "AMZN Mktp AE*23981" })],
      [txn({ id: "t1", payeeName: "Amazon", notes: "School supplies" })]
    );

    expect(result.operations).toHaveLength(1);
    const operation = result.operations[0];
    if (operation.kind !== "update") throw new Error("expected an update");
    expect(operation.importedPayee).toBe("AMZN Mktp AE*23981");
    // Nothing of the user's is in the patch, so nothing of the user's is written.
    expect(operation.patch).toEqual({});
    expect(operation.cleared).toBeUndefined();
  });

  it("has nothing to attach when the statement has no merchant column", () => {
    const result = plan(
      [matched()],
      [row({ id: "s1", importedPayee: "", bankNotes: "Transfer to savings" })],
      [txn({ id: "t1" })]
    );

    expect(result.operations).toHaveLength(0);
    expect(result.noWriteMatches).toBe(1);
  });

  it("writes nothing when Actual already holds that text", () => {
    const result = plan(
      [matched()],
      [row({ id: "s1", importedPayee: "AMZN Mktp AE*23981" })],
      [txn({ id: "t1", importedPayee: "AMZN Mktp AE*23981" })]
    );

    expect(result.operations).toHaveLength(0);
    expect(result.noWriteMatches).toBe(1);
  });

  it("leaves a row reconciled in Actual alone", () => {
    const result = plan(
      [matched({ guards: { protectedReconciled: true, splitParent: false, transfer: "no" } })],
      [row({ id: "s1", importedPayee: "AMZN Mktp AE*23981" })],
      [txn({ id: "t1", reconciled: true })]
    );

    expect(result.operations).toHaveLength(0);
  });

  it("does nothing when the setting is off", () => {
    const result = plan(
      [matched()],
      [row({ id: "s1", importedPayee: "AMZN Mktp AE*23981" })],
      [txn({ id: "t1" })],
      {
        payeeStrategy: "imported-payee",
        notesStrategy: "bank-notes",
        clearedTarget: "none",
        enrichImportedPayee: false,
      }
    );

    expect(result.operations).toHaveLength(0);
    expect(result.noWriteMatches).toBe(1);
  });

  it("rides along with a staged change rather than becoming a second write", () => {
    const result = plan(
      [matched({ stagedChanges: NOTES_PATCH })],
      [row({ id: "s1", importedPayee: "AMZN Mktp AE*23981" })],
      [txn({ id: "t1" })]
    );

    expect(result.operations).toHaveLength(1);
    const operation = result.operations[0];
    if (operation.kind !== "update") throw new Error("expected an update");
    expect(operation.importedPayee).toBe("AMZN Mktp AE*23981");
    expect(operation.patch.notes?.staged).toBe("#2026-07 DUBAI TAXI");
  });

  it("is counted apart from the changes the user staged", () => {
    const result = plan(
      [
        matched(),
        item({
          id: "i2",
          disposition: "matched",
          statementRowIds: ["s2"],
          actualTransactionIds: ["t2"],
          stagedChanges: NOTES_PATCH,
        }),
      ],
      [
        row({ id: "s1", importedPayee: "AMZN Mktp AE*23981" }),
        row({ id: "s2", importedPayee: "DUBAI TAXI CORPORATION" }),
      ],
      [txn({ id: "t1" }), txn({ id: "t2" })]
    );

    // Two writes, but only one of them is a change the user made.
    expect(result.operations).toHaveLength(2);
    expect(classifyPlan(result)).toEqual({ userChanges: 1, enrichments: 1 });
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
    payeeStrategy: "imported-payee",
    notesStrategy: "bank-notes",
    clearedTarget: target,
    // Isolated from provenance enrichment, which would otherwise turn every
    // no-write match in these fixtures into a write of its own.
    enrichImportedPayee: false,
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

  it("does not re-plan work an earlier run already wrote", () => {
    // A reconciliation does not become un-applied because its decisions are
    // still on screen. Without this, reopening an applied session offers to
    // apply the whole thing over again.
    const items = [
      item({ id: "i1", disposition: "create", statementRowIds: ["s1"] }),
      item({
        id: "i2",
        disposition: "matched",
        actualTransactionIds: ["t1"],
        stagedChanges: NOTES_PATCH,
      }),
    ];
    const rows = [row({ id: "s1" })];
    const transactions = [txn({ id: "t1" })];

    const first = plan(items, rows, transactions);
    expect(totalChanges(first)).toBe(2);

    const applied = new Set(first.operations.map((operation) => operation.id));
    const second = plan(items, rows, transactions, undefined, applied);

    expect(totalChanges(second)).toBe(0);
    expect(second.alreadyApplied).toBe(2);
  });

  it("leaves an operation that failed still to do", () => {
    // A partial apply must go on offering exactly what did not succeed.
    const items = [
      item({ id: "i1", disposition: "create", statementRowIds: ["s1"] }),
      item({
        id: "i2",
        disposition: "matched",
        actualTransactionIds: ["t1"],
        stagedChanges: NOTES_PATCH,
      }),
    ];
    const rows = [row({ id: "s1" })];
    const transactions = [txn({ id: "t1" })];

    const first = plan(items, rows, transactions);
    const onlyOne = new Set([first.operations[0].id]);
    const second = plan(items, rows, transactions, undefined, onlyOne);

    expect(totalChanges(second)).toBe(1);
    expect(second.alreadyApplied).toBe(1);
    expect(second.operations[0].id).toBe(first.operations[1].id);
  });

  it("gives each operation a stable id across replans", () => {
    const items = [item({ id: "i1", disposition: "create", statementRowIds: ["s1"] })];
    const rows = [row({ id: "s1" })];
    expect(plan(items, rows).operations[0].id).toBe(plan(items, rows).operations[0].id);
  });
});

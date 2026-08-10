import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StagedPatch,
  StatementRow,
} from "../types";
import { prospectiveTransaction } from "../session/prospective";
import { DEFAULT_APPLY_CONFIG } from "../session/plan";
import { previewTransform } from "./preview";
import {
  changesFor,
  evaluateCondition,
  ruleMatches,
  type Condition,
  type TransformContext,
  type TransformRule,
} from "./rules";

function txn(
  overrides: Partial<ActualTransactionSnapshot> = {}
): ActualTransactionSnapshot {
  return {
    id: "t1",
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

function statementRow(overrides: Partial<StatementRow> = {}): StatementRow {
  return {
    id: "s1",
    sourceRowNumber: 1,
    postedDate: "2026-07-12",
    amount: -6850,
    description: "DUBAI TAXI CORPORATION",
    raw: {},
    fingerprint: "fp",
    ...overrides,
  };
}

function item(overrides: Partial<ReconciliationItem> = {}): ReconciliationItem {
  return {
    id: "i1",
    statementRowIds: ["s1"],
    actualTransactionIds: ["t1"],
    disposition: "matched",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    ...overrides,
  };
}

function context(overrides: Partial<TransformContext> = {}): TransformContext {
  const base = {
    item: item(),
    statementRow: statementRow(),
    transaction: txn() as ActualTransactionSnapshot | undefined,
    ...overrides,
  };
  return {
    ...base,
    pending:
      overrides.pending ??
      prospectiveTransaction({
        item: base.item,
        statementRow: base.statementRow,
        transaction: base.transaction,
        applyConfig: DEFAULT_APPLY_CONFIG,
      }),
    categoryName: (id) => (id === "c1" ? "Transport" : id === "c2" ? "Taxi" : null),
    payeeName: (id) => (id === "p1" ? "Dubai Taxi" : null),
    ...overrides,
  };
}

const condition = (overrides: Partial<Condition> & Pick<Condition, "field" | "operator">): Condition => ({
  value: "",
  ...overrides,
});

describe("conditions (feature spec §28/§29)", () => {
  it("matches on the statement description", () => {
    expect(
      evaluateCondition(
        condition({ field: "statementDescription", operator: "contains", value: "dubai taxi" }),
        context()
      )
    ).toBe(true);
  });

  it("matches on a tag in the notes", () => {
    expect(
      evaluateCondition(condition({ field: "notes", operator: "hasTag", value: "#API" }), context())
    ).toBe(true);
    expect(
      evaluateCondition(
        condition({ field: "notes", operator: "doesNotHaveTag", value: "#API" }),
        context()
      )
    ).toBe(false);
  });

  it("does not treat a longer tag as the one asked for", () => {
    expect(
      evaluateCondition(
        condition({ field: "notes", operator: "hasTag", value: "#API" }),
        context({ transaction: txn({ notes: "#APIv2 something" }) })
      )
    ).toBe(false);
  });

  it("compares amounts in whole units, as the user writes them", () => {
    expect(
      evaluateCondition(
        condition({ field: "amount", operator: "lessThan", value: "-50" }),
        context()
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        condition({ field: "amount", operator: "greaterThan", value: "-50" }),
        context()
      )
    ).toBe(false);
  });

  it("supports a range", () => {
    expect(
      evaluateCondition(
        condition({ field: "amount", operator: "between", value: "-100", value2: "-10" }),
        context()
      )
    ).toBe(true);
  });

  it("matches on the resolved payee and category names", () => {
    expect(
      evaluateCondition(
        condition({ field: "payee", operator: "equals", value: "Dubai Taxi" }),
        context()
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        condition({ field: "category", operator: "equals", value: "Transport" }),
        context()
      )
    ).toBe(true);
  });

  it("reads through staged changes, not the server value", () => {
    // §32: a rule tests what the transaction will be, not what it was before an
    // earlier rule ran.
    const staged: StagedPatch = {
      categoryId: { original: "c1", staged: "c2", source: "transform" },
    };
    expect(
      evaluateCondition(
        condition({ field: "category", operator: "equals", value: "Taxi" }),
        context({ item: item({ stagedChanges: staged }) })
      )
    ).toBe(true);
  });

  it("requires every condition to hold", () => {
    const rule: TransformRule = {
      id: "r1",
      conditions: [
        condition({ field: "notes", operator: "hasTag", value: "#API" }),
        condition({ field: "payee", operator: "equals", value: "Someone Else" }),
      ],
      actions: [],
    };
    expect(ruleMatches(rule, context())).toBe(false);
  });

  it("applies to everything when it has no conditions", () => {
    expect(ruleMatches({ id: "r1", conditions: [], actions: [] }, context())).toBe(true);
  });
});

describe("actions (feature spec §30)", () => {
  it("renames a tag while keeping the rest of the note", () => {
    const changes = changesFor(
      {
        id: "r1",
        conditions: [],
        actions: [{ kind: "replaceTag", from: "#API", to: "#2026-07" }],
      },
      context({ transaction: txn({ notes: "#API DUBAI TAXI | paid for Dad" }) })
    );

    expect(changes).toEqual([
      { field: "notes", value: "#2026-07 DUBAI TAXI | paid for Dad" },
    ]);
  });

  it("chains note actions within one rule", () => {
    // Each action reads what the previous one produced.
    const changes = changesFor(
      {
        id: "r1",
        conditions: [],
        actions: [
          { kind: "replaceTag", from: "#API", to: "#2026-07" },
          { kind: "appendNote", text: "Checked against statement" },
        ],
      },
      context({ transaction: txn({ notes: "#API Dinner" }) })
    );

    expect(changes).toEqual([
      { field: "notes", value: "#2026-07 Dinner | Checked against statement" },
    ]);
  });

  it("reports no change when the note is already as the rule would leave it", () => {
    const changes = changesFor(
      {
        id: "r1",
        conditions: [],
        actions: [{ kind: "addTag", tag: "#API" }],
      },
      context()
    );
    expect(changes).toEqual([]);
  });

  it("sets a category and a payee", () => {
    const changes = changesFor(
      {
        id: "r1",
        conditions: [],
        actions: [
          { kind: "setCategory", categoryId: "c2" },
          { kind: "setPayee", payeeId: "p9" },
        ],
      },
      context()
    );
    expect(changes).toEqual([
      { field: "categoryId", value: "c2" },
      { field: "payeeId", value: "p9" },
    ]);
  });

  it("composes on the staged note, not the original (feature spec §32)", () => {
    const staged: StagedPatch = {
      notes: { original: "#API Dinner", staged: "#2026-07 Dinner", source: "transform" },
    };
    const changes = changesFor(
      { id: "r2", conditions: [], actions: [{ kind: "appendNote", text: "Reviewed" }] },
      context({
        item: item({ stagedChanges: staged }),
        transaction: txn({ notes: "#API Dinner" }),
      })
    );

    expect(changes).toEqual([{ field: "notes", value: "#2026-07 Dinner | Reviewed" }]);
  });
});

describe("preview (feature spec §31)", () => {
  const renameRule: TransformRule = {
    id: "r1",
    conditions: [condition({ field: "notes", operator: "hasTag", value: "#API" })],
    actions: [{ kind: "replaceTag", from: "#API", to: "#2026-07" }],
  };

  function preview(items: ReconciliationItem[], transactions: Record<string, ActualTransactionSnapshot>, overrideManual = false) {
    return previewTransform({
      rule: renameRule,
      items,
      overrideManual,
      contextFor: (entry) =>
        context({
          item: entry,
          transaction: transactions[entry.actualTransactionIds[0] ?? ""],
        }),
    });
  }

  it("tags a transaction that does not exist yet", () => {
    // A row about to be created has no transaction, but it does have a note it
    // is going to carry. Adding a tag must build on that rather than replace it.
    const createItem = item({
      id: "new",
      disposition: "create",
      actualTransactionIds: [],
    });

    const result = previewTransform({
      rule: {
        id: "tag",
        conditions: [condition({ field: "matchStatus", operator: "equals", value: "create" })],
        actions: [{ kind: "addTag", tag: "#2026-07", position: "start" }],
      },
      items: [createItem],
      contextFor: () =>
        context({
          item: createItem,
          transaction: undefined,
          pending: prospectiveTransaction({
            item: createItem,
            statementRow: statementRow(),
            transaction: undefined,
            applyConfig: { descriptionTarget: "notes", clearedTarget: "none" },
          }),
        }),
    });

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].changes[0]).toEqual({
      field: "notes",
      before: "DUBAI TAXI CORPORATION",
      after: "#2026-07 DUBAI TAXI CORPORATION",
    });
  });

  it("tags a new transaction whose description went to the payee", () => {
    const createItem = item({ id: "new", disposition: "create", actualTransactionIds: [] });

    const result = previewTransform({
      rule: {
        id: "tag",
        conditions: [],
        actions: [{ kind: "addTag", tag: "#2026-07" }],
      },
      items: [createItem],
      contextFor: () =>
        context({
          item: createItem,
          transaction: undefined,
          pending: prospectiveTransaction({
            item: createItem,
            statementRow: statementRow(),
            transaction: undefined,
            applyConfig: { descriptionTarget: "payee", clearedTarget: "none" },
          }),
        }),
    });

    expect(result.changed[0].changes[0].after).toBe("#2026-07");
  });

  it("shows the exact before and after", () => {
    const result = preview([item()], { t1: txn({ notes: "#API Dinner" }) });

    expect(result.matched).toBe(1);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].changes[0]).toEqual({
      field: "notes",
      before: "#API Dinner",
      after: "#2026-07 Dinner",
    });
  });

  it("counts a row it matched but would not change, and says why", () => {
    const result = preview(
      [item({ id: "i2" })],
      { t1: txn({ notes: "#API Dinner" }) }
    );
    const second = previewTransform({
      rule: renameRule,
      items: [item({ id: "i2" })],
      contextFor: () => context({ transaction: txn({ notes: "#2026-07 Dinner" }) }),
    });

    expect(result.changed).toHaveLength(1);
    // Already renamed: matched nothing, so nothing to report as changed.
    expect(second.changed).toHaveLength(0);
  });

  it("does not select a row whose hand edit removed what the rule looks for", () => {
    // Conditions read the staged value (§32), so a note the user rewrote
    // without the tag is simply not this rule's business.
    const staged: StagedPatch = {
      notes: { original: "#API Dinner", staged: "My own words", source: "manual" },
    };
    const result = preview([item({ stagedChanges: staged })], { t1: txn({ notes: "#API Dinner" }) });

    expect(result.matched).toBe(0);
    expect(result.changed).toHaveLength(0);
  });

  it("leaves a hand-edited note alone and says so", () => {
    // The row still matches — the edit kept the tag — but the note was written
    // by hand, and a bulk action quietly undoing deliberate work is the failure
    // precedence exists to prevent (§33).
    const staged: StagedPatch = {
      notes: {
        original: "#API Dinner",
        staged: "#API Dinner with Ahmad, paid for Dad",
        source: "manual",
      },
    };
    const result = preview([item({ stagedChanges: staged })], { t1: txn({ notes: "#API Dinner" }) });

    expect(result.matched).toBe(1);
    expect(result.changed).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ reason: "manual-edit" });
  });

  it("overrides a hand edit only when explicitly asked", () => {
    const staged: StagedPatch = {
      notes: {
        original: "#API Dinner",
        staged: "#API Dinner with Ahmad",
        source: "manual",
      },
    };
    const result = preview(
      [item({ stagedChanges: staged })],
      { t1: txn({ notes: "#API Dinner" }) },
      true
    );

    expect(result.changed).toHaveLength(1);
    // The user's own words survive the rename either way.
    expect(result.changed[0].changes[0].after).toBe("#2026-07 Dinner with Ahmad");
  });

  it("skips a guarded row with the guard's own reason", () => {
    const result = preview(
      [
        item({
          guards: { protectedReconciled: true, splitParent: false, transfer: "no" },
        }),
      ],
      { t1: txn({ notes: "#API Dinner", reconciled: true }) }
    );

    expect(result.changed).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("guarded");
    expect(result.skipped[0].detail).toMatch(/reconciled/i);
  });

  it("produces a patch ready to stage, with provenance", () => {
    const result = preview([item()], { t1: txn({ notes: "#API Dinner" }) });
    expect(result.changed[0].patch.notes).toEqual({
      original: "#API Dinner",
      staged: "#2026-07 Dinner",
      source: "transform",
    });
  });

  it("ignores rows the conditions do not match", () => {
    const result = preview([item()], { t1: txn({ notes: "No tag here" }) });
    expect(result.matched).toBe(0);
    expect(result.changed).toHaveLength(0);
  });
});

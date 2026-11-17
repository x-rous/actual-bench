import type { ActualTransactionSnapshot, ReconciliationItem, StatementRow } from "../types";
import { prospectiveTransaction } from "../session/prospective";
import { DEFAULT_APPLY_CONFIG } from "../session/plan";
import { previewTransformSequence } from "./preview";
import type { TransformContext, TransformRule } from "./rules";
import {
  defaultMonth,
  missingPayees,
  resolvePlaceholders,
  sanitizeSavedRule,
  usesMonth,
  withoutMissingPayees,
  type SavedRule,
} from "./saved";

const apiToMonth: SavedRule = {
  conditions: [{ field: "notes", operator: "hasTag", value: "#API" }],
  actions: [{ kind: "replaceTag", from: "#API", to: "#{month}" }],
};
const tagNewRows: SavedRule = {
  conditions: [{ field: "matchStatus", operator: "equals", value: "create" }],
  actions: [{ kind: "addTag", tag: "#{month}", position: "start" }],
};
const fullPayee: SavedRule = { conditions: [], actions: [{ kind: "useStatementImportedPayee" }] };

describe("the {month} placeholder", () => {
  it("is detected and filled in on a copy, leaving the saved rule as it was", () => {
    expect(usesMonth(apiToMonth)).toBe(true);
    expect(usesMonth(fullPayee)).toBe(false);
    const resolved = resolvePlaceholders(apiToMonth, "2026-11");
    expect(resolved.actions).toEqual([{ kind: "replaceTag", from: "#API", to: "#2026-11" }]);
    expect(apiToMonth.actions[0]).toEqual({ kind: "replaceTag", from: "#API", to: "#{month}" });
  });

  it("defaults to the statement's closing month, then the latest row, then today", () => {
    expect(defaultMonth({ statementEnd: "2026-11-14", rowDates: ["2026-10-15"] })).toBe("2026-11");
    expect(defaultMonth({ statementEnd: null, rowDates: ["2026-10-15", "2026-11-02", null] })).toBe("2026-11");
    expect(defaultMonth({ rowDates: [], today: "2026-12-01T00:00:00Z" })).toBe("2026-12");
  });
});

describe("stored rules", () => {
  it("round-trips a valid rule and rejects anything it does not recognise", () => {
    expect(sanitizeSavedRule(tagNewRows)).toEqual(tagNewRows);
    expect(sanitizeSavedRule({ conditions: [{ field: "notes", operator: "regex", value: "x" }], actions: fullPayee.actions })).toBeNull();
    expect(sanitizeSavedRule({ conditions: [], actions: [] })).toBeNull();
    expect(sanitizeSavedRule("nope")).toBeNull();
  });

  it("drops only the action whose payee no longer exists", () => {
    const rule: SavedRule = { conditions: [], actions: [{ kind: "setPayee", payeeId: "gone" }, ...fullPayee.actions] };
    expect(missingPayees(rule, new Set(["p1"]))).toEqual(["gone"]);
    expect(withoutMissingPayees(rule, new Set(["p1"])).actions).toEqual(fullPayee.actions);
  });
});

describe("running several saved transforms in order", () => {
  const transaction: ActualTransactionSnapshot = {
    id: "t1", accountId: "a", date: "2026-11-03", amount: -6850, payeeId: "p1", payeeName: "Dubai Taxi",
    importedPayee: null, categoryId: null, categoryName: null, notes: "#API DUBAI TAXI", cleared: true,
    reconciled: false, importedId: null, transferId: null, scheduleId: null, isParent: false, isChild: false,
    parentId: null, splitLines: [],
  };
  const rows: StatementRow[] = [
    { id: "s1", sourceRowNumber: 1, postedDate: "2026-11-03", amount: -6850, importedPayee: "DUBAI TAXI CORPORATION", raw: {}, fingerprint: "f1" },
    { id: "s2", sourceRowNumber: 2, postedDate: "2026-11-04", amount: -1200, importedPayee: "CAREEM FOOD", raw: {}, fingerprint: "f2" },
  ];
  const items: ReconciliationItem[] = [
    { id: "matched", statementRowIds: ["s1"], actualTransactionIds: ["t1"], disposition: "matched",
      guards: { protectedReconciled: false, splitParent: false, transfer: "no" } },
    { id: "new", statementRowIds: ["s2"], actualTransactionIds: [], disposition: "create",
      guards: { protectedReconciled: false, splitParent: false, transfer: "no" } },
  ];
  const contextFor = (item: ReconciliationItem): TransformContext => {
    const statementRow = rows.find((row) => row.id === item.statementRowIds[0]);
    const txn = item.actualTransactionIds.length > 0 ? transaction : undefined;
    return {
      item, statementRow, transaction: txn,
      pending: prospectiveTransaction({ item, statementRow, transaction: txn, applyConfig: DEFAULT_APPLY_CONFIG }),
      payeeName: () => null, categoryName: () => null,
    };
  };
  const rules: TransformRule[] = [apiToMonth, tagNewRows, fullPayee].map((rule, index) => ({
    id: `r${index}`, ...resolvePlaceholders(rule, "2026-11"),
  }));

  it("lets each rule build on what the earlier ones left", () => {
    const preview = previewTransformSequence({ rules, items, contextFor });
    const notes = new Map(preview.changed.map((row) => [row.itemId, row.patch.notes?.staged]));
    expect(notes.get("matched")).toBe("#2026-11 DUBAI TAXI CORPORATION");
    expect(String(notes.get("new"))).toMatch(/^#2026-11/);
    expect(preview.changedByRule[0]).toBe(1);
    // Before is what the row held before the first rule ran.
    expect(preview.changed.find((row) => row.itemId === "matched")?.changes[0].before).toBe("#API DUBAI TAXI");
  });
});

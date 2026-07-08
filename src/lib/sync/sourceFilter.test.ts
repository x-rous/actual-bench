import {
  DEFAULT_SOURCE_FILTER,
  filterSourceItems,
  filterSourceTransactions,
  isGeneratedSourceTransaction,
  type SyncSourceFilter,
} from "./sourceFilter";
import { expandSourceTransactions } from "./sourceItems";
import { generateSyncMarker } from "./marker";
import type { SyncSourceTransaction } from "@/lib/actual/transport";

function txn(overrides: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction {
  return {
    id: "t1",
    accountId: "acct-src",
    date: "2026-07-10",
    amount: -1250,
    payeeId: "sp1",
    payeeName: "Coffee Bar",
    categoryId: "sc1",
    categoryName: "Dining",
    notes: "flat white",
    cleared: true,
    reconciled: false,
    importedId: null,
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
    ...overrides,
  };
}

function filter(overrides: Partial<SyncSourceFilter> = {}): SyncSourceFilter {
  return { ...DEFAULT_SOURCE_FILTER, ...overrides };
}

function itemsOf(txns: SyncSourceTransaction[], f: SyncSourceFilter) {
  const nonGenerated = filterSourceTransactions(txns, f);
  return filterSourceItems(expandSourceTransactions(nonGenerated), f);
}

describe("generated-transaction exclusion", () => {
  it("detects our own imported_id marker and notes marker", () => {
    expect(isGeneratedSourceTransaction(txn({ importedId: generateSyncMarker({ sourceBudgetId: "b1", targetBudgetId: "b2", targetAccountId: "a2", sourceItemKey: "txn:x" }) }))).toBe(true);
    expect(isGeneratedSourceTransaction(txn({ notes: "hi [Synced from Home / Checking]" }))).toBe(true);
    expect(isGeneratedSourceTransaction(txn({ importedId: "bank-123", notes: "groceries" }))).toBe(false);
  });

  it("excludes generated transactions by default and keeps them when disabled", () => {
    const txns = [txn({ id: "a" }), txn({ id: "b", importedId: generateSyncMarker({ sourceBudgetId: "b1", targetBudgetId: "b2", targetAccountId: "a2", sourceItemKey: "txn:b" }) })];
    expect(filterSourceTransactions(txns, filter()).map((t) => t.id)).toEqual(["a"]);
    expect(
      filterSourceTransactions(txns, filter({ excludeGeneratedSyncTransactions: false })).map((t) => t.id)
    ).toEqual(["a", "b"]);
  });
});

describe("item-level filters", () => {
  it("filters by date range", () => {
    const txns = [txn({ id: "a", date: "2026-07-01" }), txn({ id: "b", date: "2026-07-20" })];
    const kept = itemsOf(txns, filter({ startDate: "2026-07-10", endDate: "2026-07-31" }));
    expect(kept.map((i) => i.sourceTransactionId)).toEqual(["b"]);
  });

  it("filters by cleared and reconciled status", () => {
    const txns = [txn({ id: "a", cleared: true }), txn({ id: "b", cleared: false })];
    expect(itemsOf(txns, filter({ cleared: "cleared" })).map((i) => i.sourceTransactionId)).toEqual(["a"]);
    expect(itemsOf(txns, filter({ cleared: "uncleared" })).map((i) => i.sourceTransactionId)).toEqual(["b"]);

    const rec = [txn({ id: "a", reconciled: true }), txn({ id: "b", reconciled: false })];
    expect(itemsOf(rec, filter({ reconciled: "reconciled" })).map((i) => i.sourceTransactionId)).toEqual(["a"]);
  });

  it("filters by amount sign", () => {
    const txns = [txn({ id: "out", amount: -500 }), txn({ id: "in", amount: 700 })];
    expect(itemsOf(txns, filter({ amountSign: "inflow" })).map((i) => i.sourceTransactionId)).toEqual(["in"]);
    expect(itemsOf(txns, filter({ amountSign: "outflow" })).map((i) => i.sourceTransactionId)).toEqual(["out"]);
  });

  it("filters by absolute amount range", () => {
    const txns = [txn({ id: "a", amount: -100 }), txn({ id: "b", amount: -5000 })];
    expect(itemsOf(txns, filter({ minAbsAmount: 1000 })).map((i) => i.sourceTransactionId)).toEqual(["b"]);
  });

  it("filters by payee include/exclude (normalized)", () => {
    const txns = [txn({ id: "a", payeeName: "Coffee Bar" }), txn({ id: "b", payeeName: "Market" })];
    expect(itemsOf(txns, filter({ payeeInclude: ["coffee bar"] })).map((i) => i.sourceTransactionId)).toEqual(["a"]);
    expect(itemsOf(txns, filter({ payeeExclude: ["market"] })).map((i) => i.sourceTransactionId)).toEqual(["a"]);
  });

  it("filters by category include/exclude (normalized)", () => {
    const txns = [txn({ id: "a", categoryName: "Dining" }), txn({ id: "b", categoryName: "Rent" })];
    expect(itemsOf(txns, filter({ categoryInclude: ["dining"] })).map((i) => i.sourceTransactionId)).toEqual(["a"]);
  });

  it("filters by notes contains (case-insensitive)", () => {
    const txns = [txn({ id: "a", notes: "Flat White" }), txn({ id: "b", notes: "espresso" })];
    expect(itemsOf(txns, filter({ notesContains: "flat" })).map((i) => i.sourceTransactionId)).toEqual(["a"]);
  });

  it("applies filters per split line after explosion", () => {
    const parent = txn({
      id: "p",
      isParent: true,
      splitLines: [
        { id: "s1", amount: -1000, payeeId: null, payeeName: null, categoryId: "c-a", categoryName: "Groceries", notes: null },
        { id: "s2", amount: 500, payeeId: null, payeeName: null, categoryId: "c-b", categoryName: "Refund", notes: null },
      ],
    });
    // inflow filter keeps only the positive split line
    const kept = itemsOf([parent], filter({ amountSign: "inflow" }));
    expect(kept).toHaveLength(1);
    expect(kept[0].sourceSplitId).toBe("s2");
  });
});

import type { SyncSourceTransaction } from "@/lib/actual/transport";
import {
  expandSourceTransaction,
  expandSourceTransactions,
  sourceSplitFallbackItemKey,
  sourceSplitItemKey,
  sourceTransactionItemKey,
  splitLineFingerprint,
  splitParentFingerprint,
  transactionFingerprint,
} from "./sourceItems";

function makeTxn(overrides: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction {
  return {
    id: "t1",
    accountId: "acct-src",
    date: "2026-07-01",
    amount: -1250,
    payeeId: "p1",
    payeeName: "Coffee Bar",
    categoryId: "c1",
    categoryName: "Dining",
    notes: "flat white",
    cleared: true,
    reconciled: false,
    importedId: "imp-1",
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
    ...overrides,
  };
}

describe("splitParentFingerprint", () => {
  const parent = makeTxn({
    id: "p", isParent: true, notes: "trip",
    splitLines: [{ id: "s1", amount: -1000, payeeId: null, payeeName: null, categoryId: "c1", categoryName: "A", notes: null }],
  });

  it("changes when the parent's own notes change", () => {
    const a = splitParentFingerprint(parent);
    const b = splitParentFingerprint({ ...parent, notes: "trip (edited)" });
    expect(a).not.toBe(b);
  });

  it("changes when a child line changes", () => {
    const a = splitParentFingerprint(parent);
    const b = splitParentFingerprint({ ...parent, splitLines: [{ ...parent.splitLines[0], amount: -1500 }] });
    expect(a).not.toBe(b);
  });
});

describe("source item keys", () => {
  it("builds stable keys for normal and split items", () => {
    expect(sourceTransactionItemKey("t1")).toBe("txn:t1");
    expect(sourceSplitItemKey("t1", "s9")).toBe("split:t1:s9");
    expect(sourceSplitFallbackItemKey("t1", 2, "abcd1234")).toBe("split:t1:2:abcd1234");
  });
});

describe("expandSourceTransaction", () => {
  it("produces a single transaction item for a normal transaction", () => {
    const items = expandSourceTransaction(makeTxn());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "transaction",
      itemKey: "txn:t1",
      sourceTransactionId: "t1",
      sourceSplitId: null,
      usedFallbackKey: false,
      amount: -1250,
      importedId: "imp-1",
    });
  });

  it("explodes a split parent into one item per child, inheriting parent context", () => {
    const parent = makeTxn({
      id: "p",
      amount: -3000,
      isParent: true,
      categoryId: null,
      categoryName: null,
      splitLines: [
        { id: "s1", amount: -1000, payeeId: null, payeeName: null, categoryId: "cat-a", categoryName: "Groceries", notes: null },
        { id: "s2", amount: -2000, payeeId: "p2", payeeName: "Other", categoryId: "cat-b", categoryName: "Household", notes: "soap" },
      ],
    });

    const items = expandSourceTransaction(parent);
    expect(items).toHaveLength(2);

    expect(items[0]).toMatchObject({
      kind: "split_line",
      itemKey: "split:p:s1",
      sourceSplitId: "s1",
      usedFallbackKey: false,
      amount: -1000,
      categoryId: "cat-a",
      // inherits parent payee when the line has none
      payeeId: "p1",
      payeeName: "Coffee Bar",
      importedId: null,
    });
    expect(items[1]).toMatchObject({
      itemKey: "split:p:s2",
      payeeId: "p2",
      categoryId: "cat-b",
      notes: "soap",
    });
  });

  it("falls back to a positional key when a split child has no stable id", () => {
    const parent = makeTxn({
      id: "p",
      isParent: true,
      splitLines: [
        { id: null, amount: -500, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null },
      ],
    });

    const [item] = expandSourceTransaction(parent);
    expect(item.usedFallbackKey).toBe(true);
    expect(item.sourceSplitId).toBeNull();
    expect(item.itemKey).toBe(sourceSplitFallbackItemKey("p", 0, item.fingerprint));
  });

  it("treats a parent with no split lines as a normal transaction", () => {
    const items = expandSourceTransaction(makeTxn({ isParent: true, splitLines: [] }));
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("transaction");
  });

  it("expands many transactions preserving order", () => {
    const items = expandSourceTransactions([makeTxn({ id: "a" }), makeTxn({ id: "b" })]);
    expect(items.map((i) => i.itemKey)).toEqual(["txn:a", "txn:b"]);
  });
});

describe("fingerprints", () => {
  it("is stable for identical content", () => {
    expect(transactionFingerprint(makeTxn())).toBe(transactionFingerprint(makeTxn()));
  });

  it("changes when a tracked field changes", () => {
    const base = transactionFingerprint(makeTxn());
    expect(transactionFingerprint(makeTxn({ amount: -1251 }))).not.toBe(base);
    expect(transactionFingerprint(makeTxn({ notes: "latte" }))).not.toBe(base);
    expect(transactionFingerprint(makeTxn({ cleared: false }))).not.toBe(base);
    expect(transactionFingerprint(makeTxn({ reconciled: true }))).not.toBe(base);
    expect(transactionFingerprint(makeTxn({ payeeName: "Tea Bar" }))).not.toBe(base);
  });

  it("distinguishes a null field from an empty string", () => {
    expect(transactionFingerprint(makeTxn({ notes: null }))).not.toBe(
      transactionFingerprint(makeTxn({ notes: "" }))
    );
  });

  it("split line fingerprint reflects parent context and line position", () => {
    const parent = makeTxn({ isParent: true });
    const line = { id: "s1", amount: -100, payeeId: null, payeeName: null, categoryId: "c", categoryName: "Cat", notes: null };
    const fp0 = splitLineFingerprint(parent, line, 0);
    expect(splitLineFingerprint(parent, line, 1)).not.toBe(fp0);
    expect(splitLineFingerprint(makeTxn({ isParent: true, date: "2026-07-02" }), line, 0)).not.toBe(fp0);
  });
});

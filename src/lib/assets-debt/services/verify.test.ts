import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { RowSnapshot } from "./snapshot";
import { verifyCreatedRows, verifyLinkOutcome, verifySplitOutcome } from "./verify";

/** T128: each issue kind has a failing fixture. The create path is the shared reconciliation verifier. */

const tx = (overrides: Partial<SyncSourceTransaction>): SyncSourceTransaction => ({
  id: "t", accountId: "loan", date: "2024-02-28", amount: -100, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null,
  cleared: false, reconciled: false, importedId: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...overrides,
});
const row = (overrides: Partial<RowSnapshot>): RowSnapshot => ({
  id: "r", accountId: "chk", date: "2024-02-01", amountMinor: -1000, payeeId: "p", payeeName: "Lender", categoryId: null, notes: null, cleared: true, reconciled: false,
  importedId: "bank:1", importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0, ...overrides,
});
const op = { accountId: "loan", date: "2024-02-28", amountMinor: -100, payeeId: null, transferAccountId: null, categoryId: null, notes: "Interest charge", cleared: false, importedId: "abdebt:m:g1", economicKind: "interest" as const };

describe("post-apply verification (T128)", () => {
  it("passes a single correct create and reports its id", () => {
    expect(verifyCreatedRows({ operations: [op], latest: [tx({ id: "c1", importedId: "abdebt:m:g1" })], offBudgetAccountIds: new Set(["loan"]) })).toEqual({ issues: [], createdIds: ["c1"] });
  });
  it("missing-create", () => {
    expect(verifyCreatedRows({ operations: [op], latest: [], offBudgetAccountIds: new Set() }).issues.map((i) => i.kind)).toEqual(["missing-create"]);
  });
  it("duplicate-create (duplicate marker)", () => {
    const latest = [tx({ id: "a", importedId: "abdebt:m:g1" }), tx({ id: "b", importedId: "abdebt:m:g1" })];
    expect(verifyCreatedRows({ operations: [op], latest, offBudgetAccountIds: new Set() }).issues.map((i) => i.kind)).toContain("duplicate-create");
  });
  it("category-rule: an off-budget row carrying a category", () => {
    expect(verifyCreatedRows({ operations: [op], latest: [tx({ id: "a", importedId: "abdebt:m:g1", categoryId: "cat" })], offBudgetAccountIds: new Set(["loan"]) }).issues.map((i) => i.kind)).toEqual(["category-rule"]);
  });

  const expected = { parentId: "r", parentAmountMinor: -1000, children: [
    { economicKind: "principal" as const, amountMinor: -700, categoryId: "cat-loan", payeeId: null, transferAccountId: "loan", notes: "Principal" },
    { economicKind: "interest" as const, amountMinor: -300, categoryId: "cat-int", payeeId: "p", transferAccountId: null, notes: "Interest" },
  ] };
  const result = { parentId: "r", parentAmount: -1000, children: [
    { id: "c1", amount: -700, categoryId: "cat-loan", payeeId: "tp-loan", notes: "Principal", transferId: "x1" },
    { id: "c2", amount: -300, categoryId: "cat-int", payeeId: "p", notes: "Interest", transferId: null },
  ] };
  const liability = [tx({ id: "x1", amount: 700, transferId: "c1" })];

  it("passes an exact split with one liability-side row", () => {
    expect(verifySplitOutcome({ expected, result, transferPayeeByAccount: { loan: "tp-loan" }, liabilityRows: liability, before: row({}) })).toEqual([]);
  });
  it("split-sum (split ≠ parent)", () => {
    const bad = { ...result, children: [result.children[0], { ...result.children[1], amount: -299 }] };
    expect(verifySplitOutcome({ expected, result: bad, transferPayeeByAccount: { loan: "tp-loan" }, liabilityRows: liability, before: row({}) }).map((i) => i.kind)).toContain("split-sum");
  });
  it("split-mismatch", () => {
    const bad = { ...result, children: [result.children[0], { ...result.children[1], categoryId: "other" }] };
    expect(verifySplitOutcome({ expected, result: bad, transferPayeeByAccount: { loan: "tp-loan" }, liabilityRows: liability, before: row({}) }).map((i) => i.kind)).toEqual(["split-mismatch"]);
  });
  it("liability-rows (two liability-side rows)", () => {
    expect(verifySplitOutcome({ expected, result, transferPayeeByAccount: { loan: "tp-loan" }, liabilityRows: [...liability, tx({ id: "x2", amount: 700, transferId: "c1" })], before: row({}) }).map((i) => i.kind)).toEqual(["liability-rows"]);
  });
  it("reconciled-changed", () => {
    expect(verifySplitOutcome({ expected, result, transferPayeeByAccount: { loan: "tp-loan" }, liabilityRows: liability, before: row({ reconciled: true }) }).map((i) => i.kind)).toContain("reconciled-changed");
  });

  const pair = { sourceTransferId: "lender", counterpartTransferId: "child", counterpartAmountMinor: 700 };
  it("link: link-incomplete, imported-id-lost and stray counterpart each fail", () => {
    const counterpartBefore = row({ id: "lender", accountId: "loan", amountMinor: 700, importedId: "lender:1" });
    const ok = { sourceId: "child", counterpartId: "lender", sourceTransferId: "lender", counterpartTransferId: "child", counterpartAmount: 700 };
    expect(verifyLinkOutcome({ result: ok, expected: pair, counterpartBefore, counterpartNow: tx({ id: "lender", importedId: "lender:1" }), sourceAccountRows: [] })).toEqual([]);
    expect(verifyLinkOutcome({ result: { ...ok, counterpartTransferId: null }, expected: pair, counterpartBefore, counterpartNow: null, sourceAccountRows: [] }).map((i) => i.kind)).toContain("link-incomplete");
    expect(verifyLinkOutcome({ result: ok, expected: pair, counterpartBefore, counterpartNow: tx({ id: "lender", importedId: null }), sourceAccountRows: [] }).map((i) => i.kind)).toContain("imported-id-lost");
    expect(verifyLinkOutcome({ result: ok, expected: pair, counterpartBefore, counterpartNow: tx({ id: "lender", importedId: "lender:1" }), sourceAccountRows: [tx({ id: "stray", transferId: "lender" })] }).map((i) => i.kind)).toContain("liability-rows");
  });
});

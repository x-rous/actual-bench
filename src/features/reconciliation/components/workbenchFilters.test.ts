import { REASON } from "@/lib/reconciliation/session/build";
import type { ReconciliationItem } from "@/lib/reconciliation/types";
import { matchesFilter, type FilterId } from "./Workbench";

/**
 * "Needs review" and the four reasons beneath it are one question asked at two
 * levels, and they drifted: the parent counted only rows still undecided while
 * the children counted by reason alone. Deciding a row then removed it from the
 * parent and left it in the child, so the workbench showed "Needs review 0"
 * above "Amount differs 14".
 */

function item(over: Partial<ReconciliationItem> = {}): ReconciliationItem {
  return {
    id: "i1",
    statementRowIds: ["s1"],
    actualTransactionIds: ["t1"],
    disposition: "unresolved",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    ...over,
  } as ReconciliationItem;
}

const REASON_FILTERS: FilterId[] = [
  "ambiguous",
  "amount-mismatch",
  "wrong-amount",
  "duplicates",
];

const REASON_FOR: Record<string, string> = {
  ambiguous: REASON.ambiguousMatch,
  "amount-mismatch": REASON.amountMismatch,
  "wrong-amount": REASON.sameMerchantDate,
  duplicates: REASON.likelyDuplicate,
};

describe("the review filter and the reasons beneath it", () => {
  it.each(REASON_FILTERS)("counts an undecided %s row under its parent too", (child) => {
    const row = item({ reasonCode: REASON_FOR[child] });
    expect(matchesFilter(row, child)).toBe(true);
    expect(matchesFilter(row, "needs-review")).toBe(true);
  });

  it.each(REASON_FILTERS)("drops a decided %s row from parent and child alike", (child) => {
    // The bug: this stayed in the child while leaving the parent, so the parent
    // could read zero while its own breakdown showed twenty.
    const row = item({ reasonCode: REASON_FOR[child], disposition: "matched" });
    expect(matchesFilter(row, child)).toBe(false);
    expect(matchesFilter(row, "needs-review")).toBe(false);
  });

  it("counts the parent as exactly the union of its children", () => {
    const rows = [
      item({ id: "a", reasonCode: REASON.ambiguousMatch }),
      item({ id: "b", reasonCode: REASON.belowConfidenceFloor }),
      item({ id: "c", reasonCode: REASON.amountMismatch }),
      item({ id: "d", reasonCode: REASON.sameMerchantDate }),
      item({ id: "e", reasonCode: REASON.merchantCluster }),
      item({ id: "f", reasonCode: REASON.likelyDuplicate }),
      // Decided, and so in neither.
      item({ id: "g", reasonCode: REASON.amountMismatch, disposition: "create" }),
      // Never a review row at all.
      item({ id: "h", reasonCode: REASON.noActualCandidate }),
    ];

    const parent = rows.filter((row) => matchesFilter(row, "needs-review"));
    const children = rows.filter((row) =>
      REASON_FILTERS.some((child) => matchesFilter(row, child))
    );

    expect(parent.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(children.map((row) => row.id)).toEqual(parent.map((row) => row.id));
  });

  it("keeps rows that are not under review out of it", () => {
    expect(matchesFilter(item({ reasonCode: REASON.noActualCandidate }), "needs-review")).toBe(false);
    expect(matchesFilter(item({ reasonCode: REASON.notOnStatement }), "needs-review")).toBe(false);
  });
});

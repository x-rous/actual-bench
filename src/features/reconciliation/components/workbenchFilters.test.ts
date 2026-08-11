import { REASON, summarizeCoverage } from "@/lib/reconciliation/session/build";
import type { ReconciliationItem } from "@/lib/reconciliation/types";
import { matchesFilter, type FilterId } from "./Workbench";

/**
 * "Needs review", the reasons beneath it, and the coverage bar are one question
 * asked in three places, and all three had drifted apart. The parent required a
 * row to be undecided, the children counted by reason alone, and the bar used a
 * third rule - so the workbench could show "Needs review 20" on the bar, 0 on
 * the filter, and 14 on a reason beneath it, all at once.
 *
 * They now share one test: it says what kind of row this is, which deciding it
 * does not change. Only pairing it does, because that turns an open question
 * into a match. How much is left to do is the decision meter's job.
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

  it.each(REASON_FILTERS)("keeps a decided %s row in parent and child alike", (child) => {
    // Deciding does not change what kind of row it was, so the count holds
    // still. The bug was that it held still in the child and not in the parent.
    const row = item({ reasonCode: REASON_FOR[child], disposition: "ignored" });
    expect(matchesFilter(row, child)).toBe(true);
    expect(matchesFilter(row, "needs-review")).toBe(true);
  });

  it.each(REASON_FILTERS)("drops a %s row once it is paired", (child) => {
    // Pairing is the one decision that changes the kind: the open question is
    // answered, and the row is a match. The coverage bar counts it that way too.
    const row = item({ reasonCode: REASON_FOR[child], disposition: "matched" });
    expect(matchesFilter(row, child)).toBe(false);
    expect(matchesFilter(row, "needs-review")).toBe(false);
    expect(matchesFilter(row, "matched")).toBe(true);
  });

  it("counts the parent as exactly the union of its children", () => {
    const rows = [
      item({ id: "a", reasonCode: REASON.ambiguousMatch }),
      item({ id: "b", reasonCode: REASON.belowConfidenceFloor }),
      item({ id: "c", reasonCode: REASON.amountMismatch }),
      item({ id: "d", reasonCode: REASON.sameMerchantDate }),
      item({ id: "e", reasonCode: REASON.merchantCluster }),
      item({ id: "f", reasonCode: REASON.likelyDuplicate }),
      // Decided but still the same kind of row, so still in both.
      item({ id: "g", reasonCode: REASON.amountMismatch, disposition: "correct-amount" }),
      // Never a review row at all.
      item({ id: "h", reasonCode: REASON.noActualCandidate }),
    ];

    const parent = rows.filter((row) => matchesFilter(row, "needs-review"));
    const children = rows.filter((row) =>
      REASON_FILTERS.some((child) => matchesFilter(row, child))
    );

    expect(parent.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(children.map((row) => row.id)).toEqual(parent.map((row) => row.id));
  });

  it("agrees with the coverage bar on every row", () => {
    /*
     * The whole point: the bar and the filter are two readings of one fact, and
     * a user who sees them disagree has no way to know which to believe. This
     * pins them together over every combination of reason and decision.
     */
    const reasons = [
      REASON.ambiguousMatch,
      REASON.belowConfidenceFloor,
      REASON.amountMismatch,
      REASON.sameMerchantDate,
      REASON.merchantCluster,
      REASON.likelyDuplicate,
      REASON.noActualCandidate,
      REASON.notOnStatement,
    ];
    const dispositions = [
      "unresolved",
      "matched",
      "create",
      "keep",
      "delete",
      "ignored",
      "correct-amount",
    ] as const;

    for (const reasonCode of reasons) {
      for (const disposition of dispositions) {
        const rows = [item({ reasonCode, disposition })];
        const onTheBar = summarizeCoverage(rows, {
          statementRows: 1,
          loadedTransactions: 1,
        }).statement.needsReview;
        const inTheFilter = rows.filter((row) => matchesFilter(row, "needs-review")).length;

        expect({ reasonCode, disposition, onTheBar }).toEqual({
          reasonCode,
          disposition,
          onTheBar: inTheFilter,
        });
      }
    }
  });

  it("keeps rows that are not under review out of it", () => {
    expect(matchesFilter(item({ reasonCode: REASON.noActualCandidate }), "needs-review")).toBe(false);
    expect(matchesFilter(item({ reasonCode: REASON.notOnStatement }), "needs-review")).toBe(false);
  });
});

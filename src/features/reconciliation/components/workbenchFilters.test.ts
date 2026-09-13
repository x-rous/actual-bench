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
  // A contested group is its own reason, not a kind of wrong amount: one asks
  // "which of these is it", the other says "this is the one and its figure is
  // off". They were counted together, so the two could not be worked apart.
  "cluster",
  "duplicates",
];

const REASON_FOR: Record<string, string> = {
  ambiguous: REASON.ambiguousMatch,
  // The other half of "Several candidates": one candidate, too weak to take.
  // It shares a filter with `ambiguousMatch`, so a partition claiming to cover
  // every row kind has to carry it too.
  "below-floor": REASON.belowConfidenceFloor,
  "amount-mismatch": REASON.amountMismatch,
  "wrong-amount": REASON.sameMerchantDate,
  cluster: REASON.merchantCluster,
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

/*
 * The filter row now names two groups and states a subtotal for each, so those
 * subtotals have to mean something: they are summed from the chips beneath
 * them, which is only honest if every row lands in exactly one chip. A row
 * counted twice inflates a group; a row counted nowhere makes the two subtotals
 * fail to reach All, and the arithmetic a reader checks at a glance - 49 and 19
 * make 68 - stops holding.
 */
describe("the top-level filters partition the rows", () => {
  const TOP_LEVEL: FilterId[] = [
    "needs-review",
    "create",
    "matched",
    "actual-only",
    "outside-period",
  ];

  const everyKind: { name: string; item: ReconciliationItem }[] = [
    { name: "an automatic match", item: item({ disposition: "matched" }) },
    {
      name: "a match the user accepted",
      item: item({ disposition: "matched", reasonCode: REASON.ambiguousMatch }),
    },
    ...Object.entries(REASON_FOR).map(([name, reasonCode]) => ({
      name: `a row needing review (${name})`,
      item: item({ reasonCode }),
    })),
    {
      name: "a row with nothing in Actual",
      item: item({ reasonCode: REASON.noActualCandidate, actualTransactionIds: [] }),
    },
    {
      name: "one the user chose to create",
      item: item({
        disposition: "create",
        reasonCode: REASON.noActualCandidate,
        actualTransactionIds: [],
      }),
    },
    {
      name: "a transaction the statement did not mention",
      item: item({ reasonCode: REASON.notOnStatement, statementRowIds: [] }),
    },
    {
      name: "one dated outside the period",
      item: item({
        disposition: "keep",
        reasonCode: REASON.outsideStatementPeriod,
        statementRowIds: [],
      }),
    },
    {
      name: "one outside the period the user deleted",
      item: item({
        disposition: "delete",
        reasonCode: REASON.outsideStatementPeriod,
        statementRowIds: [],
      }),
    },
  ];

  for (const { name, item: row } of everyKind) {
    it(`counts ${name} exactly once`, () => {
      const hits = TOP_LEVEL.filter((filter) => matchesFilter(row, filter));
      expect(hits).toHaveLength(1);
    });
  }

  it("adds up, so the two subtotals reach All", () => {
    const rows = everyKind.map((entry) => entry.item);
    const countOf = (filter: FilterId) =>
      rows.filter((row) => matchesFilter(row, filter)).length;

    const statement = countOf("needs-review") + countOf("create") + countOf("matched");
    const actual = countOf("actual-only") + countOf("outside-period");

    expect(statement + actual).toBe(rows.length);
  });
});

/*
 * Each group's head is also a filter for the whole group, so it has to select
 * exactly the rows its own chips select - no more, no fewer. The tempting
 * shortcut is to read the side off the item (`statementRowIds.length > 0`), and
 * it is wrong: a likely duplicate is an Actual-only row that lands under "Needs
 * review", which sits in the statement group. That head would select 48 where
 * its chips summed to 49, and a head that disagrees with its own group is worse
 * than no head at all.
 */
describe("a group head selects exactly its own group", () => {
  const STATEMENT_CHIPS: FilterId[] = ["needs-review", "create", "matched"];
  const ACTUAL_CHIPS: FilterId[] = ["actual-only", "outside-period"];

  const rows: ReconciliationItem[] = [
    item({ disposition: "matched" }),
    item({ reasonCode: REASON.ambiguousMatch }),
    item({ reasonCode: REASON.noActualCandidate, actualTransactionIds: [] }),
    item({ reasonCode: REASON.notOnStatement, statementRowIds: [] }),
    item({
      disposition: "keep",
      reasonCode: REASON.outsideStatementPeriod,
      statementRowIds: [],
    }),
    // The row that breaks the shortcut: no statement row, yet it belongs to the
    // statement group because it is a review row.
    item({ reasonCode: REASON.likelyDuplicate, statementRowIds: [] }),
  ];

  const matching = (filter: FilterId) => rows.filter((row) => matchesFilter(row, filter));
  const union = (filters: FilterId[]) =>
    rows.filter((row) => filters.some((filter) => matchesFilter(row, filter)));

  it("matches its chips on the statement side", () => {
    expect(matching("statement")).toEqual(union(STATEMENT_CHIPS));
  });

  it("matches its chips on the Actual side", () => {
    expect(matching("in-actual")).toEqual(union(ACTUAL_CHIPS));
  });

  it("keeps a likely duplicate on the statement side, where its chip is", () => {
    const duplicate = rows.at(-1)!;
    expect(matchesFilter(duplicate, "statement")).toBe(true);
    expect(matchesFilter(duplicate, "in-actual")).toBe(false);
  });

  it("splits every row between the two heads, so they add up to All", () => {
    expect(matching("statement").length + matching("in-actual").length).toBe(rows.length);
    for (const row of rows) {
      expect(matchesFilter(row, "statement") && matchesFilter(row, "in-actual")).toBe(false);
    }
  });
});

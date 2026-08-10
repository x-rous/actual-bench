import { DEFAULT_MATCH_CONFIG } from "../match/config";
import { match } from "../match/matcher";
import type { ActualTransactionSnapshot, StatementRow } from "../types";
import { REASON, buildReconciliationItems, summarizeCoverage } from "./build";

let counter = 0;
const makeId = () => `item-${++counter}`;

beforeEach(() => {
  counter = 0;
});

function row(overrides: Partial<StatementRow> & Pick<StatementRow, "id">): StatementRow {
  return {
    sourceRowNumber: 1,
    postedDate: "2026-07-03",
    amount: -4250,
    description: "STARBUCKS",
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
    date: "2026-07-03",
    amount: -4250,
    payeeId: "p-1",
    payeeName: "Starbucks",
    importedPayee: null,
    categoryId: "c-1",
    categoryName: "Coffee",
    notes: null,
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

function build(
  statementRows: StatementRow[],
  actualTransactions: ActualTransactionSnapshot[],
  transfersReported = true,
  statementPeriod?: { start: string; end: string } | null,
  visibleWindow?: { start: string; end: string } | null
) {
  const graph = match({ statementRows, actualTransactions, config: DEFAULT_MATCH_CONFIG });
  return buildReconciliationItems({
    statementRows,
    actualTransactions,
    graph,
    transfersReported,
    statementPeriod,
    visibleWindow,
    makeId,
  });
}

describe("buildReconciliationItems — dispositions", () => {
  it("marks a matched pair as matched", () => {
    const items = build([row({ id: "s1" })], [txn({ id: "t1" })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      disposition: "matched",
      statementRowIds: ["s1"],
      actualTransactionIds: ["t1"],
    });
  });

  it("leaves a statement row with no candidate unresolved, not create", () => {
    // Creating a transaction is a write; the user asks for it explicitly.
    const items = build([row({ id: "s1" })], []);
    expect(items[0]).toMatchObject({
      disposition: "unresolved",
      reasonCode: REASON.noActualCandidate,
    });
  });

  it("leaves an Actual row absent from the statement unresolved, never delete", () => {
    const items = build([], [txn({ id: "t1" })]);
    expect(items[0]).toMatchObject({
      disposition: "unresolved",
      reasonCode: REASON.notOnStatement,
    });
    expect(items.some((item) => item.disposition === "delete")).toBe(false);
  });

  it("keeps every competing candidate on an ambiguous item", () => {
    const items = build(
      [row({ id: "s1", postedDate: "2026-07-08", amount: -11000, description: "AMAZON AE" })],
      [
        txn({ id: "t1", date: "2026-07-07", amount: -11000, payeeName: "Amazon" }),
        txn({ id: "t2", date: "2026-07-08", amount: -11000, payeeName: "Amazon Marketplace" }),
      ]
    );

    const ambiguous = items.find((item) => item.reasonCode === REASON.ambiguousMatch);
    expect(ambiguous?.disposition).toBe("unresolved");
    expect(ambiguous?.actualTransactionIds.sort()).toEqual(["t1", "t2"]);
  });

  it("gives every statement row and every Actual row an item", () => {
    const items = build(
      [row({ id: "s1" }), row({ id: "s2", amount: -999, description: "NOTHING" })],
      [txn({ id: "t1" }), txn({ id: "t2", amount: -777 })]
    );

    const statementIds = items.flatMap((item) => item.statementRowIds);
    const transactionIds = items.flatMap((item) => item.actualTransactionIds);
    expect(statementIds.sort()).toEqual(["s1", "s2"]);
    expect(transactionIds.sort()).toEqual(["t1", "t2"]);
  });
});

describe("buildReconciliationItems — guardrails", () => {
  it("flags a reconciled Actual row as protected", () => {
    const items = build([row({ id: "s1" })], [txn({ id: "t1", reconciled: true })]);
    expect(items[0].guards.protectedReconciled).toBe(true);
  });

  it("flags a split parent", () => {
    const items = build(
      [row({ id: "s1" })],
      [
        txn({
          id: "t1",
          isParent: true,
          splitLines: [
            {
              id: "c1",
              amount: -4250,
              payeeName: null,
              categoryId: "g",
              categoryName: "Groceries",
              notes: null,
            },
          ],
        }),
      ]
    );
    expect(items[0].guards.splitParent).toBe(true);
  });

  it("flags a transfer leg", () => {
    const items = build([], [txn({ id: "t1", transferId: "xfer-1" })]);
    expect(items[0].guards.transfer).toBe("yes");
  });

  it("reports unknown transfer status when the transport does not report transfers", () => {
    // The conservative branch: "not reported" must never read as "not a transfer".
    const items = build([], [txn({ id: "t1", transferId: null })], false);
    expect(items[0].guards.transfer).toBe("unknown");
  });

  it("reports no transfer when the transport does report them", () => {
    const items = build([], [txn({ id: "t1", transferId: null })], true);
    expect(items[0].guards.transfer).toBe("no");
  });
});

describe("buildReconciliationItems — duplicates", () => {
  it("marks the losing near-identical row as a likely duplicate", () => {
    const items = build(
      [row({ id: "s1", postedDate: "2026-07-07", amount: -8640, description: "TALABAT" })],
      [
        txn({ id: "t1", date: "2026-07-07", amount: -8640, payeeName: "Talabat" }),
        txn({ id: "t2", date: "2026-07-08", amount: -8640, payeeName: "Talabat" }),
      ]
    );

    const duplicates = items.filter((item) => item.reasonCode === REASON.likelyDuplicate);
    // Either the pair resolved and the loser is flagged, or the whole thing is
    // ambiguous — both are acceptable, but it must never be silently dropped.
    const ambiguous = items.filter((item) => item.reasonCode === REASON.ambiguousMatch);
    expect(duplicates.length + ambiguous.length).toBeGreaterThan(0);
  });
});

describe("transactions loaded outside the statement period", () => {
  const period = { start: "2026-07-07", end: "2026-08-06" };

  it("flags a padded-window transaction rather than calling it missing from the statement", () => {
    // Loaded only because the candidate window pads either side. The statement
    // makes no claim about these dates, so it is not an unexplained transaction.
    const items = build([], [txn({ id: "t1", date: "2026-08-10" })], true, period);
    expect(items[0].reasonCode).toBe(REASON.outsideStatementPeriod);
  });

  it("flags one before the period too", () => {
    const items = build([], [txn({ id: "t1", date: "2026-07-02" })], true, period);
    expect(items[0].reasonCode).toBe(REASON.outsideStatementPeriod);
  });

  it("still calls an in-period transaction missing from the statement", () => {
    const items = build([], [txn({ id: "t1", date: "2026-07-20" })], true, period);
    expect(items[0].reasonCode).toBe(REASON.notOnStatement);
  });

  it("excludes it from the explained ratio instead of counting it as a gap", () => {
    const items = build(
      [row({ id: "s1", postedDate: "2026-07-20" })],
      [
        txn({ id: "t1", date: "2026-07-20" }),
        txn({ id: "t2", date: "2026-08-10", amount: -999 }),
      ],
      true,
      period
    );

    const coverage = summarizeCoverage(items, { statementRows: 1, actualTransactions: 2 });
    // One transaction in period, matched. The padded one is reported separately.
    expect(coverage.actualTransactions).toBe(1);
    expect(coverage.actualTransactionsExplained).toBe(1);
    expect(coverage.outsideStatementPeriod).toBe(1);
    expect(coverage.unresolved).toBe(0);
  });

  it("omits an unmatched transaction outside the range the user asked to see", () => {
    // Padding of zero: the window loaded is still wide enough for matching to
    // reach across the boundary, but the user asked to see only their own
    // period, so a neighbouring transaction is not listed at all.
    const items = build(
      [],
      [txn({ id: "t1", date: "2026-08-10" })],
      true,
      period,
      period
    );
    expect(items).toHaveLength(0);
  });

  it("keeps a matched pair even when the transaction sits outside that range", () => {
    // Matching headroom exists precisely so a statement row at the edge of the
    // period can pair with a transaction recorded just outside it.
    const items = build(
      [row({ id: "s1", postedDate: "2026-08-06" })],
      [txn({ id: "t1", date: "2026-08-08" })],
      true,
      period,
      period
    );
    expect(items).toHaveLength(1);
    expect(items[0].disposition).toBe("matched");
  });

  it("keeps the old behaviour when no period is supplied", () => {
    const items = build([], [txn({ id: "t1", date: "2026-08-10" })]);
    expect(items[0].reasonCode).toBe(REASON.notOnStatement);
  });
});

describe("summarizeCoverage", () => {
  it("reports both sides independently", () => {
    const items = build(
      [row({ id: "s1" }), row({ id: "s2", amount: -999, description: "MISSING" })],
      [txn({ id: "t1" }), txn({ id: "t2", amount: -777, payeeName: "Orphan" })]
    );

    const coverage = summarizeCoverage(items, { statementRows: 2, actualTransactions: 2 });

    expect(coverage.statementRows).toBe(2);
    expect(coverage.actualTransactions).toBe(2);
    // One matched pair; the other row on each side is unexplained.
    expect(coverage.statementRowsResolved).toBe(1);
    expect(coverage.actualTransactionsExplained).toBe(1);
    expect(coverage.matched).toBe(1);
    expect(coverage.unresolved).toBe(2);
  });

  it("counts a fully matched statement as fully resolved on both sides", () => {
    const items = build([row({ id: "s1" })], [txn({ id: "t1" })]);
    const coverage = summarizeCoverage(items, { statementRows: 1, actualTransactions: 1 });

    expect(coverage.statementRowsResolved).toBe(1);
    expect(coverage.actualTransactionsExplained).toBe(1);
    expect(coverage.unresolved).toBe(0);
  });

  it("counts an empty session as zero rather than dividing by nothing", () => {
    const coverage = summarizeCoverage([], { statementRows: 0, actualTransactions: 0 });
    expect(coverage.statementRowsResolved).toBe(0);
    expect(coverage.actualTransactionsExplained).toBe(0);
  });
});

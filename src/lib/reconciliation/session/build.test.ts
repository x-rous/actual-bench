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

  it("does not count a padded transaction against the statement", () => {
    const items = build(
      [row({ id: "s1", postedDate: "2026-07-20" })],
      [
        txn({ id: "t1", date: "2026-07-20" }),
        txn({ id: "t2", date: "2026-08-10", amount: -999 }),
      ],
      true,
      period
    );

    const coverage = summarizeCoverage(items, { statementRows: 1, loadedTransactions: 2 });
    expect(coverage.statement.matched).toBe(1);
    expect(coverage.outsideStatementPeriod).toBe(1);
  });

  it("keeps the old behaviour when no period is supplied", () => {
    const items = build([], [txn({ id: "t1", date: "2026-08-10" })]);
    expect(items[0].reasonCode).toBe(REASON.notOnStatement);
  });
});

describe("summarizeCoverage", () => {
  it("breaks the statement into parts that sum to its total", () => {
    // The number that matters: of the rows the bank says posted, how many are
    // accounted for. A breakdown that does not add up is worse than none.
    const items = build(
      [
        row({ id: "s1" }),
        row({ id: "s2", amount: -999, description: "NOT IN ACTUAL" }),
        row({ id: "s3", postedDate: "2026-07-08", amount: -11000, description: "AMAZON AE" }),
      ],
      [
        txn({ id: "t1" }),
        txn({ id: "t2", date: "2026-07-07", amount: -11000, payeeName: "Amazon" }),
        txn({ id: "t3", date: "2026-07-08", amount: -11000, payeeName: "Amazon Marketplace" }),
      ]
    );

    const coverage = summarizeCoverage(items, { statementRows: 3, loadedTransactions: 3 });
    const { statement } = coverage;

    expect(statement.total).toBe(3);
    expect(statement.matched + statement.needsReview + statement.unaccounted).toBe(statement.total);
    expect(statement.matched).toBe(1);
    expect(statement.needsReview).toBe(1);
    expect(statement.unaccounted).toBe(1);
  });

  it("breaks Actual into parts that sum to its total", () => {
    const items = build(
      [row({ id: "s1" })],
      [txn({ id: "t1" }), txn({ id: "t2", amount: -777, payeeName: "Orphan" })]
    );

    const { actual } = summarizeCoverage(items, { statementRows: 1, loadedTransactions: 2 });
    expect(actual.matched + actual.needsReview + actual.unaccounted).toBe(actual.total);
    expect(actual.total).toBe(2);
    expect(actual.matched).toBe(1);
    expect(actual.unaccounted).toBe(1);
  });

  it("counts a transaction once even when several review candidates share an item", () => {
    const items = build(
      [row({ id: "s1", postedDate: "2026-07-08", amount: -11000, description: "AMAZON AE" })],
      [
        txn({ id: "t1", date: "2026-07-07", amount: -11000, payeeName: "Amazon" }),
        txn({ id: "t2", date: "2026-07-08", amount: -11000, payeeName: "Amazon Marketplace" }),
      ]
    );

    const { actual } = summarizeCoverage(items, { statementRows: 1, loadedTransactions: 2 });
    expect(actual.total).toBe(2);
    expect(actual.needsReview).toBe(2);
  });

  it("reports transactions loaded only as matching headroom separately", () => {
    // They have no row, so counting them in the Actual total would make it
    // impossible to reconcile the breakdown against what is on screen.
    const items = build([row({ id: "s1" })], [txn({ id: "t1" })]);
    const coverage = summarizeCoverage(items, { statementRows: 1, loadedTransactions: 40 });

    expect(coverage.actual.total).toBe(1);
    expect(coverage.loadedAsHeadroom).toBe(39);
  });

  it("reports an empty session as zero rather than dividing by nothing", () => {
    const coverage = summarizeCoverage([], { statementRows: 0, loadedTransactions: 0 });
    expect(coverage.statement.total).toBe(0);
    expect(coverage.actual.total).toBe(0);
    expect(coverage.loadedAsHeadroom).toBe(0);
  });
});

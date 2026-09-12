import { DEFAULT_MATCH_CONFIG } from "../match/config";
import { match } from "../match/matcher";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "../types";
import {
  REASON,
  buildReconciliationItems,
  correctAmountFromStatement,
  linkManually,
  resolveToTransaction,
  summarizeCoverage,
} from "./build";

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
    importedPayee: "STARBUCKS",
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
      [row({ id: "s1", postedDate: "2026-07-08", amount: -11000, importedPayee: "AMAZON AE" })],
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
      [row({ id: "s1" }), row({ id: "s2", amount: -999, importedPayee: "NOTHING" })],
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
      [row({ id: "s1", postedDate: "2026-07-07", amount: -8640, importedPayee: "TALABAT" })],
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
        row({ id: "s2", amount: -999, importedPayee: "NOT IN ACTUAL" }),
        row({ id: "s3", postedDate: "2026-07-08", amount: -11000, importedPayee: "AMAZON AE" }),
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

  it("keeps counting a row as needing review after it is decided", () => {
    /*
     * "Needs review" says what kind of row this is - one the matcher would not
     * settle on its own - and deciding it does not change that. The count is
     * meant to hold still while the statement is worked through; how much is
     * left to do is the decision meter's job.
     */
    const reviewItem: ReconciliationItem = {
      id: "i1",
      statementRowIds: ["s1"],
      actualTransactionIds: ["t1"],
      disposition: "unresolved",
      reasonCode: REASON.amountMismatch,
      guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    };
    const counted = { statementRows: 1, loadedTransactions: 1 };

    expect(summarizeCoverage([reviewItem], counted).statement.needsReview).toBe(1);

    for (const disposition of ["ignored", "create", "correct-amount", "delete"] as const) {
      const decided = summarizeCoverage([{ ...reviewItem, disposition }], counted);
      expect(decided.statement.needsReview).toBe(1);
    }
  });

  it("moves a row out of review only when it is paired", () => {
    // Picking a candidate is the one decision that changes what kind of row it
    // is: it stops being an open question and becomes a match.
    const paired = summarizeCoverage(
      [
        {
          id: "i1",
          statementRowIds: ["s1"],
          actualTransactionIds: ["t1"],
          disposition: "matched",
          reasonCode: REASON.ambiguousMatch,
          guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
        },
      ],
      { statementRows: 1, loadedTransactions: 1 }
    );

    expect(paired.statement.matched).toBe(1);
    expect(paired.statement.needsReview).toBe(0);
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
      [row({ id: "s1", postedDate: "2026-07-08", amount: -11000, importedPayee: "AMAZON AE" })],
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


describe("resolving a review item to one transaction", () => {
  const transactions = new Map([
    ["t1", txn({ id: "t1" })],
    ["t2", txn({ id: "t2" })],
    ["t3", txn({ id: "t3", transferId: "x1" })],
  ]);

  const reviewItem: ReconciliationItem = {
    id: "i1",
    statementRowIds: ["s1"],
    actualTransactionIds: ["t1", "t2", "t3"],
    disposition: "unresolved",
    reasonCode: REASON.ambiguousMatch,
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
  };

  /** The decided item, and the rows that decision created, from the next set. */
  function resolve(
    transactionId: string | null,
    items: ReconciliationItem[] = [reviewItem],
    transfersReported = true,
    map = transactions
  ) {
    let counter = 0;
    const next = resolveToTransaction({
      items,
      itemId: "i1",
      transactionId,
      transactions: map,
      transfersReported,
      makeId: () => `released-${++counter}`,
    });
    return {
      next,
      item: next.find((entry) => entry.id === "i1")!,
      released: next.filter((entry) => entry.id.startsWith("released-")),
      others: next.filter((entry) => entry.id !== "i1" && !entry.id.startsWith("released-")),
    };
  }

  /*
   * The workbench used to pass `transfersReported: true` as a literal, so a
   * transport that reports nothing about transfers still produced `transfer:
   * "no"` — the one value that lets a delete through. `canStageDelete`'s
   * conservative branch was unreachable for every row released by a decision
   * (F-151d).
   */
  it("keeps the transfer status unknown when the transport did not report one", () => {
    const { item, released } = resolve("t1", [reviewItem], false);

    expect(item.guards.transfer).toBe("unknown");
    expect(released).toHaveLength(2);
    for (const entry of released) {
      expect(entry.guards.transfer).toBe("unknown");
    }
  });

  it("still reports a real transfer as one when the transport does report them", () => {
    // The pessimistic default must not flatten a known answer into "unknown".
    expect(resolve("t3").item.guards.transfer).toBe("yes");
  });

  it("carries the chosen transaction's guardrails, not the leading candidate's", () => {
    /*
     * A review item holds the *leading* candidate's guards, because that is the
     * one it would have matched. Picking a different candidate must recompute
     * them: staging, deletion and the apply plan all enforce protection by
     * reading this one field, so keeping the leader's guards would strip a
     * reconciled row, split parent or transfer leg of its protection at the
     * exact moment the user chose it deliberately.
     */
    const { item } = resolve("t3");
    expect(item.actualTransactionIds).toEqual(["t3"]);
    expect(item.guards.transfer).toBe("yes");
  });

  it("recomputes the reconciled and split guards too", () => {
    const { item } = resolve(
      "t2",
      [{ ...reviewItem, actualTransactionIds: ["t1", "t2"] }],
      true,
      new Map([
        ["t1", txn({ id: "t1" })],
        ["t2", txn({ id: "t2", reconciled: true, isParent: true })],
      ])
    );

    expect(item.guards.protectedReconciled).toBe(true);
    expect(item.guards.splitParent).toBe(true);
  });

  it("matches the chosen transaction and records it as the user's own decision", () => {
    const { item } = resolve("t1");
    expect(item.actualTransactionIds).toEqual(["t1"]);
    expect(item.disposition).toBe("matched");
    expect(item.match?.evidenceSource).toBe("manual");
  });

  it("gives every unpicked transaction a row of its own", () => {
    // Without this they vanish: they were only visible through the item that
    // offered them, so dropping the reference removes them from the workbench
    // while leaving them in the budget.
    const { released } = resolve("t1");
    expect(released.map((entry) => entry.actualTransactionIds[0]).sort()).toEqual(["t2", "t3"]);
    expect(released.every((entry) => entry.disposition === "unresolved")).toBe(true);
  });

  it("never marks a released transaction for deletion", () => {
    // Declining to match something is not the same as asking to remove it.
    expect(resolve("t1").released.some((entry) => entry.disposition === "delete")).toBe(false);
  });

  it("carries each released transaction's guardrails with it", () => {
    const transfer = resolve("t1").released.find(
      (entry) => entry.actualTransactionIds[0] === "t3"
    );
    expect(transfer?.guards.transfer).toBe("yes");
  });

  it("releases all of them when the user picks none", () => {
    const { item, released } = resolve(null);
    expect(item.actualTransactionIds).toEqual([]);
    expect(item.reasonCode).toBe(REASON.noActualCandidate);
    // Undecided, not create: declining these is not a request for a new one.
    expect(item.disposition).toBe("unresolved");
    expect(released).toHaveLength(3);
  });

  it("keeps every transaction represented exactly once", () => {
    const { item, released } = resolve("t2");
    const all = [...item.actualTransactionIds, ...released.flatMap((e) => e.actualTransactionIds)];
    expect(all.sort()).toEqual(["t1", "t2", "t3"]);
  });
});

/*
 * A cluster offers the same transactions to several statement rows. Deciding one
 * of them used to demote the rest of the pool to "Actual only" keep-or-delete
 * rows while the other statement rows went on reading "not in Actual" — so the
 * user created duplicates of transactions sitting one line below, offered for
 * deletion (F-151b).
 */
describe("deciding one row of a cluster", () => {
  const transactions = new Map([
    ["t1", txn({ id: "t1" })],
    ["t2", txn({ id: "t2" })],
    ["t3", txn({ id: "t3" })],
  ]);

  /** Three statement rows, all offered the same three transactions. */
  const cluster: ReconciliationItem[] = ["i1", "i2", "i3"].map((id, index) => ({
    id,
    statementRowIds: [`s${index + 1}`],
    actualTransactionIds: ["t1", "t2", "t3"],
    disposition: "unresolved",
    reasonCode: REASON.merchantCluster,
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
  }));

  function decide(itemId: string, transactionId: string | null, items = cluster) {
    let counter = 0;
    return resolveToTransaction({
      items,
      itemId,
      transactionId,
      transactions,
      transfersReported: true,
      makeId: () => `released-${++counter}`,
    });
  }

  it("withdraws the claimed transaction from every row still undecided", () => {
    const next = decide("i1", "t2");

    expect(next.find((entry) => entry.id === "i1")?.actualTransactionIds).toEqual(["t2"]);
    for (const id of ["i2", "i3"]) {
      expect(next.find((entry) => entry.id === id)?.actualTransactionIds).toEqual(["t1", "t3"]);
    }
  });

  it("leaves the others as candidates rather than rows of their own", () => {
    // The heart of F-151b: t1 and t3 are still wanted, so they are not homeless
    // and must not turn into "Actual only" rows the user might delete.
    const next = decide("i1", "t2");

    expect(next.filter((entry) => entry.id.startsWith("released-"))).toEqual([]);
    expect(next.filter((entry) => entry.reasonCode === REASON.notOnStatement)).toEqual([]);
    expect(next).toHaveLength(3);
  });

  it("does not touch a row that has already been decided", () => {
    const withDecided = [
      cluster[0],
      { ...cluster[1], disposition: "matched" as const, actualTransactionIds: ["t3"] },
      cluster[2],
    ];
    const next = decide("i1", "t2", withDecided);

    expect(next.find((entry) => entry.id === "i2")).toEqual(withDecided[1]);
  });

  it("stops calling it a cluster once one candidate is left", () => {
    // Two rows, two transactions: deciding one leaves the other with a single
    // candidate, and "several here" would then be a false statement.
    const pair = cluster.slice(0, 2).map((item) => ({
      ...item,
      actualTransactionIds: ["t1", "t2"],
    }));
    const next = decide("i1", "t1", pair);

    expect(next.find((entry) => entry.id === "i2")).toMatchObject({
      actualTransactionIds: ["t2"],
      reasonCode: REASON.sameMerchantDate,
    });
  });

  it("reports a row whose last candidate was taken as one Actual has nothing for", () => {
    const pair = cluster.slice(0, 2).map((item) => ({
      ...item,
      actualTransactionIds: ["t1"],
    }));
    const next = decide("i1", "t1", pair);

    expect(next.find((entry) => entry.id === "i2")).toMatchObject({
      actualTransactionIds: [],
      reasonCode: REASON.noActualCandidate,
      disposition: "unresolved",
    });
  });

  it("frees a transaction nobody else wants into a row of its own", () => {
    // The last undecided row declines everything: the pool is now homeless and
    // has to become visible, or it is in the budget and off the screen.
    const single = [{ ...cluster[0], actualTransactionIds: ["t1", "t2"] }];
    const next = decide("i1", null, single);

    expect(next.filter((entry) => entry.reasonCode === REASON.notOnStatement)).toHaveLength(2);
  });

  it("keeps every transaction represented exactly once, whatever the order", () => {
    // The invariant the whole design turns on, checked across a sequence.
    let items = decide("i1", "t2");
    items = resolveToTransaction({
      items,
      itemId: "i2",
      transactionId: "t3",
      transactions,
      transfersReported: true,
      makeId: () => "released-x",
    });

    const all = items.flatMap((entry) => entry.actualTransactionIds).sort();
    expect(all).toEqual(["t1", "t2", "t3"]);
  });

  it("does not re-home a transaction a decided row is still holding", () => {
    /*
     * A row settled as `correct-amount` keeps its transaction, and the check for
     * whether a released id is homeless used to look only at *undecided* rows.
     * So the last row to let go of that id minted a second "Actual only" row for
     * a transaction another row already owned - two rows, one transaction,
     * which is the invariant this whole function exists to hold.
     */
    const decided: ReconciliationItem = {
      ...cluster[1],
      disposition: "correct-amount",
      actualTransactionIds: ["t1"],
    };
    const next = decide("i1", null, [
      { ...cluster[0], actualTransactionIds: ["t1"] },
      decided,
    ]);

    expect(next.filter((entry) => entry.reasonCode === REASON.notOnStatement)).toEqual([]);
    const all = next.flatMap((entry) => entry.actualTransactionIds);
    expect(all).toEqual(["t1"]);
  });
});

/*
 * Picking a candidate is the judgement; the amount follows from it. Leaving the
 * user to press a second "Set amount to ..." control afterwards asks the same
 * question twice, and a reconciliation abandoned between the two is matched to a
 * figure the bank disagrees with.
 */
describe("carrying the statement's amount onto a chosen transaction", () => {
  const statementRow = row({ id: "s1", amount: -5442 });

  function correct(over: Partial<ReconciliationItem> = {}, transaction = txn({ id: "t1", amount: -5207 })) {
    return correctAmountFromStatement({
      item: {
        id: "i1",
        statementRowIds: ["s1"],
        actualTransactionIds: ["t1"],
        disposition: "matched",
        guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
        ...over,
      },
      statementRow,
      transaction,
    });
  }

  it("stages the correction rather than writing it", () => {
    const item = correct();

    expect(item.disposition).toBe("correct-amount");
    expect(item.stagedChanges?.amount).toEqual({
      original: -5207,
      staged: -5442,
      source: "manual",
    });
  });

  it("leaves a row alone when the amounts already agree", () => {
    const item = correct({}, txn({ id: "t1", amount: -5442 }));
    expect(item.disposition).toBe("matched");
    expect(item.stagedChanges).toBeUndefined();
  });

  it.each([
    ["reconciled in Actual", { protectedReconciled: true, splitParent: false, transfer: "no" as const }],
    ["a split parent", { protectedReconciled: false, splitParent: true, transfer: "no" as const }],
  ])("respects the guardrail on %s", (_label, guards) => {
    const item = correct({ guards });
    expect(item.disposition).toBe("matched");
    expect(item.stagedChanges?.amount).toBeUndefined();
  });

  it("never overwrites an amount the user set by hand", () => {
    // Manual outranks anything derived (feature spec §33).
    const item = correct({
      stagedChanges: { amount: { original: -5207, staged: -5000, source: "manual" } },
    });
    expect(item.stagedChanges?.amount?.staged).toBe(-5000);
  });

  it("does not touch a row that is not a match", () => {
    expect(correct({ disposition: "unresolved" }).disposition).toBe("unresolved");
  });

  it("keeps other staged fields", () => {
    const item = correct({
      stagedChanges: { notes: { original: "a", staged: "b", source: "transform" } },
    });
    expect(item.stagedChanges?.notes?.staged).toBe("b");
    expect(item.stagedChanges?.amount?.staged).toBe(-5442);
  });
});

/*
 * The escape hatch that lets the automatic tiers stay strict.
 *
 * The reported pair: `Danube-D- JEDDAH SAU SAR53.45` posting -54.42, against
 * `#API Danube-D-8505` at -52.07. Text scores 0.667 against a floor of 0.75, so
 * no candidate is generated and both halves sit on screen unrelatable. Loosening
 * the floor admits false positives everywhere; discounting the store number
 * `8505` would undercut `referenceAppearsInNotes`, which treats a bank reference
 * inside the notes as near-identity evidence. Letting the user say so costs
 * nothing and admits nothing.
 */
describe("linking two rows by hand", () => {
  const danubeRow = row({ id: "s1", amount: -5442, importedPayee: "Danube-D- JEDDAH SAU SAR53.45" });
  const danubeTxn = txn({ id: "t1", amount: -5207, payeeName: null, notes: "#API Danube-D-8505" });

  const statementOnly: ReconciliationItem = {
    id: "i1",
    statementRowIds: ["s1"],
    actualTransactionIds: [],
    disposition: "unresolved",
    reasonCode: REASON.noActualCandidate,
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
  };
  const actualOnly: ReconciliationItem = {
    id: "i2",
    statementRowIds: [],
    actualTransactionIds: ["t1"],
    disposition: "unresolved",
    reasonCode: REASON.notOnStatement,
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
  };

  function link(items: ReconciliationItem[], transaction = danubeTxn, transfersReported = true) {
    return linkManually({
      items,
      statementItemId: "i1",
      actualItemId: "i2",
      statementRows: new Map([["s1", danubeRow]]),
      transactions: new Map([["t1", transaction]]),
      transfersReported,
    });
  }

  it("makes one row out of the two", () => {
    const next = link([statementOnly, actualOnly])!;

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "i1",
      statementRowIds: ["s1"],
      actualTransactionIds: ["t1"],
    });
  });

  it("records it as the user's own decision, not the matcher's", () => {
    const next = link([statementOnly, actualOnly])!;
    expect(next[0].match).toMatchObject({ type: "manual", evidenceSource: "manual" });
  });

  it("carries the statement's amount onto the transaction", () => {
    // Linking asserts "this row is that transaction", and the bank is
    // authoritative about what was charged.
    const next = link([statementOnly, actualOnly])!;
    expect(next[0].disposition).toBe("correct-amount");
    expect(next[0].stagedChanges?.amount).toEqual({
      original: -5207,
      staged: -5442,
      source: "manual",
    });
  });

  it("takes the transaction's guardrails, not the empty ones of a row with nothing in Actual", () => {
    const next = link([statementOnly, actualOnly], txn({ id: "t1", amount: -5207, reconciled: true }))!;
    expect(next[0].guards.protectedReconciled).toBe(true);
    // A protected row is linked but its amount is not rewritten.
    expect(next[0].stagedChanges?.amount).toBeUndefined();
  });

  it("reports an unknown transfer status as unknown", () => {
    const next = link([statementOnly, actualOnly], danubeTxn, false)!;
    expect(next[0].guards.transfer).toBe("unknown");
  });

  it("overrides decisions taken on either half", () => {
    // The row is no longer being created, and the transaction is no longer
    // being deleted.
    const next = link([
      { ...statementOnly, disposition: "create" },
      { ...actualOnly, disposition: "delete" },
    ])!;

    expect(next).toHaveLength(1);
    expect(next[0].disposition).toBe("correct-amount");
  });

  it("leaves every other row untouched", () => {
    const other = { ...actualOnly, id: "i3", actualTransactionIds: ["t9"] };
    const next = link([statementOnly, actualOnly, other])!;
    expect(next.map((entry) => entry.id)).toEqual(["i1", "i3"]);
  });

  it.each([
    ["two statement rows", { ...actualOnly, id: "i2", statementRowIds: ["s2"], actualTransactionIds: [] }],
    ["a row that is already matched", { ...actualOnly, id: "i2", statementRowIds: ["s2"] }],
  ])("refuses %s", (_label, second) => {
    // Defence in depth: the toolbar only offers the action for the one shape,
    // but the engine must not rely on the UI having behaved.
    expect(link([statementOnly, second as ReconciliationItem])).toBeNull();
  });
});

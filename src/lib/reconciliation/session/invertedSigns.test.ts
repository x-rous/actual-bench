import { diagnoseInvertedSigns, invertStatementRows } from "./invertedSigns";
import type { ActualTransactionSnapshot, StatementRow } from "../types";

let counter = 0;
beforeEach(() => {
  counter = 0;
});

function row(amount: number, postedDate = "2026-08-15"): StatementRow {
  const id = `s${++counter}`;
  return {
    id,
    sourceRowNumber: counter,
    postedDate,
    amount,
    importedPayee: `merchant ${id}`,
    raw: {},
    fingerprint: `fp-${id}`,
  };
}

function txn(amount: number, date = "2026-08-15"): ActualTransactionSnapshot {
  const id = `t${++counter}`;
  return {
    id,
    accountId: "acct-1",
    date,
    amount,
    payeeId: null,
    payeeName: null,
    importedPayee: null,
    categoryId: null,
    categoryName: null,
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
  };
}

describe("diagnoseInvertedSigns", () => {
  it("reports the flip when a whole statement is the wrong way round", () => {
    const rows = [row(18200), row(4500), row(990), row(12000)];
    const transactions = [txn(-18200), txn(-4500), txn(-990), txn(-12000)];

    expect(diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 0 })).toEqual({
      wouldMatch: 4,
      statementRows: 4,
    });
  });

  it("says nothing when matching already accounted for something", () => {
    const rows = [row(18200), row(4500)];
    const transactions = [txn(-18200), txn(-4500)];

    expect(
      diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 1 })
    ).toBeNull();
  });

  /**
   * The case the whole thing exists to stay quiet on: a statement of genuinely
   * new transactions also matches nothing, and flipping it would not help.
   */
  it("says nothing when zero matches are simply zero matches", () => {
    const rows = [row(-18200), row(-4500), row(-990)];
    const transactions = [txn(-333), txn(-777)];

    expect(
      diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 0 })
    ).toBeNull();
  });

  it("ignores a counterpart posted too far away to be the same transaction", () => {
    const rows = [row(18200, "2026-08-15"), row(4500, "2026-08-15")];
    const transactions = [txn(-18200, "2026-05-01"), txn(-4500, "2026-05-02")];

    expect(
      diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 0 })
    ).toBeNull();
  });

  it("does not count one transaction against several identical rows", () => {
    // Four identical charges, one transaction. Without one-to-one pairing this
    // would claim all four flip cleanly.
    const rows = [row(2500), row(2500), row(2500), row(2500)];
    const transactions = [txn(-2500)];

    expect(
      diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 0 })
    ).toBeNull();
  });

  it("counts each of several identical rows when each has its own transaction", () => {
    const rows = [row(2500), row(2500), row(2500)];
    const transactions = [txn(-2500), txn(-2500), txn(-2500)];

    expect(diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 0 })).toEqual({
      wouldMatch: 3,
      statementRows: 3,
    });
  });

  it("stays quiet when a long statement has only a couple of coincidences", () => {
    const rows = Array.from({ length: 40 }, (_, index) => row(1000 + index));
    const transactions = [txn(-1000), txn(-1001)];

    expect(
      diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 0 })
    ).toBeNull();
  });

  /*
   * Two rows a fortnight apart can both reach one middle-dated transaction. A
   * first-fit over unsorted lists lets the later row take it and strands the
   * earlier one, undercounting a statement that flips cleanly - which is how a
   * true diagnosis falls under the threshold and says nothing at all.
   */
  it("does not strand a row by handing its only partner to a later one", () => {
    // Rows deliberately out of date order: a fixture already sorted would pass
    // against the unsorted first-fit this exists to rule out.
    const rows = [row(2500, "2026-08-10"), row(2500, "2026-08-01")];
    const transactions = [txn(-2500, "2026-08-03"), txn(-2500, "2026-08-10")];

    // Taken in the given order, the 10th claims the 3rd (seven days, just in
    // range) and the 1st is left facing the 10th, nine days away.
    expect(diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 0 })).toEqual({
      wouldMatch: 2,
      statementRows: 2,
    });
  });

  it("prefers the earliest partner in range, whatever order the account is read in", () => {
    // The other half of the same rule, and it needs its own fixture: this one
    // is decided by the order of the transactions rather than of the rows.
    const rows = [row(2500, "2026-08-01"), row(2500, "2026-08-15")];
    const transactions = [txn(-2500, "2026-08-08"), txn(-2500, "2026-08-01")];

    // Unsorted, the 1st takes the 8th - the first it meets that is in range -
    // and the 15th is stranded against the 1st.
    expect(diagnoseInvertedSigns({ statementRows: rows, transactions, matched: 0 })).toEqual({
      wouldMatch: 2,
      statementRows: 2,
    });
  });

  it("has nothing to say about an empty side", () => {
    expect(
      diagnoseInvertedSigns({ statementRows: [], transactions: [txn(-100)], matched: 0 })
    ).toBeNull();
    expect(
      diagnoseInvertedSigns({ statementRows: [row(100)], transactions: [], matched: 0 })
    ).toBeNull();
  });
});

describe("invertStatementRows", () => {
  it("flips amounts and leaves everything the bank said alone", () => {
    const original = row(18200, "2026-08-15");
    const [flipped] = invertStatementRows([original]);

    expect(flipped.amount).toBe(-18200);
    expect(flipped).toEqual({ ...original, amount: -18200 });
    // The source rows are shared with the session; mutating them in place would
    // corrupt the very thing a failed re-match would need to fall back on.
    expect(original.amount).toBe(18200);
  });
});

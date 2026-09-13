import { DEFAULT_MATCH_CONFIG } from "../match/config";
import { buildTextCorpus } from "../match/text";
import { match } from "../match/matcher";
import { REASON } from "./build";
import { findPossiblePairs, wouldWrite } from "./possiblePairs";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "../types";

let counter = 0;
beforeEach(() => {
  counter = 0;
});

function row(importedPayee: string, amount: number, postedDate = "2026-08-15"): StatementRow {
  const id = `s${++counter}`;
  return { id, sourceRowNumber: counter, postedDate, amount, importedPayee, raw: {}, fingerprint: `fp-${id}` };
}

function txn(notes: string | null, amount: number, date = "2026-08-15"): ActualTransactionSnapshot {
  const id = `t${++counter}`;
  return {
    id, accountId: "acct-1", date, amount,
    payeeId: null, payeeName: null, importedPayee: null,
    categoryId: null, categoryName: null, notes,
    cleared: true, reconciled: false, importedId: null,
    transferId: null, scheduleId: null,
    isParent: false, isChild: false, parentId: null, splitLines: [],
  };
}

function statementItem(r: StatementRow, disposition: ReconciliationItem["disposition"] = "unresolved") {
  return {
    id: `i-${r.id}`,
    statementRowIds: [r.id],
    actualTransactionIds: [],
    disposition,
    reasonCode: REASON.noActualCandidate,
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" as const },
  };
}

function actualItem(t: ActualTransactionSnapshot, disposition: ReconciliationItem["disposition"] = "unresolved") {
  return {
    id: `i-${t.id}`,
    statementRowIds: [],
    actualTransactionIds: [t.id],
    disposition,
    reasonCode: REASON.notOnStatement,
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" as const },
  };
}

function find(items: ReconciliationItem[], rows: StatementRow[], txns: ActualTransactionSnapshot[]) {
  return findPossiblePairs({
    items,
    statementRows: new Map(rows.map((r) => [r.id, r])),
    transactions: new Map(txns.map((t) => [t.id, t])),
    text: DEFAULT_MATCH_CONFIG.text,
    needleFloor: DEFAULT_MATCH_CONFIG.needleFloor,
    corpus: buildTextCorpus(txns.map((t) => t.notes)),
  });
}

describe("finding a pair matching could not see", () => {
  /*
   * The regression this exists for, and the one that proves the floor is its
   * own. `Danube-D- JEDDAH SAU SAR53.45` against `#API Danube-D-8505` scores
   * 0.667 - below matching's 0.75, so no candidate was ever generated and both
   * halves sit on screen unrelated.
   */
  it("catches the pair matching's own floor rejects", () => {
    const r = row("Danube-D- JEDDAH SAU SAR53.45", -5442);
    const t = txn("#API Danube-D-8505", -5207);
    const pairs = find([statementItem(r), actualItem(t)], [r], [t]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ amountDifference: 235, dayGap: 0 });
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(0.5);
    expect(pairs[0].similarity).toBeLessThan(0.75);
  });

  it("finds it before either side has been decided", () => {
    /*
     * The point of reading items rather than operations. The operation-based
     * version could only speak once a create *and* a delete were both staged -
     * so it asked the user to unwind two decisions instead of never making
     * them.
     */
    const r = row("Danube-D- JEDDAH SAU SAR53.45", -5442);
    const t = txn("#API Danube-D-8505", -5207);
    const items = [statementItem(r, "unresolved"), actualItem(t, "unresolved")];

    expect(find(items, [r], [t])).toHaveLength(1);
  });

  it("finds a row being created whose duplicate nobody is deleting", () => {
    // Invisible to the operation-based version: same duplication, but no delete
    // operation to pair the create with.
    const r = row("Danube-D- JEDDAH SAU SAR53.45", -5442);
    const t = txn("#API Danube-D-8505", -5207);
    const items = [statementItem(r, "create"), actualItem(t, "keep")];

    expect(find(items, [r], [t])).toHaveLength(1);
  });

  it("still catches a pair whose amounts are wildly apart", () => {
    // "The recorded amount is wrong" is one of the reasons a pairing was
    // missed, so an amount condition would exclude the case being looked for.
    const r = row("Jeeny Jeddah SAU SAR48.84", -4973);
    const t = txn("#API Jeeny", -165);
    const pairs = find([statementItem(r), actualItem(t)], [r], [t]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].amountDifference).toBe(4808);
  });

  it("offers nothing for unrelated rows on the same day", () => {
    const r = row("SPARKYS TAIF", -2000);
    const t = txn("#API DUBAI TAXI CORPORATION", -2000);
    expect(find([statementItem(r), actualItem(t)], [r], [t])).toEqual([]);
  });

  it("will not pair an outflow with an inflow", () => {
    // A refund is not the transaction it refunds, however alike the text.
    const r = row("Noon Riyadh SAU SAR38.15", -3884);
    const t = txn("#API Noon Riyadh", 3884);
    expect(find([statementItem(r), actualItem(t)], [r], [t])).toEqual([]);
  });

  it("will not pair rows a fortnight apart", () => {
    const r = row("Danube-D- JEDDAH SAU SAR53.45", -5442, "2026-08-01");
    const t = txn("#API Danube-D-8505", -5207, "2026-08-25");
    expect(find([statementItem(r), actualItem(t)], [r], [t])).toEqual([]);
  });

  it("ignores a row that already has a transaction", () => {
    // Matched rows are not in the pool at all: the question is settled.
    const r = row("Danube-D- JEDDAH SAU SAR53.45", -5442);
    const t = txn("#API Danube-D-8505", -5207);
    const matched: ReconciliationItem = {
      id: "i-matched",
      statementRowIds: [r.id],
      actualTransactionIds: [t.id],
      disposition: "matched",
      guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    };

    expect(find([matched], [r], [t])).toEqual([]);
  });

  it("reports one uncertainty, not three, when several rows share a merchant", () => {
    const rows = [
      row("Jeeny Jeddah SAU SAR14.29", -1455),
      row("Jeeny Jeddah SAU SAR15.67", -1596),
      row("Jeeny Jeddah SAU SAR13.63", -1388),
    ];
    const t = txn("#API Jeeny", -1535);
    const pairs = find([...rows.map((r) => statementItem(r)), actualItem(t)], rows, [t]);

    expect(pairs).toHaveLength(1);
  });

  it("offers both pairs when one row's best choice would strand another", () => {
    /*
     * The crossed case, and the reason this is a maximum matching rather than a
     * greedy one. Measured edges:
     *
     *   Noon Minutes -> "#API Noon Minutes DUBAI ARE"   1.000
     *   Noon Minutes -> "#API Noon Minutes Express"     0.667
     *   Noon Food    -> "#API Noon Minutes DUBAI ARE"   0.750
     *   Noon Food    -> "#API Noon Minutes Express"     0.333  (below the floor)
     *
     * Taking the strongest pair first claims the first transaction for
     * `Noon Minutes` and strands `Noon Food` - one of two real pairings never
     * offered, which for a safety net is the failure that matters.
     */
    const rows = [row("Noon Minutes DUBAI ARE", -4730), row("Noon Food DUBAI ARE", -3850)];
    const txns = [txn("#API Noon Minutes DUBAI ARE", -4500), txn("#API Noon Minutes Express", -4000)];
    const pairs = find(
      [...rows.map((r) => statementItem(r)), ...txns.map((t) => actualItem(t))],
      rows,
      txns
    );

    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.map((p) => p.statementItemId)).size).toBe(2);
    expect(new Set(pairs.map((p) => p.actualItemId)).size).toBe(2);
  });

  it("refuses a needle too generic to mean anything", () => {
    // `FEE` would otherwise resemble a large share of an account's notes, which
    // is what the needle floor exists to prevent - kept from matching because it
    // says what counts as evidence, not how much is required.
    const r = row("FEE", -100);
    const txns = Array.from({ length: 12 }, (_, i) => txn(`FEE charged ${i}`, -100));
    const pairs = find([statementItem(r), ...txns.map((t) => actualItem(t))], [r], txns);

    expect(pairs).toEqual([]);
  });
});

/*
 * On the workbench every possible pair is worth seeing. At the gate into Review
 * only the ones that would put something in the budget should stop anyone -
 * interrupting for a pair that writes nothing teaches the user to click past
 * the interruption.
 */
describe("which pairs are worth stopping for", () => {
  const pair = {
    statementItemId: "i-s",
    actualItemId: "i-t",
    similarity: 0.8,
    amountDifference: 100,
    dayGap: 0,
  };

  function items(statement: ReconciliationItem["disposition"], actual: ReconciliationItem["disposition"]) {
    return new Map<string, ReconciliationItem>([
      ["i-s", { id: "i-s", statementRowIds: ["s"], actualTransactionIds: [], disposition: statement,
        guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }],
      ["i-t", { id: "i-t", statementRowIds: [], actualTransactionIds: ["t"], disposition: actual,
        guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }],
    ]);
  }

  it.each([
    ["a row being created", "create" as const, "unresolved" as const],
    ["a transaction being deleted", "unresolved" as const, "delete" as const],
    ["both", "create" as const, "delete" as const],
  ])("stops for %s", (_label, statement, actual) => {
    expect(wouldWrite(pair, items(statement, actual))).toBe(true);
  });

  it("does not stop for a pair nobody has decided", () => {
    expect(wouldWrite(pair, items("unresolved", "unresolved"))).toBe(false);
  });

  it("does not stop for a pair explicitly left alone", () => {
    expect(wouldWrite(pair, items("ignored", "keep"))).toBe(false);
  });
});

/*
 * The scope line, asserted rather than asserted-in-prose.
 *
 * This surfaces pairs below matching's floors, which is the thing F-151i was
 * closed for refusing to do. It is only defensible if matching itself is
 * untouched — so this pins the two together: the matcher must still find
 * nothing here, and the looser search must still find the pair.
 */
describe("matching is not loosened by any of this", () => {
  it("finds a pair the matcher itself still refuses", () => {
    const r = row("Danube-D- JEDDAH SAU SAR53.45", -5442);
    const t = txn("#API Danube-D-8505", -5207);

    const graph = match({
      statementRows: [r],
      actualTransactions: [t],
      config: DEFAULT_MATCH_CONFIG,
    });

    // The matcher's verdict is unchanged: no match, and no candidate offered.
    expect(graph.matched).toEqual([]);
    expect(graph.ambiguous).toEqual([]);
    expect(graph.unmatchedStatementRowIds).toEqual([r.id]);
    expect(graph.unmatchedActualTransactionIds).toEqual([t.id]);

    // And the looser search, which only ever offers, sees it.
    expect(find([statementItem(r), actualItem(t)], [r], [t])).toHaveLength(1);
  });
});

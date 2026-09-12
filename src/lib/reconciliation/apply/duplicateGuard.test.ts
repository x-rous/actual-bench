import { DEFAULT_MATCH_CONFIG } from "../match/config";
import { buildTextCorpus } from "../match/text";
import { findSuspectedDuplicates } from "./duplicateGuard";
import type { ApplyOperation, ApplyPlan } from "./operations";
import type { ActualTransactionSnapshot } from "../types";

function planOf(operations: ApplyOperation[]): ApplyPlan {
  return { operations, alreadyApplied: 0, noWriteMatches: 0, unresolved: 0, blocked: [] };
}

function create(
  id: string,
  amount: number,
  importedPayee: string,
  date = "2026-08-15"
): ApplyOperation {
  return {
    id: `create:${id}`,
    kind: "create",
    itemId: id,
    statementRowId: `s-${id}`,
    accountId: "acct-1",
    date,
    amount,
    payeeId: null,
    payeeName: null,
    importedPayee,
    categoryId: null,
    notes: null,
    cleared: false,
    marker: `recon:${id}`,
  };
}

function remove(id: string, amount: number, date = "2026-08-15"): ApplyOperation {
  return {
    id: `delete:${id}`,
    kind: "delete",
    itemId: id,
    transactionId: `t-${id}`,
    accountId: "acct-1",
    date,
    amount,
  };
}

function txn(
  id: string,
  amount: number,
  notes: string | null,
  date = "2026-08-15"
): ActualTransactionSnapshot {
  return {
    id: `t-${id}`,
    accountId: "acct-1",
    date,
    amount,
    payeeId: null,
    payeeName: null,
    importedPayee: null,
    categoryId: null,
    categoryName: null,
    notes,
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

function guard(operations: ApplyOperation[], snapshots: ActualTransactionSnapshot[]) {
  return findSuspectedDuplicates({
    plan: planOf(operations),
    transactions: new Map(snapshots.map((t) => [t.id, t])),
    text: DEFAULT_MATCH_CONFIG.text,
    needleFloor: DEFAULT_MATCH_CONFIG.needleFloor,
    corpus: buildTextCorpus(snapshots.map((t) => t.notes)),
  });
}

describe("creating a duplicate while deleting its original", () => {
  /*
   * The regression the guard exists for, and the one that proves its floors are
   * its own. `Danube-D- JEDDAH SAU SAR53.45` against a note of `#API
   * Danube-D-8505` scores 0.667 - below the matcher's 0.75, so no candidate was
   * ever generated, and both halves sit on screen unrelated. Reusing the
   * matcher's floor here would reject it a second time and catch nothing.
   */
  it("catches the pair the matcher's own floor rejects", () => {
    const pairs = guard(
      [create("danube", -5442, "Danube-D- JEDDAH SAU SAR53.45"), remove("danube", -5207)],
      [txn("danube", -5207, "#API Danube-D-8505")]
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      createOperationId: "create:danube",
      deleteOperationId: "delete:danube",
      amountDifference: 235,
      dayGap: 0,
    });
    // Below the matcher's floor, above the guard's.
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(0.5);
    expect(pairs[0].similarity).toBeLessThan(0.75);
  });

  it("still catches a pair whose amounts are wildly apart", () => {
    // "The recorded amount is wrong" is one of the reasons a pairing was missed,
    // so an amount condition would exclude the case being looked for.
    const pairs = guard(
      [create("jeeny", -4973, "Jeeny Jeddah SAU SAR48.84"), remove("jeeny", -165)],
      [txn("jeeny", -165, "#API Jeeny")]
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].amountDifference).toBe(4808);
  });

  it("reports nothing for unrelated rows on the same day", () => {
    const pairs = guard(
      [create("a", -2000, "SPARKYS TAIF"), remove("b", -2000)],
      [txn("b", -2000, "#API DUBAI TAXI CORPORATION")]
    );

    expect(pairs).toEqual([]);
  });

  it("will not pair an outflow with an inflow", () => {
    // A refund is not the transaction it refunds, however alike the text.
    const pairs = guard(
      [create("noon", -3884, "Noon Riyadh SAU SAR38.15"), remove("noon", 3884)],
      [txn("noon", 3884, "#API Noon Riyadh")]
    );

    expect(pairs).toEqual([]);
  });

  it("will not pair rows a fortnight apart", () => {
    const pairs = guard(
      [create("far", -5442, "Danube-D- JEDDAH SAU SAR53.45", "2026-08-01"),
       remove("far", -5207, "2026-08-25")],
      [txn("far", -5207, "#API Danube-D-8505", "2026-08-25")]
    );

    expect(pairs).toEqual([]);
  });

  it("reports one uncertainty, not three, when several rows share a merchant", () => {
    /*
     * Three rows being created for one merchant all resemble the single row
     * being deleted. Reporting every combination would read as three problems
     * rather than one question about which row that transaction belongs to.
     */
    const pairs = guard(
      [
        create("j1", -1455, "Jeeny Jeddah SAU SAR14.29"),
        create("j2", -1596, "Jeeny Jeddah SAU SAR15.67"),
        create("j3", -1388, "Jeeny Jeddah SAU SAR13.63"),
        remove("j", -1535),
      ],
      [txn("j", -1535, "#API Jeeny")]
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].deleteOperationId).toBe("delete:j");
  });

  it("reports both pairs when one row's best choice would strand another", () => {
    /*
     * The crossed case, and the reason this is a maximum matching rather than a
     * greedy one. The measured edges here are:
     *
     *   Noon Minutes -> "#API Noon Minutes DUBAI ARE"   1.000
     *   Noon Minutes -> "#API Noon Minutes Express"     0.667
     *   Noon Food    -> "#API Noon Minutes DUBAI ARE"   0.750
     *   Noon Food    -> "#API Noon Minutes Express"     0.333  (below the floor)
     *
     * Taking the strongest pair first claims the first transaction for
     * `Noon Minutes`; `Noon Food` then has nowhere to go and the second
     * transaction is never paired - one of two real warnings lost, which for a
     * guard is the failure that matters. Pairing for count first finds both.
     */
    const pairs = guard(
      [
        create("minutes", -4730, "Noon Minutes DUBAI ARE"),
        create("food", -3850, "Noon Food DUBAI ARE"),
        remove("full", -4500),
        remove("express", -4000),
      ],
      [
        txn("full", -4500, "#API Noon Minutes DUBAI ARE"),
        txn("express", -4000, "#API Noon Minutes Express"),
      ]
    );

    expect(pairs).toHaveLength(2);
    // Each operation used once, and every row warned about.
    expect(new Set(pairs.map((pair) => pair.createOperationId)).size).toBe(2);
    expect(new Set(pairs.map((pair) => pair.deleteOperationId)).size).toBe(2);
  });

  it("says nothing when the plan has no deletes", () => {
    expect(guard([create("a", -1000, "SPARKYS TAIF")], [])).toEqual([]);
  });

  it("refuses a needle too generic to mean anything", () => {
    // `FEE` would otherwise resemble a large share of an account's notes, which
    // is what the needle floor exists to prevent - kept from the matcher because
    // it encodes what counts as evidence, not how much is required.
    const snapshots = Array.from({ length: 12 }, (_, i) =>
      txn(`x${i}`, -100, `FEE charged ${i}`)
    );
    const pairs = guard(
      [create("fee", -100, "FEE"), remove("x0", -100)],
      snapshots
    );

    expect(pairs).toEqual([]);
  });
});

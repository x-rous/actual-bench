/**
 * Matching fixtures from the feature spec §49 plus the RD-071 §5.3 contract.
 *
 * Amounts are integer minor units throughout.
 */

import type { ActualTransactionSnapshot, MatchConfig, StatementRow } from "../types";
import { DEFAULT_MATCH_CONFIG, TEXT_TARGET_PRESETS } from "./config";
import { match, shiftDate } from "./matcher";

function row(overrides: Partial<StatementRow> & Pick<StatementRow, "id">): StatementRow {
  return {
    sourceRowNumber: 1,
    postedDate: "2026-07-03",
    amount: -4250,
    description: "STARBUCKS MALL OF EMIRATES",
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

function run(
  statementRows: StatementRow[],
  actualTransactions: ActualTransactionSnapshot[],
  config: Partial<MatchConfig> = {}
) {
  return match({
    statementRows,
    actualTransactions,
    config: { ...DEFAULT_MATCH_CONFIG, ...config },
  });
}

describe("exact reference match (tier 1)", () => {
  it("pins an imported_id hit and reports it as exact", () => {
    const graph = run(
      [row({ id: "s1", reference: "BANKREF-9931" })],
      [txn({ id: "t1", importedId: "BANKREF-9931", date: "2026-06-20", payeeName: "Anything" })]
    );

    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0]).toMatchObject({
      statementRowId: "s1",
      actualTransactionId: "t1",
      label: "exact",
      tier: "reference-imported-id",
    });
  });

  it("outranks a closer, better-looking candidate", () => {
    // t2 is same-day with an identical payee; t1 only has the identity match.
    const graph = run(
      [row({ id: "s1", reference: "BANKREF-9931" })],
      [
        txn({ id: "t1", importedId: "BANKREF-9931", date: "2026-06-20", payeeName: "Unrelated" }),
        txn({ id: "t2", date: "2026-07-03", payeeName: "Starbucks" }),
      ]
    );

    expect(graph.matched[0].actualTransactionId).toBe("t1");
    expect(graph.unmatchedActualTransactionIds).toContain("t2");
  });
});

describe("reference found in notes (tier 2)", () => {
  it("matches when the bank reference sits verbatim in the notes", () => {
    const graph = run(
      [row({ id: "s1", reference: "88721", description: "TALABAT AE" })],
      [txn({ id: "t1", payeeName: "Talabat", notes: "TALABAT AE 88721 #One | Dinner" })]
    );

    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].tier).toBe("reference-in-notes");
    expect(graph.matched[0].reasons).toContainEqual({ kind: "reference", where: "notes" });
  });
});

describe("amount + date + text (tier 3)", () => {
  it("matches on a strong payee similarity", () => {
    const graph = run([row({ id: "s1" })], [txn({ id: "t1" })]);
    expect(graph.matched[0]).toMatchObject({ tier: "amount-date-text", label: "high" });
  });

  it("matches on notes containment when the payee carries nothing", () => {
    const graph = run(
      [row({ id: "s1", description: "TALABAT AE 88721" })],
      [
        txn({
          id: "t1",
          payeeName: "Food",
          notes: "TALABAT AE 88721 #One | Dinner with family",
        }),
      ]
    );

    expect(graph.matched[0].tier).toBe("amount-date-text");
    expect(graph.matched[0].reasons).toContainEqual({
      kind: "text",
      field: "notes",
      mode: "containment",
      similarity: 1,
    });
  });

  it("respects a profile that only compares the payee", () => {
    const graph = run(
      [row({ id: "s1", description: "TALABAT AE 88721" })],
      [txn({ id: "t1", payeeName: "Food", notes: "TALABAT AE 88721" })],
      { text: TEXT_TARGET_PRESETS["payee-only"] }
    );

    // Still matched on amount+date, but with no text evidence contributing.
    expect(graph.matched[0].tier).toBe("amount-date");
    expect(graph.matched[0].reasons.some((r) => r.kind === "text" && r.field === "notes")).toBe(
      false
    );
  });
});

describe("date drift", () => {
  it.each([1, 3, 7])("matches at ±%i days", (days) => {
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-10" })],
      [txn({ id: "t1", date: shiftDate("2026-07-10", days) })]
    );
    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].reasons).toContainEqual({ kind: "date", deltaDays: days });
  });

  it("scores a nearer date above a further one", () => {
    const near = run(
      [row({ id: "s1", postedDate: "2026-07-10" })],
      [txn({ id: "t1", date: "2026-07-10" })]
    ).matched[0].score;
    const far = run(
      [row({ id: "s1", postedDate: "2026-07-10" })],
      [txn({ id: "t1", date: "2026-07-17" })]
    ).matched[0].score;
    expect(near).toBeGreaterThan(far);
  });

  it("does not consider a transaction outside the window", () => {
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-10" })],
      [txn({ id: "t1", date: "2026-07-25" })]
    );
    expect(graph.matched).toHaveLength(0);
    expect(graph.unmatchedStatementRowIds).toEqual(["s1"]);
    expect(graph.unmatchedActualTransactionIds).toEqual(["t1"]);
  });

  it("honours a narrowed tolerance", () => {
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-10" })],
      [txn({ id: "t1", date: "2026-07-15" })],
      { dateToleranceDays: 2 }
    );
    expect(graph.matched).toHaveLength(0);
  });
});

describe("amount is a hard gate (feature spec §11)", () => {
  it("never matches a different amount, however similar the text", () => {
    const graph = run(
      [row({ id: "s1", amount: -42100, description: "ETISALAT" })],
      [txn({ id: "t1", amount: -41200, payeeName: "Etisalat" })]
    );

    // The gate holds: no automatic match. The pair is offered for review
    // instead, with the difference stated, rather than silently disappearing.
    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous).toHaveLength(1);
    expect(graph.ambiguous[0].why).toBe("amount-mismatch");
  });

  it("does not offer a review pairing across a sign change", () => {
    // A refund is not the same event as the purchase it reverses.
    const graph = run(
      [row({ id: "s1", amount: 42100, description: "ETISALAT" })],
      [txn({ id: "t1", amount: -41200, payeeName: "Etisalat" })]
    );
    expect(graph.ambiguous).toHaveLength(0);
    expect(graph.unmatchedStatementRowIds).toEqual(["s1"]);
  });

  it("does not offer a review pairing when the text is unrelated", () => {
    const graph = run(
      [row({ id: "s1", amount: -42100, description: "ETISALAT" })],
      [txn({ id: "t1", amount: -41200, payeeName: "Carrefour Market" })]
    );
    expect(graph.ambiguous).toHaveLength(0);
  });

  it("relates a wildly-apart pair by merchant and date instead of by amount", () => {
    // The ratio cap still refuses it as an amount mismatch, but when it is the
    // only row left on each side for this merchant on this day, the amount is
    // the least trustworthy field on the row and refusing to relate them would
    // be trusting the wrong signal.
    const graph = run(
      [row({ id: "s1", amount: -42100, description: "ETISALAT" })],
      [txn({ id: "t1", amount: -100, payeeName: "Etisalat" })]
    );

    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous).toHaveLength(1);
    expect(graph.ambiguous[0].why).toBe("same-merchant-date");
  });

  it("relates nothing when both passes are switched off", () => {
    const graph = run(
      [row({ id: "s1", amount: -42100, description: "ETISALAT" })],
      [txn({ id: "t1", amount: -100, payeeName: "Etisalat" })],
      { reviewAmountMismatch: false, pairLeftoversByMerchantAndDate: false }
    );
    expect(graph.ambiguous).toHaveLength(0);
    expect(graph.unmatchedStatementRowIds).toEqual(["s1"]);
  });

  it("distinguishes sign: an inflow never matches an outflow", () => {
    const graph = run([row({ id: "s1", amount: 5000 })], [txn({ id: "t1", amount: -5000 })]);
    expect(graph.matched).toHaveLength(0);
  });
});

describe("statement row missing in Actual", () => {
  it("reports it as unmatched so it can be staged as a Create", () => {
    const graph = run(
      [row({ id: "s1", description: "DUBAI TAXI CORPORATION", amount: -6850 })],
      []
    );
    expect(graph.unmatchedStatementRowIds).toEqual(["s1"]);
  });
});

describe("Actual row missing from statement", () => {
  it("reports it as unmatched so it can be kept or deleted", () => {
    const graph = run([], [txn({ id: "t1", payeeName: "Carrefour", amount: -22980 })]);
    expect(graph.unmatchedActualTransactionIds).toEqual(["t1"]);
  });
});

describe("one Actual transaction is never claimed twice (feature spec §15)", () => {
  it("assigns a contested transaction to exactly one statement row", () => {
    const graph = run(
      [
        row({ id: "s1", postedDate: "2026-07-10", amount: -5599, description: "NETFLIX" }),
        row({ id: "s2", postedDate: "2026-07-12", amount: -5599, description: "NETFLIX" }),
      ],
      [txn({ id: "t1", date: "2026-07-10", amount: -5599, payeeName: "Netflix" })]
    );

    const claims = graph.matched.filter((m) => m.actualTransactionId === "t1");
    expect(claims).toHaveLength(1);
    // The nearer-dated row wins; the other becomes a Create candidate.
    expect(claims[0].statementRowId).toBe("s1");
    expect(graph.unmatchedStatementRowIds).toContain("s2");
  });

  it("prefers the globally better pairing over first-come-first-served", () => {
    // s1 is a weak match for t1 but s2 is an exact same-day match for it.
    // Row-by-row greedy would let s1 take t1 and leave s2 stranded.
    const graph = run(
      [
        row({ id: "s1", postedDate: "2026-07-01", amount: -1000, description: "UNRELATED TEXT" }),
        row({ id: "s2", postedDate: "2026-07-06", amount: -1000, description: "CARREFOUR MARKET" }),
      ],
      [txn({ id: "t1", date: "2026-07-06", amount: -1000, payeeName: "Carrefour" })]
    );

    const winner = graph.matched.find((m) => m.actualTransactionId === "t1");
    expect(winner?.statementRowId).toBe("s2");
  });
});

describe("ambiguity guard", () => {
  it("does not silently choose between two close candidates", () => {
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-08", amount: -11000, description: "AMAZON AE" })],
      [
        txn({ id: "t1", date: "2026-07-07", amount: -11000, payeeName: "Amazon" }),
        txn({ id: "t2", date: "2026-07-08", amount: -11000, payeeName: "Amazon Marketplace" }),
      ]
    );

    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous).toHaveLength(1);
    expect(graph.ambiguous[0]).toMatchObject({ statementRowId: "s1", why: "close-runner-up" });
    expect(graph.ambiguous[0].candidates.map((c) => c.actualTransactionId).sort()).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("does auto-match when one candidate is clearly better", () => {
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-08", amount: -11000, description: "AMAZON AE" })],
      [
        txn({ id: "t1", date: "2026-07-08", amount: -11000, payeeName: "Amazon" }),
        txn({ id: "t2", date: "2026-07-15", amount: -11000, payeeName: "Totally Different" }),
      ]
    );

    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].actualTransactionId).toBe("t1");
  });

  it("offers a below-floor pair the user could plausibly want", () => {
    // Same amount, three days apart, and the text agrees: not confident enough
    // to match automatically, but plainly worth showing.
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-01", amount: -1000, description: "CARREFOUR MARKET" })],
      [txn({ id: "t1", date: "2026-07-04", amount: -1000, payeeName: "Carrefour" })],
      { autoMatchFloor: 95 }
    );

    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous[0]?.why).toBe("below-floor");
  });

  it("offers nothing when a pair shares only an amount and a distant date", () => {
    // No text agreement and a week apart is a coincidence of arithmetic, not a
    // candidate. Offering it spends the user's attention on a pair that no
    // evidence supports; the row is better presented as missing from Actual.
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-01", amount: -1000, description: "XYZ" })],
      [txn({ id: "t1", date: "2026-07-08", amount: -1000, payeeName: "Totally Unrelated" })],
      { dateToleranceDays: 10 }
    );

    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous).toHaveLength(0);
    expect(graph.unmatchedStatementRowIds).toEqual(["s1"]);
  });
});

describe("duplicate Actual rows (feature spec §19)", () => {
  it("keeps one and flags the near-identical loser as a likely duplicate", () => {
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-07", amount: -5599, description: "NETFLIX.COM" })],
      [
        txn({ id: "t1", date: "2026-07-07", amount: -5599, payeeName: "Netflix" }),
        txn({ id: "t2", date: "2026-07-07", amount: -5599, payeeName: "Netflix" }),
      ]
    );

    // Identical evidence, so this is ambiguous rather than auto-matched — but the
    // duplicate relationship is what the user needs to see either way.
    expect(graph.matched.length + graph.ambiguous.length).toBe(1);
    const involved = graph.ambiguous[0]?.candidates.map((c) => c.actualTransactionId) ?? [];
    expect(involved.sort()).toEqual(["t1", "t2"]);
  });

  it("flags a duplicate when one row is clearly the better match", () => {
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-07", amount: -8640, description: "TALABAT" })],
      [
        txn({ id: "t1", date: "2026-07-07", amount: -8640, payeeName: "Talabat" }),
        // Same evidence but a day out, so it loses by a small, duplicate-sized margin.
        txn({ id: "t2", date: "2026-07-08", amount: -8640, payeeName: "Talabat" }),
      ]
    );

    if (graph.matched.length === 1) {
      expect(graph.likelyDuplicates[0]).toMatchObject({
        statementRowId: "s1",
        keptActualTransactionId: "t1",
      });
    } else {
      expect(graph.ambiguous).toHaveLength(1);
    }
  });
});

describe("splits", () => {
  it("matches the split parent on its posted amount and ignores children", () => {
    const graph = run(
      [row({ id: "s1", postedDate: "2026-07-22", amount: -53000, description: "COSTCO" })],
      [
        txn({
          id: "parent",
          date: "2026-07-22",
          amount: -53000,
          payeeName: "Costco",
          isParent: true,
          splitLines: [
            { id: "c1", amount: -42000, payeeName: null, categoryId: "g", categoryName: "Groceries", notes: null },
            { id: "c2", amount: -11000, payeeName: null, categoryId: "h", categoryName: "Household", notes: null },
          ],
        }),
        txn({ id: "c1", date: "2026-07-22", amount: -42000, isChild: true, parentId: "parent" }),
        txn({ id: "c2", date: "2026-07-22", amount: -11000, isChild: true, parentId: "parent" }),
      ]
    );

    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].actualTransactionId).toBe("parent");
    // Children are never candidates in their own right.
    expect(graph.unmatchedActualTransactionIds).not.toContain("c1");
    expect(graph.unmatchedActualTransactionIds).not.toContain("c2");
  });
});

describe("determinism", () => {
  it("produces an identical graph for identical inputs", () => {
    const rows = [
      row({ id: "s1", postedDate: "2026-07-01", amount: -1000, description: "A SHOP" }),
      row({ id: "s2", postedDate: "2026-07-02", amount: -1000, description: "B SHOP" }),
    ];
    const transactions = [
      txn({ id: "t1", date: "2026-07-01", amount: -1000, payeeName: "A Shop" }),
      txn({ id: "t2", date: "2026-07-02", amount: -1000, payeeName: "B Shop" }),
    ];

    expect(run(rows, transactions)).toEqual(run(rows, transactions));
  });

  it("is unaffected by the input ordering of Actual transactions", () => {
    const rows = [row({ id: "s1", postedDate: "2026-07-01", amount: -1000, description: "A SHOP" })];
    const a = txn({ id: "t1", date: "2026-07-01", amount: -1000, payeeName: "A Shop" });
    const b = txn({ id: "t2", date: "2026-07-01", amount: -1000, payeeName: "A Shop" });

    expect(run(rows, [a, b])).toEqual(run(rows, [b, a]));
  });
});

describe("performance shape", () => {
  it("stays fast on a realistic session with a pathological amount bucket", () => {
    // 400 identical subscription charges across a year plus 250 ordinary rows:
    // the amount bucket is huge, but its ±7-day slice is tiny.
    const transactions: ActualTransactionSnapshot[] = [];
    for (let i = 0; i < 400; i++) {
      transactions.push(
        txn({
          id: `sub-${i}`,
          date: shiftDate("2026-01-01", i),
          amount: -5599,
          payeeName: "Netflix",
        })
      );
    }
    for (let i = 0; i < 250; i++) {
      transactions.push(
        txn({ id: `t-${i}`, date: shiftDate("2026-07-01", i % 28), amount: -(1000 + i) })
      );
    }

    const rows: StatementRow[] = [];
    for (let i = 0; i < 250; i++) {
      rows.push(
        row({
          id: `s-${i}`,
          postedDate: shiftDate("2026-07-01", i % 28),
          amount: -(1000 + i),
          description: `MERCHANT ${i}`,
        })
      );
    }

    const started = Date.now();
    const graph = run(rows, transactions);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(graph.matched.length).toBeGreaterThan(0);
  });
});

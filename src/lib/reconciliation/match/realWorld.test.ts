/**
 * Regression fixtures taken from a real credit-card reconciliation that matched
 * 0 of 219 rows before these defects were fixed (RD-071, 2026-08-10).
 *
 * Each case here is a shape that occurs in genuine bank/automation data and that
 * the first implementation got wrong. They are deliberately concrete: the value
 * of a fixture like this is that it fails loudly if a scoring tweak regresses it.
 */

import { DEFAULT_MATCH_CONFIG, TEXT_TARGET_PRESETS } from "./config";
import { match } from "./matcher";
import { parseStatementText } from "../statement/parse";
import { REASON, buildReconciliationItems } from "../session/build";
import {
  detectDelimitedConfig,
  extractOriginalAmount,
  normalizeStatement,
} from "../statement/normalize";
import type { ActualTransactionSnapshot, StatementRow } from "../types";

function txn(
  overrides: Partial<ActualTransactionSnapshot> & Pick<ActualTransactionSnapshot, "id">
): ActualTransactionSnapshot {
  return {
    accountId: "acct-1",
    date: "2026-07-07",
    amount: -14137,
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
    ...overrides,
  };
}

function parse(text: string): StatementRow[] {
  const table = parseStatementText(text);
  let counter = 0;
  return normalizeStatement(table, detectDelimitedConfig(table), () => `s${++counter}`).rows;
}

describe("debit/credit statements (the 0% defect)", () => {
  // The bank exports Date/Description/Debit/Credit, with spend as a positive
  // number in Debit. Mapping Debit as a signed amount produces +141.37 for money
  // that left the account. Since automatic matching requires the exact *signed*
  // amount, every row then fails — 0 of 219 matched.
  const STATEMENT = [
    "Date\tDescription\tDebit\tCredit",
    "07/07/2026\tADNOC AL CORNICHE 933 ABUDHABI UAE\t141.37\t0",
    "20/07/2026\tCASHBACK RECEIVED\t0\t342.00",
  ].join("\n");

  it("detects a debit/credit layout from its headers", () => {
    const mapping = detectDelimitedConfig(parseStatementText(STATEMENT));
    expect(mapping.signConvention).toBe("debit-credit");
    expect(mapping.columns.debit).toBe(2);
    expect(mapping.columns.credit).toBe(3);
  });

  it("signs debits negative and credits positive", () => {
    const rows = parse(STATEMENT);
    expect(rows.map((row) => row.amount)).toEqual([-14137, 34200]);
  });

  it("detects the layout without usable headers, from the data shape", () => {
    // Two numeric columns where each row fills exactly one of them.
    const mapping = detectDelimitedConfig(
      parseStatementText(
        [
          "07/07/2026\tADNOC AL CORNICHE 933\t141.37\t0",
          "08/07/2026\tDU Apple Pay DUBAI ARE\t350.20\t0",
          "20/07/2026\tCASHBACK RECEIVED\t0\t342.00",
        ].join("\n")
      )
    );
    expect(mapping.signConvention).toBe("debit-credit");
  });

  it("still reads a genuinely signed single-amount statement", () => {
    const mapping = detectDelimitedConfig(
      parseStatementText(
        ["Date,Description,Amount", "2026-07-01,CARREFOUR,-342.85", "2026-07-03,REFUND,50.00"].join(
          "\n"
        )
      )
    );
    expect(mapping.signConvention).toBe("signed");
    expect(mapping.columns.amount).toBe(2);
  });

  it("matches once the layout is read correctly", () => {
    const rows = parse(STATEMENT);
    const graph = match({
      statementRows: rows,
      actualTransactions: [
        txn({ id: "t1", notes: "#API ADNOC AL CORNICHE 933", payeeName: "ADNOC Fuel Station" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].actualTransactionId).toBe("t1");
  });
});

describe("notes shorter than the statement text", () => {
  // Automation captures a truncated merchant name; the statement adds location
  // and country tokens. A one-directional containment test scored this 0.67 and
  // lost the text evidence entirely.
  it("treats a truncated note as a full text match", () => {
    const rows = parse(
      ["Date\tDescription\tDebit\tCredit", "07/07/2026\tADNOC AL CORNICHE 933 ABUDHABI UAE\t141.37\t0"].join(
        "\n"
      )
    );

    const graph = match({
      statementRows: rows,
      actualTransactions: [txn({ id: "t1", notes: "#API ADNOC AL CORNICHE 933" })],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched[0].reasons).toContainEqual({
      kind: "text",
      field: "notes",
      mode: "containment",
      similarity: 1,
    });
    expect(graph.matched[0].label).toBe("high");
  });

  it("ignores the automation tag in the note by default", () => {
    const rows = parse(
      ["Date\tDescription\tDebit\tCredit", "07/07/2026\tPK MART FZ LLC DUBAI ARE\t8\t0"].join("\n")
    );

    const withTagIgnored = match({
      statementRows: rows,
      actualTransactions: [txn({ id: "t1", amount: -800, notes: "#API PK MART FZ LLC" })],
      config: DEFAULT_MATCH_CONFIG,
    });
    expect(withTagIgnored.matched[0].reasons).toContainEqual(
      expect.objectContaining({ kind: "text", field: "notes", similarity: 1 })
    );

    const withTagKept = match({
      statementRows: rows,
      actualTransactions: [txn({ id: "t1", amount: -800, notes: "#API PK MART FZ LLC" })],
      config: {
        ...DEFAULT_MATCH_CONFIG,
        text: { ...DEFAULT_MATCH_CONFIG.text, ignoreTagsInNotes: false },
      },
    });
    // Still matches on amount+date, but the tag dilutes the text evidence.
    const kept = withTagKept.matched[0].reasons.find(
      (reason) => reason.kind === "text" && reason.field === "notes"
    );
    expect(kept && kept.kind === "text" ? kept.similarity : 1).toBeLessThan(1);
  });
});

describe("foreign-currency transactions", () => {
  // A card purchase abroad posts a converted amount, while the SMS-created
  // transaction in Actual carries the original amount. The posted figures never
  // agree — but the bank prints the original amount in the description, so it can
  // be matched exactly rather than with a tolerance.
  const STATEMENT = [
    "Date\tDescription\tDebit\tCredit",
    "16/07/2026\tALDAWAA PHARMACY 060 KHOBAR SAU SAR225.70\t229.71\t0",
  ].join("\n");

  it("extracts the original-currency amount from the description", () => {
    expect(extractOriginalAmount("ALDAWAA PHARMACY 060 KHOBAR SAU SAR225.70")).toEqual({
      currency: "SAR",
      amount: 22570,
    });
    expect(extractOriginalAmount("AIRALO AMSTERDAM NH USD24.50")).toEqual({
      currency: "USD",
      amount: 2450,
    });
    expect(extractOriginalAmount("PK MART FZ LLC DUBAI ARE")).toBeNull();
  });

  it("signs the original amount like the posted amount", () => {
    const [row] = parse(STATEMENT);
    expect(row.amount).toBe(-22971);
    expect(row.originalAmount).toBe(-22570);
    expect(row.originalCurrency).toBe("SAR");
  });

  it("matches on the original amount when the posted amount cannot", () => {
    const graph = match({
      statementRows: parse(STATEMENT),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-16", amount: -22570, notes: "#API ALDAWAA PHARMACY 060" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].tier).toBe("original-amount-text");
    expect(graph.matched[0].reasons).toContainEqual({
      kind: "original-amount",
      currency: "SAR",
      amount: -22570,
      postedAmount: -22971,
    });
  });

  it("refuses an original-amount match with no text corroboration", () => {
    // A "VAT ON SERVICE CHARGES SAR122.94" fee row repeats the *purchase's*
    // original amount in its own description. Without the text floor it would
    // claim the purchase's transaction.
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "16/07/2026\tVAT ON SERVICE CHARGES SAR122.94\t0.24\t0",
        ].join("\n")
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-16", amount: -12294, notes: "#API S103 TAMIMI MARKETS" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(0);
  });

  it("lets the real purchase win over the VAT row competing for the same transaction", () => {
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "16/07/2026\tS103 TAMIMI MARKETS KHOBAR SAU SAR122.94\t125.10\t0",
          "16/07/2026\tVAT ON SERVICE CHARGES SAR122.94\t0.24\t0",
        ].join("\n")
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-16", amount: -12294, notes: "#API S103 TAMIMI MARKETS" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(1);
    // The purchase claims it; the VAT row is left for the user to create.
    expect(graph.unmatchedStatementRowIds).toHaveLength(1);
  });

  it("offers a review pairing when neither the posted nor the original amount agrees", () => {
    // The automation captured a third figure (a pre-markup conversion), so
    // -93.62 posted against -90.07 recorded. The exact-amount gate holds — this
    // is never an automatic match — but the pair is obvious to a person, so it
    // is surfaced for review with the difference stated.
    const graph = match({
      statementRows: parse(
        ["Date\tDescription\tDebit\tCredit", "14/07/2026\tAIRALO AMSTERDAM NH USD24.50\t93.62\t0"].join(
          "\n"
        )
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-14", amount: -9007, notes: "#API AIRALO" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous).toHaveLength(1);
    expect(graph.ambiguous[0].why).toBe("amount-mismatch");
    expect(graph.ambiguous[0].candidates[0].reasons).toContainEqual({
      kind: "amount-mismatch",
      statementAmount: -9362,
      actualAmount: -9007,
      difference: 355,
    });
  });

  it("stays silent about a mismatch the user switched off", () => {
    const graph = match({
      statementRows: parse(
        ["Date\tDescription\tDebit\tCredit", "14/07/2026\tAIRALO AMSTERDAM NH USD24.50\t93.62\t0"].join(
          "\n"
        )
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-14", amount: -9007, notes: "#API AIRALO" }),
      ],
      config: {
        ...DEFAULT_MATCH_CONFIG,
        reviewAmountMismatch: false,
        pairLeftoversByMerchantAndDate: false,
      },
    });

    expect(graph.ambiguous).toHaveLength(0);
    expect(graph.unmatchedStatementRowIds).toHaveLength(1);
  });
});

describe("duplicate transactions and their competing candidates", () => {
  // A statement row of -41.00 on 12 Jul against two identical transactions the
  // automation entered twice, plus two unrelated -41.00 rows later that month.
  const STATEMENT = [
    "Date\tDescription\tDebit\tCredit",
    "12/07/2026\tBabies More DUBAI 784\t41\t0",
  ].join("\n");

  const LEDGER = [
    txn({ id: "dup-a", date: "2026-07-12", amount: -4100, payeeName: "Babies & More", notes: "#API Babies More" }),
    txn({ id: "dup-b", date: "2026-07-12", amount: -4100, payeeName: "Babies & More", notes: "#API Babies More" }),
    txn({ id: "other-1", date: "2026-07-15", amount: -4100, payeeName: "Costa Coffee", notes: "#API Costa Coffee" }),
    txn({ id: "other-2", date: "2026-07-18", amount: -4100, payeeName: null, notes: null }),
  ];

  it("offers only the genuine rivals, not everything sharing the amount", () => {
    // Sharing an amount inside the date window makes a transaction a candidate,
    // not a competing match. Listing the far-off unrelated ones as "possible
    // matches" is misleading.
    const graph = match({
      statementRows: parse(STATEMENT),
      actualTransactions: LEDGER,
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.ambiguous).toHaveLength(1);
    expect(graph.ambiguous[0].candidates.map((c) => c.actualTransactionId).sort()).toEqual([
      "dup-a",
      "dup-b",
    ]);
  });

  it("does not also list a competing candidate as missing from the statement", () => {
    // These transactions are already on screen awaiting a decision. Repeating
    // them as "Actual only" would double-count them and misrepresent a
    // transaction the statement did reach as one it never mentioned — precisely
    // the row a later version might offer to delete.
    const rows = parse(STATEMENT);
    const graph = match({
      statementRows: rows,
      actualTransactions: LEDGER,
      config: DEFAULT_MATCH_CONFIG,
    });

    let counter = 0;
    const items = buildReconciliationItems({
      statementRows: rows,
      actualTransactions: LEDGER,
      graph,
      transfersReported: true,
      makeId: () => `i${++counter}`,
    });

    const actualOnlyIds = items
      .filter((item) => item.reasonCode === REASON.notOnStatement)
      .flatMap((item) => item.actualTransactionIds);

    expect(actualOnlyIds).not.toContain("dup-a");
    expect(actualOnlyIds).not.toContain("dup-b");
    // The genuinely unrelated ones are still reported as Actual-only.
    expect(actualOnlyIds.sort()).toEqual(["other-1", "other-2"]);
  });

  it("gives every transaction exactly one representation", () => {
    const rows = parse(STATEMENT);
    const graph = match({
      statementRows: rows,
      actualTransactions: LEDGER,
      config: DEFAULT_MATCH_CONFIG,
    });

    let counter = 0;
    const items = buildReconciliationItems({
      statementRows: rows,
      actualTransactions: LEDGER,
      graph,
      transfersReported: true,
      makeId: () => `i${++counter}`,
    });

    const appearances = items.flatMap((item) => item.actualTransactionIds);
    expect(appearances.sort()).toEqual(["dup-a", "dup-b", "other-1", "other-2"]);
  });
});

describe("a fee row must not borrow another purchase's original amount", () => {
  it("does not offer an unrelated merchant as a candidate", () => {
    // Real case: a VAT fee row prints the *purchase's* original amount in its
    // own description, so SAR41.00 collides with an unrelated SAR41.00 purchase
    // three days earlier. The amounts agree by arithmetic and nothing else.
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "15/07/2026\tVAT ON SERVICE CHARGES SAR41.00\t0.08\t0",
        ].join("\n")
      ),
      actualTransactions: [
        txn({
          id: "t1",
          date: "2026-07-12",
          amount: -4100,
          payeeName: "Babies & More",
          notes: "#API Babies More",
        }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous).toHaveLength(0);
    expect(graph.unmatchedStatementRowIds).toHaveLength(1);
  });
});

describe("rows distinguished only by the amount quoted in their text", () => {
  // Two fee rows on the same day for the same tiny amount, told apart solely by
  // the purchase amount each quotes. Their scores land within the ambiguity
  // window because text is a quarter of the budget, but the text itself agrees
  // exactly with one and only approximately with the other.
  const STATEMENT = [
    "Date\tDescription\tDebit\tCredit",
    "03/08/2026\tVAT ON SERVICE CHARGES SAR15.95\t0.03\t0",
    "03/08/2026\tVAT ON SERVICE CHARGES SAR12.96\t0.03\t0",
  ].join("\n");

  const LEDGER = [
    txn({
      id: "vat-15",
      date: "2026-08-03",
      amount: -3,
      payeeName: "VAT ON SERVICE CHARGES SAR15.95",
      notes: null,
    }),
    txn({
      id: "vat-12",
      date: "2026-08-03",
      amount: -3,
      payeeName: "VAT ON SERVICE CHARGES SAR12.96",
      notes: null,
    }),
  ];

  it("matches each row to the transaction whose text agrees exactly", () => {
    const rows = parse(STATEMENT);
    const graph = match({
      statementRows: rows,
      actualTransactions: LEDGER,
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(2);
    expect(graph.ambiguous).toHaveLength(0);

    const byRow = new Map(
      graph.matched.map((entry) => [entry.statementRowId, entry.actualTransactionId])
    );
    const [first, second] = rows;
    expect(byRow.get(first.id)).toBe("vat-15");
    expect(byRow.get(second.id)).toBe("vat-12");
  });

  it("still asks when one candidate reads better but the other is dated better", () => {
    // Text pointing one way and the date the other is real ambiguity, not an
    // artefact of the scoring weights.
    const graph = match({
      statementRows: parse(
        ["Date\tDescription\tDebit\tCredit", "08/07/2026\tAMAZON AE\t110\t0"].join("\n")
      ),
      actualTransactions: [
        txn({ id: "a", date: "2026-07-07", amount: -11000, payeeName: "Amazon" }),
        txn({ id: "b", date: "2026-07-08", amount: -11000, payeeName: "Amazon Marketplace" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous).toHaveLength(1);
  });
});

describe("amounts mangled upstream (same merchant, same date)", () => {
  // Transactions here are created by an automation that extracts fields from an
  // SMS and converts currency, so the amount can be wrong by an arbitrary
  // factor while the merchant text and date stay reliable. Refusing to relate
  // these rows because the amounts disagree would trust the least trustworthy
  // field on the row.

  it("pairs the last row left on each side, however far apart the amounts", () => {
    // Real case: SAR65.00 posted as -66.15; the automation recorded -24.38.
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "19/07/2026\tNajoum Hala Trading Co KHOBAR SAU SAR65.00\t66.15\t0",
        ].join("\n")
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-19", amount: -2438, notes: "#API Najoum Hala Trading Co" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(0);
    expect(graph.ambiguous).toHaveLength(1);
    expect(graph.ambiguous[0].why).toBe("same-merchant-date");
    expect(graph.ambiguous[0].candidates[0].reasons).toContainEqual({
      kind: "amount-mismatch",
      statementAmount: -6615,
      actualAmount: -2438,
      difference: 4177,
    });
  });

  it("pairs the leftover after an exact match has taken its partner", () => {
    // Real case: two rows each side on the same day. SAR47.00 matches -47.00 on
    // the original amount, leaving one row on each side to be related.
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "16/07/2026\tFATIMAH ABU ALSAUD RES QATIF SAU SAR47.00\t47.83\t0",
          "16/07/2026\tFATIMAH ABU ALSAUD RES QATIF SAU SAR20.00\t20.36\t0",
        ].join("\n")
      ),
      actualTransactions: [
        txn({ id: "exact", date: "2026-07-16", amount: -4700, notes: "#API FATIMAH ABU ALSAUD RES" }),
        txn({ id: "wrong", date: "2026-07-16", amount: -7504, notes: "#API FATIMAH ABU ALSAUD RES" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].actualTransactionId).toBe("exact");

    const leftover = graph.ambiguous.find((entry) => entry.why === "same-merchant-date");
    expect(leftover?.candidates[0].actualTransactionId).toBe("wrong");
    // Nothing is left dangling on either side.
    expect(graph.unmatchedStatementRowIds).toHaveLength(0);
    expect(graph.unmatchedActualTransactionIds).toHaveLength(0);
  });

  it("refuses to guess when several rows remain on both sides", () => {
    // Two unmatched each side for the same merchant and day: which belongs to
    // which is exactly the judgement the tool must not make silently.
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "16/07/2026\tFATIMAH ABU ALSAUD RES QATIF SAU SAR20.00\t20.36\t0",
          "16/07/2026\tFATIMAH ABU ALSAUD RES QATIF SAU SAR30.00\t30.55\t0",
        ].join("\n")
      ),
      actualTransactions: [
        txn({ id: "a", date: "2026-07-16", amount: -7504, notes: "#API FATIMAH ABU ALSAUD RES" }),
        txn({ id: "b", date: "2026-07-16", amount: -8801, notes: "#API FATIMAH ABU ALSAUD RES" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.matched).toHaveLength(0);
    const clusters = graph.ambiguous.filter((entry) => entry.why === "merchant-cluster");
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0].candidates.length).toBeGreaterThan(1);
  });

  it("does not relate rows on different days", () => {
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "19/07/2026\tNajoum Hala Trading Co KHOBAR SAU SAR65.00\t66.15\t0",
        ].join("\n")
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-25", amount: -2438, notes: "#API Najoum Hala Trading Co" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.ambiguous).toHaveLength(0);
  });

  it("does not relate different merchants that happen to share a day", () => {
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "19/07/2026\tNajoum Hala Trading Co KHOBAR SAU SAR65.00\t66.15\t0",
        ].join("\n")
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-19", amount: -2438, notes: "#API Costa Coffee" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.ambiguous).toHaveLength(0);
  });

  it("does not relate an inflow to an outflow", () => {
    const graph = match({
      statementRows: parse(
        [
          "Date\tDescription\tDebit\tCredit",
          "19/07/2026\tNajoum Hala Trading Co KHOBAR SAU SAR65.00\t0\t66.15",
        ].join("\n")
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-19", amount: -2438, notes: "#API Najoum Hala Trading Co" }),
      ],
      config: DEFAULT_MATCH_CONFIG,
    });

    expect(graph.ambiguous).toHaveLength(0);
  });
});

describe("profile presets on this data shape", () => {
  it("matches with the notes preset when the payee is unhelpful", () => {
    const graph = match({
      statementRows: parse(
        ["Date\tDescription\tDebit\tCredit", "09/07/2026\tROYAL CATERING SERVICE ABU DHABI UAE\t18\t0"].join(
          "\n"
        )
      ),
      actualTransactions: [
        txn({ id: "t1", date: "2026-07-09", amount: -1800, payeeName: null, notes: "#API ROYAL CATERING SERVICE" }),
      ],
      config: { ...DEFAULT_MATCH_CONFIG, text: TEXT_TARGET_PRESETS.notes },
    });

    expect(graph.matched).toHaveLength(1);
  });
});

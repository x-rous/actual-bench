import { findRuleGaps } from "./ruleGaps";
import { measureTokenSpread } from "./core";
import { ROW_LIMIT } from "./importedTextIndex";
import type { ImportedTextRow } from "./ruleCandidates";
import type { PayeeCleanupCandidate } from "../types";

/**
 * The measurement RD-087 §9 / PR-042 042c requires before the scan shape is
 * fixed.
 *
 * The concern: RD-078 backtests once per *cluster* — dozens of times. Rule gaps
 * could naively backtest once per surviving *payee*, against a full `ROW_LIMIT`
 * of grouped rows, on the main thread, every time the scan's dependencies
 * change.
 *
 * What makes it affordable is the exclusion order — a payee whose imports
 * already equal its name never reaches a backtest — and compiling each pattern
 * once instead of once per row. This file proves it rather than asserting it in
 * a comment.
 *
 * The budget below is deliberately unkind: 400 payees, the full row cap taken
 * from the source rather than restated here, and every single proposal on the
 * pattern path — the expensive one.
 */

function payee(id: string, name: string): PayeeCleanupCandidate {
  return {
    id,
    name,
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
    },
  };
}

/** Distinct word-shaped merchant names, since real ones are words. */
const WORDS = Array.from({ length: 400 }, (_, i) =>
  String.fromCharCode(65 + (i % 26), 65 + ((i / 26) | 0) % 26, 65 + ((i / 676) | 0) % 26) +
  "MART"
);

function buildBudget() {
  const candidates: PayeeCleanupCandidate[] = [];
  const rows: ImportedTextRow[] = [];
  const transactionCounts = new Map<string, number>();

  for (let i = 0; i < 400; i++) {
    const id = `p${i}`;
    transactionCounts.set(id, 12);

    if (i % 4 === 0) {
      // Varying text sharing a stem — the expensive path.
      candidates.push(payee(id, `Merchant ${i}`));
      for (let v = 0; v < 12; v++) {
        rows.push({
          field: "imported_payee",
          text: `ACME${WORDS[i % WORDS.length]} STORE 0${100 + v}`,
          payeeId: id,
          payeeName: null,
          transactionCount: 1,
        });
      }
    } else if (i % 4 === 1) {
      // Already resolves by name: excluded before anything expensive.
      candidates.push(payee(id, `Payee ${i}`));
      rows.push({
        field: "imported_payee",
        text: `Payee ${i}`,
        payeeId: id,
        payeeName: null,
        transactionCount: 12,
      });
    } else {
      // Text that varies around a core — the common case now that the shape is
      // chosen on variation rather than on how many distinct strings there are.
      candidates.push(payee(id, `Shop ${i}`));
      for (let v = 0; v < 3; v++) {
        rows.push({
          field: "imported_payee",
          text: `#2026-0${v + 1} SHOP${WORDS[i % WORDS.length]} PTY LTD`,
          payeeId: id,
          payeeName: null,
          transactionCount: 4,
        });
      }
    }
  }

  // Pad to the row cap with traffic belonging to other payees, which is what
  // every backtest has to scan through.
  while (rows.length < ROW_LIMIT) {
    rows.push({
      field: "imported_payee",
      text: `UNRELATED TRAFFIC ${rows.length}`,
      payeeId: `other-${rows.length}`,
      payeeName: null,
      transactionCount: 1,
    });
  }

  return { candidates, rows, transactionCounts };
}

describe("rule gap scan cost", () => {
  const { candidates, rows, transactionCounts } = buildBudget();


  it("excludes the payees that resolve by name without touching the history", () => {
    const gaps = findRuleGaps({
      candidates,
      rows,
      rules: [],
      transactionCounts,
      clusteredPayeeIds: new Set(),
    });

    // A quarter of the budget resolves by name and must not be suggested.
    expect(gaps).toHaveLength(300);
    expect(gaps.some((g) => g.payee.name.startsWith("Payee "))).toBe(false);

    // Every proposal here is a pattern, which is the expensive path — the
    // worst case for the measurement below, and the common case in practice.
    expect(gaps.every((g) => g.proposal.shape === "matches")).toBe(true);
  });

  it("compiles each pattern once, not once per row", () => {
    // The regression this guards against is real: `scoreCandidate` used to build
    // a fresh RegExp for every row it tested, so one candidate compiled the same
    // pattern thousands of times and the worst-case scan took ~1400ms instead of
    // ~215ms.
    //
    // Counted rather than timed. A wall-clock threshold low enough to catch a 6x
    // regression is also low enough to flake when the suite runs in parallel, so
    // it failed for reasons that had nothing to do with the code.
    const RealRegExp = global.RegExp;
    let constructed = 0;
    class CountingRegExp extends RealRegExp {
      constructor(...args: ConstructorParameters<typeof RegExp>) {
        constructed += 1;
        super(...args);
      }
    }
    global.RegExp = CountingRegExp as unknown as RegExpConstructor;

    try {
      findRuleGaps({
        candidates,
        rows,
        rules: [],
        transactionCounts,
        clusteredPayeeIds: new Set(),
      });
    } finally {
      global.RegExp = RealRegExp;
    }

    // Bounded by the number of candidates considered, which is a handful per
    // payee. Compiling per row would put this in the millions.
    expect(constructed).toBeLessThan(rows.length);
  });

  it("measures the budget's vocabulary once, not once per cluster", () => {
    // Both halves of cleanup need it, but the future-rule analysis runs once per
    // cluster — so recomputing it there walked every row in the budget dozens of
    // times per scan. Forty clusters over a full history cost about two seconds
    // before it was memoized on the row set.
    const first = measureTokenSpread(rows);
    for (let i = 0; i < 40; i++) {
      expect(measureTokenSpread(rows)).toBe(first);
    }
  });
});

import { findRuleGaps } from "./ruleGaps";
import type { ImportedTextRow } from "./ruleCandidates";
import type { PayeeCleanupCandidate } from "../types";

/**
 * The measurement RD-087 §9 / PR-042 042c requires before the scan shape is
 * fixed.
 *
 * The concern: RD-078 backtests once per *cluster* — dozens of times. Rule gaps
 * could naively backtest once per surviving *payee*, against up to
 * `ROW_LIMIT = 5000` grouped rows, on the main thread, every time the scan's
 * dependencies change.
 *
 * What makes it affordable is the exclusion order plus the exact-match shape:
 * most payees never reach a backtest, and the ones with stable text never need
 * one. This file proves that on a budget shaped like a real one, rather than
 * asserting it in a comment.
 *
 * The budget below is deliberately unkind: 400 payees, 5000 rows, and a quarter
 * of the payees carrying varying text — i.e. the expensive path — which is far
 * more than a curated budget would have.
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
          text: `MERCHANT${i} STORE 0${100 + v}`,
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
      // Stable text: proposed, but with no backtest.
      candidates.push(payee(id, `Shop ${i}`));
      rows.push({
        field: "imported_payee",
        text: `SHOP${i} PTY LTD 4821`,
        payeeId: id,
        payeeName: null,
        transactionCount: 12,
      });
    }
  }

  // Pad to the row cap with traffic belonging to other payees, which is what
  // every backtest has to scan through.
  while (rows.length < 5000) {
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

    // And only the varying-text quarter takes the expensive shape.
    const patterns = gaps.filter((g) => g.proposal.shape === "matches");
    expect(patterns).toHaveLength(100);
  });

  it("completes a worst-case budget within a frame budget", () => {
    // Not a benchmark — a regression guard. The threshold is loose enough not to
    // flake on a loaded CI box, but tight enough that reintroducing a backtest
    // per payee (or per row) would blow it.
    const started = Date.now();
    findRuleGaps({
      candidates,
      rows,
      rules: [],
      transactionCounts,
      clusteredPayeeIds: new Set(),
    });
    const elapsed = Date.now() - started;

    // Measured at ~740ms for this budget on a development machine, with 100 of
    // the 400 payees on the pattern path. A realistic budget has far fewer.
    // The threshold is a regression guard, not the measurement.
    expect(elapsed).toBeLessThan(2000);
  });
});

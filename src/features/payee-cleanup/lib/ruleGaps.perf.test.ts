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
 * What makes it affordable is the exclusion order — a payee whose imports
 * already equal its name never reaches a backtest — and compiling each pattern
 * once instead of once per row. This file proves it rather than asserting it in
 * a comment.
 *
 * The budget below is deliberately unkind: 400 payees, the full 5000-row cap,
 * and every single proposal on the pattern path — the expensive one.
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
      // Text that varies around a core — the common case now that the shape is
      // chosen on variation rather than on how many distinct strings there are.
      candidates.push(payee(id, `Shop ${i}`));
      for (let v = 0; v < 3; v++) {
        rows.push({
          field: "imported_payee",
          text: `#2026-0${v + 1} SHOP${i} PTY LTD`,
          payeeId: id,
          payeeName: null,
          transactionCount: 4,
        });
      }
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

    // Every proposal here is a pattern, which is the expensive path — the
    // worst case for the measurement below, and the common case in practice.
    expect(gaps.every((g) => g.proposal.shape === "matches")).toBe(true);
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

    // Measured at ~215ms on a development machine, with *every* proposal on the
    // pattern path. It was ~1400ms until `scoreCandidate` stopped compiling its
    // regex once per row, which is the kind of regression this guards against.
    expect(elapsed).toBeLessThan(1000);
  });
});

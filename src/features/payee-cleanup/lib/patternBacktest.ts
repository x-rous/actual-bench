/**
 * A proposed rule, checked against the whole budget on demand.
 *
 * The scan reads at most `ROW_LIMIT` distinct import strings across every payee,
 * which is what makes it fast enough to run on arrival. When a budget exceeds
 * that, the scan cannot honestly say a pattern catches nothing unexpected: an
 * unread row is a transaction the rule might catch unseen, so the row carries a
 * caution instead of an answer.
 *
 * This resolves that caution for one pattern, rather than by reading more of the
 * budget. The condition is pushed into the query - `$regexp`, `$like` or
 * `$oneof`, the same operators Actual compiles its own rules to - so the budget
 * returns only what the pattern actually matches, grouped by payee. A wide read
 * is replaced by a narrow one, and the answer is exact rather than sampled.
 *
 * Deliberately not run for every row up front: one query per proposed rule
 * across hundreds of payees is the slow shape this design exists to avoid. It
 * runs when a user opens a row and asks.
 */

import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";
import type { RuleGapProposal } from "./ruleGaps";
import type { SourceField } from "./ruleCandidates";

/** One payee the pattern reaches, and how much of it. */
export type BacktestMatch = {
  payeeId: string | null;
  payeeName: string | null;
  transactionCount: number;
  /**
   * The import text behind the match, most frequent first.
   *
   * Carried because a payee name alone does not explain a collision, and for
   * the rows with no payee at all it is the only identifying thing there is -
   * "8 transactions belonging to (no payee)" names nothing the user can judge.
   */
  texts: string[];
};

export type BacktestResult = {
  /** Transactions belonging to the payee the rule is for. */
  expected: number;
  /**
   * Other payees the rule would also catch, largest first.
   *
   * Empty is the answer the caution could not give: the pattern is exact, and
   * the row can say so without hedging.
   */
  others: BacktestMatch[];
  /**
   * Transactions the pattern matches that have no payee at all.
   *
   * Kept apart from `others` because it is not the same finding. A transaction
   * with no payee is not a collision - nothing is being taken from anyone, and
   * setting a payee on it is what the rule is for. `scoreCandidate` already
   * makes this distinction ("a row with no payee belongs to nobody"); reporting
   * them together made a benefit read as a warning.
   */
  unassigned: BacktestMatch | null;
};

type QueryRow = Record<string, unknown> & { transactionCount?: number };

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The proposal as an ActualQL filter.
 *
 * `matches` is a regular expression in Actual's rules and stays one here.
 * `contains` becomes a `%value%` LIKE, which is exactly what Actual compiles a
 * `contains` condition to, so the backtest and the rule cannot disagree.
 */
function filterFor(proposal: RuleGapProposal): { field: SourceField; filter: object } {
  if (proposal.shape === "one-of") {
    return { field: proposal.field, filter: { $oneof: proposal.texts } };
  }
  const { op, value } = proposal.candidate;
  return {
    field: proposal.field,
    filter: op === "matches" ? { $regexp: value } : { $like: `%${value}%` },
  };
}

/**
 * How many rows the check itself may return.
 *
 * Distinct (text, payee) pairs matching one pattern - orders of magnitude below
 * the whole-budget read this replaces. A pattern that somehow exceeds it is
 * catching far too much, which the result makes obvious either way.
 */
export const BACKTEST_ROW_LIMIT = 2000;

export async function backtestProposal(
  connection: ConnectionInstance,
  proposal: RuleGapProposal,
  payeeId: string,
  /**
   * The payee's name, accepted as an alternative to its id.
   *
   * A grouped query can return either depending on how the field serializes,
   * and `scoreCandidate` already guards the same hazard. Comparing ids alone
   * would attribute every one of a payee's own transactions to "some other
   * payee" and report a safe rule as catching the whole budget.
   */
  payeeName: string
): Promise<BacktestResult> {
  const { field, filter } = filterFor(proposal);

  const response = await runQuery<{ data: QueryRow[] }>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { [field]: filter },
      groupBy: [field, "payee", "payee.name"],
      select: [field, "payee", "payee.name", { transactionCount: { $count: "$id" } }],
      limit: BACKTEST_ROW_LIMIT,
    },
  });

  let expected = 0;
  const target = payeeName.trim().toUpperCase();
  // Distinct strings with their counts, so the few shown are the common ones
  // rather than whichever the query happened to return first.
  const byPayee = new Map<string, BacktestMatch & { weighted: [string, number][] }>();

  for (const row of response.data ?? []) {
    const count = typeof row.transactionCount === "number" ? row.transactionCount : 0;
    const rowPayee = toText(row.payee);
    const text = toText(row[field]);

    const rowName = toText(row["payee.name"]);
    if (rowPayee === payeeId || (rowName !== null && rowName.toUpperCase() === target)) {
      expected += count;
      continue;
    }

    // Grouped by payee rather than listed per string: "also catches 3 other
    // payees" is the decision, and the strings behind it are noise at this size.
    const key = rowPayee ?? "__none__";
    const existing = byPayee.get(key);
    if (existing) {
      existing.transactionCount += count;
      if (text) existing.weighted.push([text, count]);
    } else {
      byPayee.set(key, {
        payeeId: rowPayee,
        payeeName: rowName,
        transactionCount: count,
        texts: [],
        weighted: text ? [[text, count]] : [],
      });
    }
  }

  const grouped = [...byPayee.values()].map(({ weighted, ...match }) => ({
    ...match,
    texts: weighted.sort((a, b) => b[1] - a[1]).map(([text]) => text),
  }));
  return {
    expected,
    others: grouped
      .filter((match) => match.payeeId !== null)
      .sort((a, b) => b.transactionCount - a.transactionCount),
    unassigned: grouped.find((match) => match.payeeId === null) ?? null,
  };
}

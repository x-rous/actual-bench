/**
 * The matcher entry point (RD-071 §5.3).
 *
 * `match()` is **pure**: no I/O, no React, no clock, no randomness. Identical
 * inputs always produce an identical graph. That is what makes sessions
 * resumable, the tolerance control re-runnable live, and the fixtures
 * meaningful.
 *
 * Manual decisions are a **separate layer applied on top** of this result
 * (RD-071 D10) — re-running the matcher never destroys them.
 */

import type {
  ActualTransactionSnapshot,
  AmbiguousMatch,
  MatchConfig,
  MatchGraph,
  MatchOutcome,
  ScoredCandidate,
  StatementRow,
} from "../types";
import { amountDateSlice, buildActualIndex, dateSlice, type ActualIndex } from "./actualIndex";
import { assignMatches } from "./assign";
import {
  scoreAmountMismatchCandidate,
  scoreCandidate,
  scoreSameMerchantCandidate,
} from "./score";

export type MatchInput = {
  statementRows: StatementRow[];
  actualTransactions: ActualTransactionSnapshot[];
  config: MatchConfig;
};

export function match(input: MatchInput): MatchGraph {
  const { statementRows, config } = input;
  const index = buildActualIndex(input.actualTransactions);

  const pinned = pinByImportedId(statementRows, index);
  const pinnedRows = new Set(pinned.map((p) => p.statementRowId));
  const pinnedTransactions = new Set(pinned.map((p) => p.actualTransactionId));

  const candidates: ScoredCandidate[] = [];
  for (const row of statementRows) {
    if (pinnedRows.has(row.id)) continue;
    for (const transaction of candidatesFor(row, index, config)) {
      if (pinnedTransactions.has(transaction.id)) continue;
      const candidate = scoreCandidate(row, transaction, config, index);
      if (candidate) candidates.push(candidate);
    }
  }

  const result = assignMatches({
    candidates,
    pinned,
    statementRowIds: statementRows.map((row) => row.id),
    // Sorted by (date, id) rather than left in load order: the graph must be a
    // function of the *content* of the inputs, not of the order the transport
    // happened to return them in.
    actualTransactionIds: [...index.byId.values()]
      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1))
      .map((transaction) => transaction.id),
    config,
  });

  const withLeftovers = addLeftoverReviews(result, statementRows, index, config);

  return {
    matched: withLeftovers.matched,
    ambiguous: withLeftovers.ambiguous,
    unmatchedStatementRowIds: withLeftovers.unmatchedStatementRowIds,
    unmatchedActualTransactionIds: withLeftovers.unmatchedActualTransactionIds,
    likelyDuplicates: withLeftovers.likelyDuplicates,
  };
}

/**
 * Relate what is left over on both sides, once every amount-based avenue is
 * exhausted.
 *
 * This used to be two passes that competed for the same rows — one for pairs
 * whose text agreed but whose amounts did not, one for same-merchant/same-date
 * leftovers — and the first of them claimed the entire candidate pool for
 * whichever statement row it reached first:
 *
 * ```
 * for (const candidate of candidates) claimed.add(candidate.actualTransactionId)
 * ```
 *
 * So four `Jeeny` rows against five `Jeeny` transactions produced one review
 * item holding all five and three rows reporting "not in Actual", which the user
 * would then create — duplicating three transactions while being invited to
 * delete the originals (F-151a).
 *
 * One pass now, and nothing is claimed. Edges are scored between the leftovers,
 * **connected components** are taken over those edges, and every statement row
 * in a component is offered the candidates it actually scored against. The
 * contested thing is the component, so the component is what the user is shown.
 *
 * Two outcomes, and the distinction is the whole point:
 *
 * - **one row and one transaction** → a review pairing. Nothing else could be
 *   meant, so relating them costs nothing and finding it by hand costs the user.
 * - **anything larger** → a cluster. Every row sees its own candidates; the
 *   pairing is the user's to make, and making one frees the rest
 *   (`resolveToTransaction`).
 *
 * Never an automatic match at any size: the amounts disagree, and only the user
 * can say which figure is right.
 *
 * The one-transaction-per-match invariant is not enforced here by hiding
 * candidates. It is enforced at decision time, which is the only place that can
 * do it without starving a row of a transaction still going spare.
 */
function addLeftoverReviews(
  result: ReturnType<typeof assignMatches>,
  statementRows: StatementRow[],
  index: ActualIndex,
  config: MatchConfig
): ReturnType<typeof assignMatches> {
  if (result.unmatchedStatementRowIds.length === 0) return result;
  if (result.unmatchedActualTransactionIds.length === 0) return result;
  if (!config.reviewAmountMismatch && !config.pairLeftoversByMerchantAndDate) return result;

  const rowsById = new Map(statementRows.map((row) => [row.id, row]));

  /*
   * `assignMatches` only marks a transaction consumed when it is *matched*, so
   * one offered as a candidate on an ambiguous row is still listed as
   * unmatched. Taking that list at face value let this pass offer the same
   * transaction a second time, to a different row, in a different component —
   * two items holding one transaction, which is the invariant the whole design
   * turns on. Anything already on offer is spoken for.
   */
  const alreadyOffered = new Set(
    result.ambiguous.flatMap((entry) =>
      entry.candidates.map((candidate) => candidate.actualTransactionId)
    )
  );
  const available = new Set(
    result.unmatchedActualTransactionIds.filter((id) => !alreadyOffered.has(id))
  );

  // Widest window either tier can span, so one date slice serves both and the
  // scan stays bounded on a large statement. Each scorer still applies its own,
  // narrower tolerance.
  const reach = Math.max(
    config.reviewAmountMismatch ? config.dateToleranceDays : 0,
    config.pairLeftoversByMerchantAndDate ? config.clusterDateToleranceDays : 0
  );

  const plausible = new Graph();
  const unrelated = new Graph();

  for (const statementRowId of result.unmatchedStatementRowIds) {
    const row = rowsById.get(statementRowId);
    if (!row) continue;

    for (const transaction of dateSlice(
      index,
      shiftDate(row.postedDate, -reach),
      shiftDate(row.postedDate, reach)
    )) {
      if (!available.has(transaction.id)) continue;

      const amountEdge = config.reviewAmountMismatch
        ? scoreAmountMismatchCandidate(row, transaction, config, index)
        : null;
      if (amountEdge) {
        plausible.add(amountEdge);
        continue;
      }

      const merchantEdge = config.pairLeftoversByMerchantAndDate
        ? scoreSameMerchantCandidate(row, transaction, config, index)
        : null;
      if (merchantEdge) unrelated.add(merchantEdge);
    }
  }

  const ambiguous = [...result.ambiguous];
  const relatedRows = new Set<string>();
  const relatedTransactions = new Set<string>();

  const offer = (statementRowId: string, candidates: ScoredCandidate[], why: AmbiguousMatch["why"]) => {
    relatedRows.add(statementRowId);
    for (const candidate of candidates) relatedTransactions.add(candidate.actualTransactionId);
    ambiguous.push({ statementRowId, candidates, why });
  };

  // Tier 1 — amounts that could plausibly be the same transaction. These may
  // form a cluster of any size: a component is contested precisely because
  // several rows have a real claim on the same transactions.
  for (const component of plausible.components()) {
    const single = component.rows.length === 1 && component.transactions.length === 1;
    for (const statementRowId of component.rows) {
      const candidates = plausible.sortedFor(statementRowId);
      if (candidates.length === 0) continue;
      offer(
        statementRowId,
        candidates,
        single
          ? candidates[0].tier === "amount-mismatch-review"
            ? "amount-mismatch"
            : "same-merchant-date"
          : "merchant-cluster"
      );
    }
  }

  /*
   * Tier 2 — same merchant, same day, amounts unrelated.
   *
   * This tier ignores the amounts entirely, which is only defensible once every
   * amount-based avenue is spent: when transactions come from an automation that
   * extracts and converts amounts, the amount is the least reliable field on the
   * row while the merchant and the date are the most reliable.
   *
   * "Spent" is the load-bearing word, and it is why this runs over the leftovers
   * of the leftovers. A row that tier 1 could pair with a *plausible* amount must
   * never also be offered an implausible one: `Karnr SAR129.00`, posting -131.34,
   * was offered a -13.71 transaction as a second candidate purely because both
   * said "Karnr" on the 21st — while -13.71 is the match for the `Karnr SAR14.00`
   * row two lines away, at the same 0.979 conversion. Both sides of a tier-2 edge
   * must be untouched by tier 1, or the tool is guessing where it had evidence.
   *
   * Among what is left it clusters like tier 1 does, because the same reasoning
   * applies: one row and one transaction is a pairing nothing else could mean;
   * several on either side is a judgement that belongs to the user.
   */
  const remaining = new Graph();
  for (const edges of unrelated.byRow.values()) {
    for (const edge of edges) {
      if (relatedRows.has(edge.statementRowId)) continue;
      if (relatedTransactions.has(edge.actualTransactionId)) continue;
      remaining.add(edge);
    }
  }

  for (const component of remaining.components()) {
    const single = component.rows.length === 1 && component.transactions.length === 1;
    for (const statementRowId of component.rows) {
      const candidates = remaining.sortedFor(statementRowId);
      if (candidates.length === 0) continue;
      offer(statementRowId, candidates, single ? "same-merchant-date" : "merchant-cluster");
    }
  }

  if (relatedRows.size === 0) return result;

  return {
    ...result,
    ambiguous,
    unmatchedStatementRowIds: result.unmatchedStatementRowIds.filter(
      (id) => !relatedRows.has(id)
    ),
    unmatchedActualTransactionIds: result.unmatchedActualTransactionIds.filter(
      (id) => !relatedTransactions.has(id)
    ),
  };
}

/**
 * A bipartite graph of leftover statement rows and leftover transactions.
 *
 * Held as both adjacency maps because both directions are load-bearing: rows
 * drive what a user is offered, and transaction degree is what decides whether a
 * pairing is unique enough to be worth asserting.
 */
class Graph {
  readonly byRow = new Map<string, ScoredCandidate[]>();
  readonly byTransaction = new Map<string, ScoredCandidate[]>();

  add(edge: ScoredCandidate): void {
    push(this.byRow, edge.statementRowId, edge);
    push(this.byTransaction, edge.actualTransactionId, edge);
  }

  /** This row's candidates, best first. */
  sortedFor(statementRowId: string): ScoredCandidate[] {
    return (this.byRow.get(statementRowId) ?? []).slice().sort((a, b) => b.score - a.score);
  }

  /**
   * Connected components.
   *
   * A component is the set of rows and transactions related to each other,
   * directly or through a shared neighbour — exactly the set a decision on any
   * one of them affects. Sizing it is what separates "these two are obviously
   * the same thing" from "several are in play and the tool will not guess".
   *
   * Iteration follows the insertion order of the adjacency maps, which follows
   * the statement's own row order, so components come out the same every run.
   */
  components(): { rows: string[]; transactions: string[] }[] {
    const seenRows = new Set<string>();
    const seenTransactions = new Set<string>();
    const out: { rows: string[]; transactions: string[] }[] = [];

    for (const startRow of this.byRow.keys()) {
      if (seenRows.has(startRow)) continue;

      const rows: string[] = [];
      const transactions: string[] = [];
      const queue: { kind: "row" | "transaction"; id: string }[] = [
        { kind: "row", id: startRow },
      ];
      seenRows.add(startRow);

      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node.kind === "row") {
          rows.push(node.id);
          for (const edge of this.byRow.get(node.id) ?? []) {
            if (seenTransactions.has(edge.actualTransactionId)) continue;
            seenTransactions.add(edge.actualTransactionId);
            queue.push({ kind: "transaction", id: edge.actualTransactionId });
          }
        } else {
          transactions.push(node.id);
          for (const edge of this.byTransaction.get(node.id) ?? []) {
            if (seenRows.has(edge.statementRowId)) continue;
            seenRows.add(edge.statementRowId);
            queue.push({ kind: "row", id: edge.statementRowId });
          }
        }
      }

      out.push({ rows, transactions });
    }

    return out;
  }
}

function push(map: Map<string, ScoredCandidate[]>, key: string, value: ScoredCandidate): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/**
 * Tier 1 — a statement identifier equals an Actual `imported_id`.
 *
 * Pinned before any scoring and removed from the candidate pool: this is an
 * identity match, so no amount of text or date evidence can outrank it.
 *
 * Both identifiers the statement can carry are tried, external id first: OFX's
 * `FITID` is a genuine bank transaction id, while a CSV reference column is
 * whatever the bank chose to put there. Neither is *written* as `imported_id`
 * (RD-072 §2.6) — but if the row in Actual arrived through a bank import that
 * did store one, that is identity evidence and worth using.
 */
function pinByImportedId(rows: StatementRow[], index: ActualIndex): MatchOutcome[] {
  const pinned: MatchOutcome[] = [];
  const taken = new Set<string>();

  for (const row of rows) {
    // Tried in order of authority, not exclusively: an OFX `FITID` that Actual
    // has never seen must not stop the row's own reference — which the account
    // may well carry — from being looked up.
    const transactionId = [row.externalId, row.bankReference]
      .map((identifier) => (identifier ? index.byImportedId.get(identifier) : undefined))
      .find((found) => found !== undefined);
    if (!transactionId || taken.has(transactionId)) continue;
    taken.add(transactionId);
    pinned.push({
      statementRowId: row.id,
      actualTransactionId: transactionId,
      score: 100,
      label: "exact",
      tier: "reference-imported-id",
      reasons: [{ kind: "reference", where: "importedId" }],
      evidenceSource: "bench",
    });
  }
  return pinned;
}

/**
 * Candidate generation: hash lookups on exact amounts, then a binary-searched
 * date slice. Text is never consulted here — it only ranks candidates that are
 * already financially plausible (RD-071 D9).
 *
 * Two amounts are looked up, both exact:
 *
 * 1. the **posted** amount;
 * 2. the **original-currency** amount, when the bank printed one in the
 *    description. A foreign card purchase posts as a converted figure, while an
 *    SMS/automation-created transaction in Actual usually carries the original
 *    amount — so the posted figure never matches, but the original one matches
 *    exactly. This is not a tolerance: it is an exact match against a second
 *    amount the bank itself stated. Scoring keeps it a weaker tier and requires
 *    text corroboration (see `score.ts`).
 */
function candidatesFor(
  row: StatementRow,
  index: ActualIndex,
  config: MatchConfig
): ActualTransactionSnapshot[] {
  const from = shiftDate(row.postedDate, -config.dateToleranceDays);
  const to = shiftDate(row.postedDate, config.dateToleranceDays);

  const posted = amountDateSlice(index, row.amount, from, to);
  if (!config.matchOriginalCurrencyAmount || row.originalAmount == null) return posted;
  if (row.originalAmount === row.amount) return posted;

  const seen = new Set(posted.map((transaction) => transaction.id));
  const original = amountDateSlice(index, row.originalAmount, from, to).filter(
    (transaction) => !seen.has(transaction.id)
  );
  return [...posted, ...original];
}

/** Shift an ISO `YYYY-MM-DD` date by whole days, staying in UTC. */
export function shiftDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(date) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

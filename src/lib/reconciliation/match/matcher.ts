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

  const withMismatches = addAmountMismatchReviews(result, statementRows, index, config);
  const withClusters = addMerchantDateLeftovers(withMismatches, statementRows, index, config);

  return {
    matched: withClusters.matched,
    ambiguous: withClusters.ambiguous,
    unmatchedStatementRowIds: withClusters.unmatchedStatementRowIds,
    unmatchedActualTransactionIds: withClusters.unmatchedActualTransactionIds,
    likelyDuplicates: withClusters.likelyDuplicates,
  };
}

/**
 * Relate what is left over for the same merchant on the same date.
 *
 * When transactions are created by an automation that extracts and converts
 * amounts, the amount is the least reliable field on the row while the merchant
 * text and date are the most reliable. So after every amount-based avenue is
 * exhausted, rows that plainly concern the same merchant on the same day are
 * related to each other regardless of how far apart their amounts are.
 *
 * Two outcomes, and the distinction is the whole point:
 *
 * - **exactly one left on each side** → a review pairing. Nothing else could be
 *   meant, so relating them costs nothing and finding it by hand costs the user.
 * - **more than one on either side** → a cluster, listing all of them, pairing
 *   none. Guessing which of two belongs to which is precisely the judgement the
 *   tool should not make silently.
 *
 * Never an automatic match: the amounts disagree, and only the user can say
 * which figure is right.
 */
function addMerchantDateLeftovers(
  result: ReturnType<typeof assignMatches>,
  statementRows: StatementRow[],
  index: ActualIndex,
  config: MatchConfig
): ReturnType<typeof assignMatches> {
  if (!config.pairLeftoversByMerchantAndDate) return result;
  if (result.unmatchedStatementRowIds.length === 0) return result;
  if (result.unmatchedActualTransactionIds.length === 0) return result;

  const rowsById = new Map(statementRows.map((row) => [row.id, row]));
  const leftoverRows = result.unmatchedStatementRowIds
    .map((id) => rowsById.get(id))
    .filter((row): row is StatementRow => row !== undefined);
  const leftoverTransactions = result.unmatchedActualTransactionIds
    .map((id) => index.byId.get(id))
    .filter((transaction): transaction is ActualTransactionSnapshot => transaction !== undefined);

  // Bipartite edges between leftovers that look like the same merchant on the
  // same day. Degree is what decides pairing versus cluster.
  const edges = new Map<string, ScoredCandidate[]>();
  const byTransaction = new Map<string, ScoredCandidate[]>();

  for (const row of leftoverRows) {
    for (const transaction of leftoverTransactions) {
      const candidate = scoreSameMerchantCandidate(row, transaction, config, index);
      if (!candidate) continue;
      const forRow = edges.get(row.id);
      if (forRow) forRow.push(candidate);
      else edges.set(row.id, [candidate]);
      const forTransaction = byTransaction.get(transaction.id);
      if (forTransaction) forTransaction.push(candidate);
      else byTransaction.set(transaction.id, [candidate]);
    }
  }

  if (edges.size === 0) return result;

  const ambiguous = [...result.ambiguous];
  const pairedRows = new Set<string>();
  const pairedTransactions = new Set<string>();

  for (const [statementRowId, candidates] of edges) {
    const only = candidates.length === 1 ? candidates[0] : null;
    if (!only) continue;
    // The transaction must point back at this row alone, or the pairing is a
    // guess dressed up as a conclusion.
    if ((byTransaction.get(only.actualTransactionId) ?? []).length !== 1) continue;

    pairedRows.add(statementRowId);
    pairedTransactions.add(only.actualTransactionId);
    ambiguous.push({ statementRowId, candidates: [only], why: "same-merchant-date" });
  }

  // Whatever remains related but not uniquely so becomes a cluster.
  for (const [statementRowId, candidates] of edges) {
    if (pairedRows.has(statementRowId)) continue;
    const remaining = candidates.filter(
      (candidate) => !pairedTransactions.has(candidate.actualTransactionId)
    );
    if (remaining.length === 0) continue;
    pairedRows.add(statementRowId);
    for (const candidate of remaining) pairedTransactions.add(candidate.actualTransactionId);
    ambiguous.push({ statementRowId, candidates: remaining, why: "merchant-cluster" });
  }

  return {
    ...result,
    ambiguous,
    unmatchedStatementRowIds: result.unmatchedStatementRowIds.filter(
      (id) => !pairedRows.has(id)
    ),
    unmatchedActualTransactionIds: result.unmatchedActualTransactionIds.filter(
      (id) => !pairedTransactions.has(id)
    ),
  };
}

/**
 * Offer a review pairing where the text is convincing but no amount agrees.
 *
 * A foreign purchase can post a converted figure while the recorded transaction
 * holds neither that figure nor the printed original — a pre-markup conversion,
 * say. `AIRALO AMSTERDAM NH USD24.50` posting −93.62 against a recorded −90.07
 * is obvious to a person and invisible to an exact-amount matcher.
 *
 * These are **never** automatic matches: feature spec §11 is explicit that a
 * differing amount is a conflict the user resolves. They are surfaced as review
 * items, with the difference stated, so the pair can be confirmed in one action
 * instead of hunted for by hand.
 *
 * Runs only for statement rows that ended with nothing, against transactions
 * nothing claimed, so it cannot displace or weaken any real match.
 */
function addAmountMismatchReviews(
  result: ReturnType<typeof assignMatches>,
  statementRows: StatementRow[],
  index: ActualIndex,
  config: MatchConfig
): ReturnType<typeof assignMatches> {
  if (!config.reviewAmountMismatch || result.unmatchedStatementRowIds.length === 0) {
    return result;
  }

  const rowsById = new Map(statementRows.map((row) => [row.id, row]));
  const available = new Set(result.unmatchedActualTransactionIds);
  const claimed = new Set<string>();
  const ambiguous = [...result.ambiguous];
  const stillUnmatched: string[] = [];

  for (const statementRowId of result.unmatchedStatementRowIds) {
    const row = rowsById.get(statementRowId);
    if (!row) {
      stillUnmatched.push(statementRowId);
      continue;
    }

    const candidates = dateSlice(
      index,
      shiftDate(row.postedDate, -config.dateToleranceDays),
      shiftDate(row.postedDate, config.dateToleranceDays)
    )
      .filter(
        (transaction) => available.has(transaction.id) && !claimed.has(transaction.id)
      )
      .map((transaction) => scoreAmountMismatchCandidate(row, transaction, config, index))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      stillUnmatched.push(statementRowId);
      continue;
    }

    // One review pairing per transaction: offering the same transaction to two
    // statement rows would recreate the double-claim this design forbids.
    for (const candidate of candidates) claimed.add(candidate.actualTransactionId);

    ambiguous.push({
      statementRowId,
      candidates,
      why: "amount-mismatch",
    });
  }

  return {
    ...result,
    ambiguous,
    unmatchedStatementRowIds: stillUnmatched,
    unmatchedActualTransactionIds: result.unmatchedActualTransactionIds.filter(
      (id) => !claimed.has(id)
    ),
  };
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
    const identifier = row.externalId || row.bankReference;
    if (!identifier) continue;
    const transactionId = index.byImportedId.get(identifier);
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

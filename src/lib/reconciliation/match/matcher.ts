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
import { amountDateSlice, buildActualIndex, type ActualIndex } from "./actualIndex";
import { assignMatches } from "./assign";
import { scoreCandidate } from "./score";

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
      candidates.push(scoreCandidate(row, transaction, config, index));
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

  return {
    matched: result.matched,
    ambiguous: result.ambiguous,
    unmatchedStatementRowIds: result.unmatchedStatementRowIds,
    unmatchedActualTransactionIds: result.unmatchedActualTransactionIds,
    likelyDuplicates: result.likelyDuplicates,
  };
}

/**
 * Tier 1 — the statement's reference equals an Actual `imported_id`.
 *
 * Pinned before any scoring and removed from the candidate pool: this is an
 * identity match, so no amount of text or date evidence can outrank it.
 */
function pinByImportedId(rows: StatementRow[], index: ActualIndex): MatchOutcome[] {
  const pinned: MatchOutcome[] = [];
  const taken = new Set<string>();

  for (const row of rows) {
    if (!row.reference) continue;
    const transactionId = index.byImportedId.get(row.reference);
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
 * Candidate generation: one hash lookup on the exact signed amount, then a
 * binary-searched date slice. Text is never consulted here — it only ranks
 * candidates that are already financially plausible (RD-071 D9).
 */
function candidatesFor(
  row: StatementRow,
  index: ActualIndex,
  config: MatchConfig
): ActualTransactionSnapshot[] {
  return amountDateSlice(
    index,
    row.amount,
    shiftDate(row.postedDate, -config.dateToleranceDays),
    shiftDate(row.postedDate, config.dateToleranceDays)
  );
}

/** Shift an ISO `YYYY-MM-DD` date by whole days, staying in UTC. */
export function shiftDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(date) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

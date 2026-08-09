/**
 * Globally-consistent assignment (RD-071 D8 / feature spec §15).
 *
 * Per-row greedy is wrong: statement row 1 claims the transaction row 5 needed
 * more. Instead every candidate pair competes in one globally sorted pass, so
 * an Actual transaction can be claimed at most once.
 *
 * Globally-sorted greedy is chosen over an optimal assignment algorithm
 * (Hungarian, O(n³)) deliberately. Candidate sets are tiny after amount+date
 * blocking, so greedy is near-optimal in practice, and it is *explainable*: an
 * optimal solver can pick a locally-worse pair for global reasons, which makes
 * "why did it choose that one?" unanswerable and violates the explainability
 * requirement (feature spec §6/§14).
 */

import type {
  AmbiguousMatch,
  LikelyDuplicate,
  MatchConfig,
  MatchOutcome,
  ScoredCandidate,
} from "../types";

export type AssignmentInput = {
  /** Every scored pair, in any order. */
  candidates: ScoredCandidate[];
  /** Pairs already fixed by an exact `imported_id` hit, which bypass scoring. */
  pinned?: MatchOutcome[];
  statementRowIds: string[];
  actualTransactionIds: string[];
  config: MatchConfig;
};

export type AssignmentResult = {
  matched: MatchOutcome[];
  ambiguous: AmbiguousMatch[];
  unmatchedStatementRowIds: string[];
  unmatchedActualTransactionIds: string[];
  likelyDuplicates: LikelyDuplicate[];
};

/**
 * Near-identical evidence: a losing candidate this close to the winner for the
 * same statement row is a likely duplicate row in Actual rather than a merely
 * weaker match (feature spec §19).
 */
const DUPLICATE_EVIDENCE_DELTA = 3;

export function assignMatches(input: AssignmentInput): AssignmentResult {
  const { candidates, config } = input;
  const consumedStatementRows = new Set<string>();
  const consumedTransactions = new Set<string>();
  const matched: MatchOutcome[] = [];

  for (const pin of input.pinned ?? []) {
    matched.push(pin);
    consumedStatementRows.add(pin.statementRowId);
    consumedTransactions.add(pin.actualTransactionId);
  }

  // Group by statement row first so the ambiguity guard can see each row's
  // full candidate list regardless of global ordering.
  const byStatementRow = new Map<string, ScoredCandidate[]>();
  for (const candidate of candidates) {
    if (consumedStatementRows.has(candidate.statementRowId)) continue;
    if (consumedTransactions.has(candidate.actualTransactionId)) continue;
    const existing = byStatementRow.get(candidate.statementRowId);
    if (existing) existing.push(candidate);
    else byStatementRow.set(candidate.statementRowId, [candidate]);
  }
  for (const list of byStatementRow.values()) list.sort(compareCandidates);

  const ordered = [...byStatementRow.values()].flat().sort(compareCandidates);

  const ambiguousByRow = new Map<string, AmbiguousMatch>();
  const duplicatesByRow = new Map<string, LikelyDuplicate>();

  for (const candidate of ordered) {
    if (consumedStatementRows.has(candidate.statementRowId)) continue;
    if (consumedTransactions.has(candidate.actualTransactionId)) continue;
    if (ambiguousByRow.has(candidate.statementRowId)) continue;

    if (candidate.score < config.autoMatchFloor) {
      // Everything below here for this row is weaker still; surface the whole
      // list so the user can pick rather than silently dropping the row.
      ambiguousByRow.set(candidate.statementRowId, {
        statementRowId: candidate.statementRowId,
        candidates: availableFor(candidate.statementRowId),
        why: "below-floor",
      });
      continue;
    }

    const rivals = availableFor(candidate.statementRowId).filter(
      (other) => other.actualTransactionId !== candidate.actualTransactionId
    );
    const runnerUp = rivals[0];

    if (
      runnerUp &&
      runnerUp.score >= config.autoMatchFloor &&
      candidate.score - runnerUp.score <= config.ambiguityDelta
    ) {
      // Two plausible candidates too close to separate. The matcher must not
      // silently choose between a 94% and a 91% (feature spec §10 Level 3).
      ambiguousByRow.set(candidate.statementRowId, {
        statementRowId: candidate.statementRowId,
        candidates: [candidate, ...rivals],
        why: "close-runner-up",
      });
      continue;
    }

    matched.push({ ...candidate, evidenceSource: "bench" });
    consumedStatementRows.add(candidate.statementRowId);
    consumedTransactions.add(candidate.actualTransactionId);

    // Duplicate detection falls out of one-to-one assignment: a rival with
    // near-identical evidence that lost is a likely duplicate Actual row, not
    // merely a weaker match. This is the SMS/n8n double-entry case.
    const nearIdentical = rivals.filter(
      (rival) =>
        !consumedTransactions.has(rival.actualTransactionId) &&
        candidate.score - rival.score <= DUPLICATE_EVIDENCE_DELTA
    );
    if (nearIdentical.length > 0) {
      duplicatesByRow.set(candidate.statementRowId, {
        statementRowId: candidate.statementRowId,
        keptActualTransactionId: candidate.actualTransactionId,
        duplicateActualTransactionIds: nearIdentical.map((r) => r.actualTransactionId),
      });
    }
  }

  return {
    matched,
    ambiguous: [...ambiguousByRow.values()],
    unmatchedStatementRowIds: input.statementRowIds.filter(
      (id) => !consumedStatementRows.has(id) && !ambiguousByRow.has(id)
    ),
    unmatchedActualTransactionIds: input.actualTransactionIds.filter(
      (id) => !consumedTransactions.has(id)
    ),
    likelyDuplicates: [...duplicatesByRow.values()],
  };

  /** This row's candidates whose Actual side is still free, best first. */
  function availableFor(statementRowId: string): ScoredCandidate[] {
    return (byStatementRow.get(statementRowId) ?? []).filter(
      (candidate) => !consumedTransactions.has(candidate.actualTransactionId)
    );
  }
}

/**
 * Deterministic ordering: score, then date closeness, then ids.
 *
 * The tiebreak chain matters as much as the score — without it, two equally
 * scored pairs could be ordered by map iteration and the same inputs would
 * produce different graphs on different runs.
 */
function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.score !== b.score) return b.score - a.score;

  const aDate = Math.abs(dateDeltaOf(a));
  const bDate = Math.abs(dateDeltaOf(b));
  if (aDate !== bDate) return aDate - bDate;

  if (a.statementRowId !== b.statementRowId) {
    return a.statementRowId < b.statementRowId ? -1 : 1;
  }
  return a.actualTransactionId < b.actualTransactionId ? -1 : 1;
}

function dateDeltaOf(candidate: ScoredCandidate): number {
  for (const reason of candidate.reasons) {
    if (reason.kind === "date") return reason.deltaDays;
  }
  return 0;
}

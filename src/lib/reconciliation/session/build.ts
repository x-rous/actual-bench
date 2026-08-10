/**
 * Build session items from a match graph (RD-071 §5.2).
 *
 * This is the seam between "what matched" and "what the user is being asked to
 * decide". It assigns each statement row and each in-window Actual transaction
 * exactly one item, attaches the guardrail classification, and picks a default
 * disposition.
 *
 * Two defaults are deliberate and must not be "improved" into convenience:
 *
 * - a statement row with no candidate defaults to **unresolved**, not `create`.
 *   Creating a transaction is a write; the user asks for it.
 * - an Actual row absent from the statement defaults to **unresolved**, not
 *   `keep` and never `delete` (feature spec §18). Leaving it unresolved is what
 *   makes the Actual-side coverage number meaningful: every row must be
 *   explained by a person.
 */

import { transferStatusOf } from "../transportAdapter";
import type {
  ActualTransactionSnapshot,
  MatchGraph,
  ReconciliationItem,
  StatementRow,
} from "../types";

export type BuildItemsInput = {
  statementRows: StatementRow[];
  actualTransactions: ActualTransactionSnapshot[];
  graph: MatchGraph;
  /**
   * Whether the transport reported transfer membership for this window. When
   * false, every row's transfer status is `unknown` and the delete guardrail
   * takes its conservative branch (RD-071 D13).
   */
  transfersReported: boolean;
  /**
   * The statement's own period. Transactions loaded outside it come from the
   * candidate padding: the statement makes no claim about those dates, so they
   * are flagged rather than counted as unexplained.
   */
  statementPeriod?: { start: string; end: string } | null;
  /**
   * The range the user asked to see, which may be narrower than the range
   * loaded — matching needs headroom that the user did not ask to look at.
   *
   * An unmatched transaction outside this range gets **no item at all**: with
   * zero padding the user is saying "show me my statement's dates and nothing
   * else", and listing neighbouring transactions anyway would be ignoring them.
   * Matched pairs are always kept, whatever their date.
   */
  visibleWindow?: { start: string; end: string } | null;
  makeId: () => string;
};

/** Reason codes explaining why an item is in its disposition (RD-071 S3). */
export const REASON = {
  ambiguousMatch: "ambiguous-match",
  belowConfidenceFloor: "below-confidence-floor",
  noActualCandidate: "no-actual-candidate",
  notOnStatement: "not-on-statement",
  outsideStatementPeriod: "outside-statement-period",
  likelyDuplicate: "likely-duplicate",
  amountMismatch: "amount-mismatch",
  /** One row left on each side for this merchant and date; amounts disagree. */
  sameMerchantDate: "same-merchant-date",
  /** Several rows left on both sides; the pairing is the user's to make. */
  merchantCluster: "merchant-cluster",
} as const;

const REVIEW_REASON_BY_WHY: Record<string, string> = {
  "close-runner-up": REASON.ambiguousMatch,
  "duplicate-candidates": REASON.likelyDuplicate,
  "below-floor": REASON.belowConfidenceFloor,
  "amount-mismatch": REASON.amountMismatch,
  "same-merchant-date": REASON.sameMerchantDate,
  "merchant-cluster": REASON.merchantCluster,
};

function guardsFor(
  snapshot: ActualTransactionSnapshot | undefined,
  transfersReported: boolean
): ReconciliationItem["guards"] {
  if (!snapshot) {
    return { protectedReconciled: false, splitParent: false, transfer: "no" };
  }
  return {
    // Actual's own reconciliation skips reconciled rows; so does ours.
    protectedReconciled: snapshot.reconciled,
    // A split parent has no meaningful own category — it lives on the children.
    splitParent: snapshot.isParent,
    transfer: transferStatusOf(snapshot, transfersReported),
  };
}

export function buildReconciliationItems(input: BuildItemsInput): ReconciliationItem[] {
  const { graph, transfersReported, makeId } = input;
  const snapshots = new Map(input.actualTransactions.map((t) => [t.id, t]));
  const items: ReconciliationItem[] = [];

  const duplicatesByStatementRow = new Map(
    graph.likelyDuplicates.map((duplicate) => [duplicate.statementRowId, duplicate])
  );
  const duplicateTransactionIds = new Set(
    graph.likelyDuplicates.flatMap((duplicate) => duplicate.duplicateActualTransactionIds)
  );

  for (const outcome of graph.matched) {
    const snapshot = snapshots.get(outcome.actualTransactionId);
    items.push({
      id: makeId(),
      statementRowIds: [outcome.statementRowId],
      actualTransactionIds: [outcome.actualTransactionId],
      match: {
        type: outcome.tier === "reference-imported-id" ? "exact" : "suggested",
        evidenceSource: outcome.evidenceSource,
        confidence: outcome.score,
        label: outcome.label,
        reasons: outcome.reasons,
      },
      disposition: "matched",
      reasonCode: duplicatesByStatementRow.has(outcome.statementRowId)
        ? REASON.likelyDuplicate
        : undefined,
      guards: guardsFor(snapshot, transfersReported),
    });
  }

  for (const ambiguous of graph.ambiguous) {
    // Every competing transaction is referenced so the user can choose one in
    // the inspector without the workbench re-running the matcher.
    items.push({
      id: makeId(),
      statementRowIds: [ambiguous.statementRowId],
      actualTransactionIds: ambiguous.candidates.map((c) => c.actualTransactionId),
      disposition: "unresolved",
      reasonCode: REVIEW_REASON_BY_WHY[ambiguous.why] ?? REASON.belowConfidenceFloor,
      // The guards of the leading candidate, so a review item the user may
      // resolve by correcting an amount carries the same protections a matched
      // item would.
      guards: guardsFor(
        snapshots.get(ambiguous.candidates[0]?.actualTransactionId ?? ""),
        transfersReported
      ),
    });
  }

  for (const statementRowId of graph.unmatchedStatementRowIds) {
    items.push({
      id: makeId(),
      statementRowIds: [statementRowId],
      actualTransactionIds: [],
      // Not `create`: creating a transaction is a write, and the user asks for it.
      disposition: "unresolved",
      reasonCode: REASON.noActualCandidate,
      guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    });
  }

  // A transaction offered as a candidate on an ambiguous item is already on
  // screen and already awaiting a decision. Listing it again as "Actual only"
  // would double-count it and, worse, present a transaction the statement *did*
  // reach as one the statement never mentioned — which is exactly the row a
  // later version might offer to delete.
  const ambiguousCandidateIds = new Set(
    graph.ambiguous.flatMap((entry) => entry.candidates.map((c) => c.actualTransactionId))
  );

  const period = input.statementPeriod ?? null;
  const visible = input.visibleWindow ?? null;
  for (const transactionId of graph.unmatchedActualTransactionIds) {
    if (ambiguousCandidateIds.has(transactionId)) continue;
    const snapshot = snapshots.get(transactionId);

    // Loaded purely as matching headroom and not matched: the user never asked
    // to see it, so it does not become a row.
    if (
      visible != null &&
      snapshot != null &&
      (snapshot.date < visible.start || snapshot.date > visible.end)
    ) {
      continue;
    }

    const outsidePeriod =
      period != null &&
      snapshot != null &&
      (snapshot.date < period.start || snapshot.date > period.end);

    items.push({
      id: makeId(),
      statementRowIds: [],
      actualTransactionIds: [transactionId],
      // Never `delete`, and not silently `keep` — the user explains it.
      disposition: "unresolved",
      reasonCode: outsidePeriod
        ? REASON.outsideStatementPeriod
        : duplicateTransactionIds.has(transactionId)
          ? REASON.likelyDuplicate
          : REASON.notOnStatement,
      guards: guardsFor(snapshot, transfersReported),
    });
  }

  return items;
}

/**
 * Resolve a review item to one transaction, returning the released ones to
 * rows of their own.
 *
 * The invariant is that **every transaction has exactly one row**. It holds
 * after matching, and it has to keep holding after a decision: candidates the
 * user did not pick were only ever visible through the item that offered them,
 * so dropping the reference would make them disappear from the workbench
 * entirely — present in the budget, absent from the screen, impossible to
 * decide about.
 *
 * Releasing them is also what makes "none of these" work without inventing a
 * deferred-cleanup rule: the leftovers simply become ordinary rows to keep or
 * delete.
 */
export function resolveToTransaction(input: {
  item: ReconciliationItem;
  /** The transaction the user picked, or null for "none of these". */
  transactionId: string | null;
  transactions: Map<string, ActualTransactionSnapshot>;
  transfersReported: boolean;
  makeId: () => string;
}): { item: ReconciliationItem; released: ReconciliationItem[] } {
  const { item, transactionId, transactions, transfersReported, makeId } = input;

  const releasedIds = item.actualTransactionIds.filter((id) => id !== transactionId);
  const released = releasedIds.map((id) => ({
    id: makeId(),
    statementRowIds: [],
    actualTransactionIds: [id],
    // Never `delete`: the user declined to match it, which is not the same as
    // asking for it to be removed.
    disposition: "unresolved" as const,
    reasonCode: REASON.notOnStatement,
    guards: guardsFor(transactions.get(id), transfersReported),
  }));

  const resolved: ReconciliationItem = transactionId
    ? {
        ...item,
        actualTransactionIds: [transactionId],
        disposition: "matched",
        reasonCode: undefined,
        match: {
          type: "manual",
          evidenceSource: "manual",
          label: "exact",
          reasons: [],
        },
      }
    : {
        ...item,
        actualTransactionIds: [],
        // Back to undecided rather than straight to create: declining these
        // candidates is not the same as asking for a new transaction.
        disposition: "unresolved",
        reasonCode: REASON.noActualCandidate,
        match: undefined,
        guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
      };

  return { item: resolved, released };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * What became of each side.
 *
 * The question a reconciliation has to answer is not "what is the status of
 * each row" but "how much of my statement is accounted for, and what is in
 * Actual on top of it". So each side is reported as a total that its parts sum
 * to exactly — a number that does not add up is worse than no number.
 */
export type SideCoverage = {
  /** Rows on this side that have a row in the workbench. */
  total: number;
  /** Paired with the other side. */
  matched: number;
  /** Has a candidate, but needs a person to decide. */
  needsReview: number;
  /** Statement: nothing in Actual. Actual: nothing on the statement. */
  unaccounted: number;
};

/**
 * Progress through the work, as distinct from coverage of the statement.
 *
 * Coverage answers "how much of the statement is accounted for". This answers
 * "how much is left for me to do", which is the question someone actually
 * working through a reconciliation is asking.
 */
export type DecisionProgress = {
  /** Rows that needed a person and have had one. */
  decided: number;
  /** Rows still waiting on a decision. */
  pending: number;
  /** Rows that never needed a decision, because the matcher settled them. */
  automatic: number;
};

export type ReconciliationCoverage = {
  statement: SideCoverage;
  actual: SideCoverage;
  decisions: DecisionProgress;
  /** Actual rows dated outside the statement's own period. */
  outsideStatementPeriod: number;
  likelyDuplicates: number;
  /**
   * Loaded only as matching headroom and never shown. Reported so the Actual
   * total is explainable rather than mysteriously smaller than the account.
   */
  loadedAsHeadroom: number;
};

const REVIEW_REASONS = new Set<string>([
  REASON.ambiguousMatch,
  REASON.belowConfidenceFloor,
  REASON.amountMismatch,
  REASON.sameMerchantDate,
  REASON.merchantCluster,
]);

export function summarizeCoverage(
  items: ReconciliationItem[],
  totals: { statementRows: number; loadedTransactions: number }
): ReconciliationCoverage {
  const statement: SideCoverage = { total: 0, matched: 0, needsReview: 0, unaccounted: 0 };
  const actual: SideCoverage = { total: 0, matched: 0, needsReview: 0, unaccounted: 0 };
  const decisions: DecisionProgress = { decided: 0, pending: 0, automatic: 0 };
  let outsideStatementPeriod = 0;
  let likelyDuplicates = 0;

  // Counted per transaction, not per item: one review item can offer several
  // candidates, and each of those is a transaction the user still has to place.
  const seenTransactions = new Set<string>();

  for (const item of items) {
    const statementCount = item.statementRowIds.length;
    const transactionIds = item.actualTransactionIds.filter((id) => !seenTransactions.has(id));
    for (const id of transactionIds) seenTransactions.add(id);

    statement.total += statementCount;
    actual.total += transactionIds.length;

    if (item.disposition === "matched") {
      statement.matched += statementCount;
      actual.matched += transactionIds.length;
    } else if (REVIEW_REASONS.has(item.reasonCode ?? "")) {
      statement.needsReview += statementCount;
      actual.needsReview += transactionIds.length;
    } else {
      statement.unaccounted += statementCount;
      actual.unaccounted += transactionIds.length;
    }

    if (item.reasonCode === REASON.outsideStatementPeriod) {
      outsideStatementPeriod += transactionIds.length;
    }
    if (item.reasonCode === REASON.likelyDuplicate) likelyDuplicates += 1;

    // An automatic match nobody has touched is not "decided" — it never needed
    // deciding. Counting it as done would flatter the progress number and hide
    // how much work is actually left.
    if (item.disposition === "matched" && item.match?.evidenceSource !== "manual") {
      decisions.automatic += 1;
    } else if (item.disposition === "unresolved") {
      decisions.pending += 1;
    } else {
      decisions.decided += 1;
    }
  }

  return {
    statement: { ...statement, total: totals.statementRows || statement.total },
    actual,
    decisions,
    outsideStatementPeriod,
    likelyDuplicates,
    loadedAsHeadroom: Math.max(0, totals.loadedTransactions - actual.total),
  };
}

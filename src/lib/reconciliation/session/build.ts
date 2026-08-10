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
} as const;

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
      reasonCode:
        ambiguous.why === "close-runner-up"
          ? REASON.ambiguousMatch
          : ambiguous.why === "amount-mismatch"
            ? REASON.amountMismatch
            : REASON.belowConfidenceFloor,
      guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
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

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * Two independent completeness questions (UX §30, V2 §4):
 *
 * - does every statement row have a resolution?
 * - is every in-window Actual row explained?
 *
 * A single "96.8% matched" figure hides an unexplained Actual side, so both are
 * reported.
 */
export type ReconciliationCoverage = {
  statementRows: number;
  statementRowsResolved: number;
  actualTransactions: number;
  actualTransactionsExplained: number;
  matched: number;
  create: number;
  keep: number;
  delete: number;
  unresolved: number;
  ignored: number;
  likelyDuplicates: number;
  /**
   * Loaded only because of the candidate padding, and outside the statement's
   * own dates. Reported separately so they do not read as unexplained.
   */
  outsideStatementPeriod: number;
};

const RESOLVED_DISPOSITIONS = new Set(["matched", "create", "keep", "delete", "ignored"]);

export function summarizeCoverage(
  items: ReconciliationItem[],
  totals: { statementRows: number; actualTransactions: number }
): ReconciliationCoverage {
  const coverage: ReconciliationCoverage = {
    statementRows: totals.statementRows,
    statementRowsResolved: 0,
    actualTransactions: totals.actualTransactions,
    actualTransactionsExplained: 0,
    matched: 0,
    create: 0,
    keep: 0,
    delete: 0,
    unresolved: 0,
    ignored: 0,
    likelyDuplicates: 0,
    outsideStatementPeriod: 0,
  };

  for (const item of items) {
    if (item.reasonCode === REASON.outsideStatementPeriod) {
      // The statement says nothing about these dates, so they are neither
      // resolved nor a gap — they are excluded from both sides of the ratio.
      coverage.outsideStatementPeriod += 1;
      coverage.actualTransactions = Math.max(0, coverage.actualTransactions - 1);
      continue;
    }
    const resolved = RESOLVED_DISPOSITIONS.has(item.disposition);
    if (resolved) {
      coverage.statementRowsResolved += item.statementRowIds.length;
      // An ambiguous item references several candidate transactions but
      // explains at most the one it settles on, so count the resolved side only.
      coverage.actualTransactionsExplained += Math.min(item.actualTransactionIds.length, 1);
    }

    switch (item.disposition) {
      case "matched":
        coverage.matched += 1;
        break;
      case "create":
        coverage.create += 1;
        break;
      case "keep":
        coverage.keep += 1;
        break;
      case "delete":
        coverage.delete += 1;
        break;
      case "ignored":
        coverage.ignored += 1;
        break;
      default:
        coverage.unresolved += 1;
    }

    if (item.reasonCode === REASON.likelyDuplicate) coverage.likelyDuplicates += 1;
  }

  return coverage;
}

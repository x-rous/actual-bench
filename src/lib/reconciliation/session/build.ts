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
  makeId: () => string;
};

/** Reason codes explaining why an item is in its disposition (RD-071 S3). */
export const REASON = {
  ambiguousMatch: "ambiguous-match",
  belowConfidenceFloor: "below-confidence-floor",
  noActualCandidate: "no-actual-candidate",
  notOnStatement: "not-on-statement",
  likelyDuplicate: "likely-duplicate",
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

  for (const transactionId of graph.unmatchedActualTransactionIds) {
    const snapshot = snapshots.get(transactionId);
    items.push({
      id: makeId(),
      statementRowIds: [],
      actualTransactionIds: [transactionId],
      // Never `delete`, and not silently `keep` — the user explains it.
      disposition: "unresolved",
      reasonCode: duplicateTransactionIds.has(transactionId)
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
  };

  for (const item of items) {
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

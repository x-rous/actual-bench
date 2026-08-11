/**
 * The operation list Apply executes (RD-071 S6, feature spec §38/§39).
 *
 * An open union: V1 emits `create`, `update` and `delete` only, but the deferred
 * native-import path becomes another member rather than a second pipeline.
 *
 * Every operation is explicit. A matched row with nothing staged produces **no
 * operation at all** — "reconciled" and "written to" are different things, and
 * conflating them is how a review screen ends up claiming 248 changes when 12
 * were meant (feature spec §39).
 */

import type { MinorUnitAmount, StagedPatch } from "../types";

export type OperationKind = "create" | "update" | "delete";

type OperationBase = {
  /** Stable within a plan, so a retry can address the same operation. */
  id: string;
  kind: OperationKind;
  /** The reconciliation item this came from. */
  itemId: string;
};

export type CreateOperation = OperationBase & {
  kind: "create";
  statementRowId: string;
  accountId: string;
  date: string;
  amount: MinorUnitAmount;
  payeeName: string | null;
  payeeId: string | null;
  categoryId: string | null;
  notes: string | null;
  /** Marked as cleared on creation, when the user asked for that. */
  cleared?: boolean;
  /**
   * Deterministic marker derived from the session and the statement row
   * (RD-071 D14). It is what makes a retry after a partial failure safe: the
   * same row always yields the same marker, so a create that already succeeded
   * is recognised rather than repeated.
   *
   * Opaque equality key — never parsed, following the Budget File Sync rule.
   */
  marker: string;
};

export type UpdateOperation = OperationBase & {
  kind: "update";
  transactionId: string;
  accountId: string;
  /** Unchanged fields the transport needs to identify/echo the row. */
  date: string;
  amount: MinorUnitAmount;
  /** Only the fields that actually differ. */
  patch: StagedPatch;
  /**
   * Set when the update exists to mark the transaction cleared.
   *
   * An update may carry this and nothing else: confirming that a transaction
   * appeared on the statement is a change worth making even when none of its
   * fields differ.
   */
  cleared?: boolean;
};

export type DeleteOperation = OperationBase & {
  kind: "delete";
  transactionId: string;
  accountId: string;
  /** Carried for the review screen and the audit trail. */
  date: string;
  amount: MinorUnitAmount;
};

export type ApplyOperation = CreateOperation | UpdateOperation | DeleteOperation;

export type OperationStatus = "pending" | "applied" | "failed" | "skipped";

export type OperationResult = {
  operationId: string;
  status: OperationStatus;
  /** Transaction id created or affected, when known. */
  transactionId?: string | null;
  error?: string;
  /** Why an operation was not attempted. */
  skippedBecause?: string;
};

/**
 * What Apply is about to do, in the shape the review screen reads.
 *
 * Counts are derived from the operations rather than tracked alongside them, so
 * the summary cannot drift from the work.
 */
export type ApplyPlan = {
  operations: ApplyOperation[];
  /**
   * Operations an earlier run already wrote.
   *
   * Excluded from `operations` rather than merely marked, because the plan is
   * what the review screen counts and what the executor runs: leaving them in
   * would offer to apply an applied session all over again.
   */
  alreadyApplied: number;
  /** Statement rows that are reconciled but need no write. */
  noWriteMatches: number;
  /** Rows the user has not decided yet; Apply does not touch them. */
  unresolved: number;
  /** Rows a guardrail refused to stage, with the reason. */
  blocked: { itemId: string; reason: string }[];
};

/**
 * Fold a run's outcomes into the session's existing record.
 *
 * A retry runs only what did not succeed, so its results describe a fraction of
 * the session. Storing them as *the* record would erase every operation that
 * already worked — and since the plan excludes operations it knows were
 * applied, erasing that knowledge brings the applied work back as work still to
 * do. A second Apply would then rewrite transactions that were already correct.
 *
 * The later outcome for an operation wins; everything else is carried forward,
 * in its original order so the record reads chronologically.
 */
export function mergeOperationResults(
  previous: OperationResult[],
  next: OperationResult[]
): OperationResult[] {
  const byId = new Map(previous.map((entry) => [entry.operationId, entry]));
  const merged = [...previous];

  for (const entry of next) {
    const existing = byId.get(entry.operationId);
    if (existing) {
      merged[merged.indexOf(existing)] = entry;
      byId.set(entry.operationId, entry);
    } else {
      merged.push(entry);
      byId.set(entry.operationId, entry);
    }
  }

  return merged;
}

/** Totals across a set of outcomes, for the result screen and the session status. */
export function summarizeResults(results: OperationResult[]): {
  applied: number;
  failed: number;
  skipped: number;
  complete: boolean;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const entry of results) {
    if (entry.status === "applied") applied += 1;
    else if (entry.status === "failed") failed += 1;
    else if (entry.status === "skipped") skipped += 1;
  }
  return { applied, failed, skipped, complete: failed === 0 };
}

export function planCounts(plan: ApplyPlan): Record<OperationKind, number> {
  const counts: Record<OperationKind, number> = { create: 0, update: 0, delete: 0 };
  for (const operation of plan.operations) counts[operation.kind] += 1;
  return counts;
}

/**
 * What applying will do to the account's balance, in integer minor units.
 *
 * Derived from the plan alone, since every operation carries the amounts it
 * moves: a created transaction adds its own amount, a deleted one removes the
 * amount it was contributing, and a corrected one contributes only the
 * difference between what it said and what it will say.
 *
 * Worth stating before the fact: a reconciliation that changes the balance is
 * doing something the user should have agreed to knowingly.
 */
export function balanceImpact(plan: ApplyPlan): MinorUnitAmount {
  let delta = 0;
  for (const operation of plan.operations) {
    switch (operation.kind) {
      case "create":
        delta += operation.amount;
        break;
      case "delete":
        // Removing a transaction reverses whatever it was contributing.
        delta -= operation.amount;
        break;
      case "update": {
        const amount = operation.patch.amount;
        if (amount) delta += amount.staged - amount.original;
        break;
      }
    }
  }
  return delta;
}

/** Total writes, i.e. what the Apply button should name (feature spec §38). */
export function totalChanges(plan: ApplyPlan): number {
  return plan.operations.length;
}

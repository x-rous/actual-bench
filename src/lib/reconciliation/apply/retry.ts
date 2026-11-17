/**
 * What an earlier, interrupted Apply already created — the half of retry
 * safety that runs before anything is written.
 *
 * Pure, so the view only does the reading. Apply and recovery used to carry
 * their own copies of this marker logic, and they had already drifted.
 */

import type { ActualTransactionSnapshot } from "../types";
import { markersOf, type ApplyPlan, type CreateOperation, type OperationResult } from "./operations";
import { verifyApply } from "./verification";

/** A create is looked for under its legacy marker only when it was attempted before. */
function markersToLookFor(operation: CreateOperation, previousResults: OperationResult[]): string[] {
  return previousResults.some((entry) => entry.operationId === operation.id)
    ? markersOf(operation)
    : [operation.marker];
}

/** Markers worth a targeted read: creates an earlier attempt may have made outside the window. */
export function retryMarkers(plan: ApplyPlan, previousResults: OperationResult[]): string[] {
  return plan.operations.flatMap((operation) =>
    operation.kind === "create" && previousResults.some((entry) => entry.operationId === operation.id)
      ? markersOf(operation)
      : []
  );
}

/**
 * Check every create Actual already holds against the approved plan. A row
 * that differs, or appears twice, stops the retry: writing around it would
 * build on something nobody approved.
 */
export function checkEarlierCreates(input: {
  plan: ApplyPlan;
  previousResults: OperationResult[];
  /** The candidate window plus anything `retryMarkers` found. */
  rows: ActualTransactionSnapshot[];
  snapshots: Map<string, ActualTransactionSnapshot>;
}): { ok: boolean } {
  const existing = input.plan.operations.filter(
    (operation): operation is CreateOperation =>
      operation.kind === "create" &&
      input.rows.some((row) => markersToLookFor(operation, input.previousResults).includes(row.importedId ?? ""))
  );
  const report = verifyApply({
    plan: { ...input.plan, operations: existing },
    results: existing.map((operation) => ({ operationId: operation.id, status: "applied" })),
    latest: input.rows,
    snapshots: input.snapshots,
  });
  return { ok: report.ok };
}

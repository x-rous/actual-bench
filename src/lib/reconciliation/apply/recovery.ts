import type { ActualTransactionSnapshot } from "../types";
import { markersOf, type ApplyPlan, type OperationResult } from "./operations";
import { verifyApply } from "./verification";

/** Read-back evidence for a stopped Apply. Never performs or guesses a write. */
export function recoverApply(input: {
  plan: ApplyPlan;
  latest: ActualTransactionSnapshot[];
  snapshots: Map<string, ActualTransactionSnapshot>;
}): OperationResult[] {
  const byMarker = new Map<string, ActualTransactionSnapshot[]>();
  for (const row of input.latest) if (row.importedId) {
    const rows = byMarker.get(row.importedId) ?? [];
    rows.push(row); byMarker.set(row.importedId, rows);
  }
  const expected: OperationResult[] = input.plan.operations.map((operation) => ({ operationId: operation.id, status: "applied",
    transactionId: operation.kind === "create" ? markersOf(operation).map((marker) => byMarker.get(marker)?.[0]?.id).find(Boolean) ?? null : operation.transactionId }));
  const report = verifyApply({ ...input, results: expected });
  const issues = new Map<string, string[]>();
  for (const issue of report.issues) {
    const details = issues.get(issue.operationId) ?? [];
    details.push(issue.detail); issues.set(issue.operationId, details);
  }
  return expected.map((result) => {
    const details = issues.get(result.operationId);
    return !details ? { ...result, status: "skipped", skippedBecause: "Confirmed in Actual during recovery." }
      : { ...result, status: "failed", error: "Not confirmed in Actual. Review before retrying. " + details.join(" ") };
  });
}

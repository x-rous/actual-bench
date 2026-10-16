import type { ActivitySnapshot } from "./activity";
import type { Statement, Workspace } from "./models";
import { statementReview } from "./statements";

/** Current evidence state shared by list badges, filters, actions and workspace counts. */
export function statementHealth(statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot | undefined, available: boolean) {
  const state = (key: string, label: string, rank: number, action: "Confirm" | "Review" | "Verify" | "View", issue = true) => ({ key, label, rank, action, issue });
  if (!statement.bankConfirmed) return state("estimate", "Estimated", 0, "Confirm", false);
  if (!available || !snapshot) return state("unavailable", "Awaiting data", 1, "Review");
  const review = statementReview(statement, workspace, snapshot);
  if (!review.coverage) return state("unavailable", "Awaiting data", 1, "Review");
  if (review.stale) return state("changed", "Source changed", 2, "Review");
  if (review.duplicate || review.unresolved) return state("review", "Needs review", 3, "Review");
  if (review.startingBalanceMinor === null) return state("opening", statement.openingAnchor ? "Opening balance missing" : "Previous balance missing", 4, "Review");
  if (review.varianceMinor !== 0) return state("mismatch", "Balance difference", 5, "Review");
  if (statement.verification === "verified") return state("verified", "Verified", 7, "View", false);
  return state("ready", "Ready to verify", 6, "Verify");
}

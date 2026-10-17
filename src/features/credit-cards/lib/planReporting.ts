import { costFamily } from "./recognition";
import { activityKind, type ActivityRow, type ActivitySnapshot } from "./activity";
import type { Card, Statement, Workspace } from "./models";
import { currentPlanLink } from "./plans";
import { statementReview, sumMinor } from "./statements";

/** Mutually exclusive cycle flows, integer minor units. Cost reversals net against costs once. */
export function statementChargeBreakdown(card: Card, statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot) {
  const review = statementReview(statement, workspace, snapshot);
  if (!review.coverage || review.unresolved || review.duplicate) return null;
  const rows = review.rows.filter((_, index) => review.memberships[index].decision === "included");
  const isCost = (row: ActivityRow) => costFamily(activityKind(row, card, workspace, snapshot)) !== null;
  const isPlanCharge = (row: ActivityRow) => !isCost(row) && (["instalment-billed", "combined-instalment", "principal-release"].includes(currentPlanLink(workspace, row)?.role ?? "") || activityKind(row, card, workspace, snapshot) === "plan-instalment");
  const sum = (predicate: (row: ActivityRow) => boolean) => sumMinor(rows.filter(predicate).map((row) => -row.amountMinor));
  return {
    cyclePaymentsMinor: -sum((row) => row.amountMinor > 0 && activityKind(row, card, workspace, snapshot) === "payment"),
    newChargesMinor: sum((row) => row.amountMinor < 0 && !isPlanCharge(row) && !isCost(row)),
    planChargesMinor: sum((row) => row.amountMinor < 0 && isPlanCharge(row)),
    planFeesMinor: sum((row) => ["plan-fee", "plan-interest"].includes(currentPlanLink(workspace, row)?.role ?? "")),
    otherCostsMinor: sum(isCost),
    creditsMinor: -sum((row) => row.amountMinor > 0 && !isCost(row) && activityKind(row, card, workspace, snapshot) !== "payment"),
  };
}

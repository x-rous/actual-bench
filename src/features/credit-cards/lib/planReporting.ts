import { costFamily } from "./recognition";
import { financingCostKind, trackedCardDebt } from "./planTracking";
import { activityKind, paymentEvidence, type ActivityRow, type ActivitySnapshot } from "./activity";
import type { Card, Statement, Workspace } from "./models";
import { currentPlanLink, planSchedule, planHealth, planProjection, planSources } from "./plans";
import { effectiveActivityDate } from "./repayments";
import { netActivitySinceStatement } from "./insights";
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
    newChargesMinor: sum((row) => row.amountMinor < 0 && !isPlanCharge(row) && !isCost(row)),
    planChargesMinor: sum((row) => row.amountMinor < 0 && isPlanCharge(row)),
    planFeesMinor: sum((row) => ["plan-fee", "plan-interest"].includes(currentPlanLink(workspace, row)?.role ?? "")),
    otherCostsMinor: sum(isCost),
    creditsMinor: -sum((row) => row.amountMinor > 0 && !isCost(row) && activityKind(row, card, workspace, snapshot) !== "payment"),
  };
}

/** Conservative debt attribution, all amounts integer minor units. Mixed payments remain explicitly unallocated.
 * Only recorded activity enters the bridge. Future billing expectations are disclosed separately and never added to recorded debt.
 */
function postedPlanDebtBreakdown(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, signedCurrentMinor: number, today: string) {
  const plans = workspace.plans?.filter((plan) => plan.cardId === card.id) ?? [];
  const futureKnown = plans.filter((plan) => plan.status === "active").every((plan) => planProjection(plan, card).calculated);
  const futureNeedsReview = plans.some((plan) => plan.status === "active" && planHealth(plan, workspace, snapshot, today).reasons.length > 0);
  const anchor = workspace.statements.filter((entry) => entry.cardId === card.id && entry.bankConfirmed && entry.openingAnchor).sort((a, b) => a.closingDate.localeCompare(b.closingDate))[0];
  const futureMinor = sumMinor(plans.filter((plan) => plan.status === "active").flatMap((plan) => {
    const links = workspace.planLinks?.filter((link) => link.planId === plan.id) ?? [];
    return planSchedule(plan, card, links).filter((entry) => !links.some((link) => ["instalment-billed", "combined-instalment"].includes(link.role) && link.instalment === entry.index && snapshot.rows.some((row) => row.id === link.transactionId && row.fingerprint === link.fingerprint && row.cleared === true))).map((entry) => entry.amountMinor);
  }));
  if (!anchor) return { known: false as const, futureMinor, futureKnown, futureNeedsReview };
  const bridge = netActivitySinceStatement(card, anchor, workspace, snapshot, signedCurrentMinor, today);
  if (!bridge.covered) return { known: false as const, futureMinor, futureKnown, futureNeedsReview };
  const origins: { id: string; planId?: string; amount: number }[] = [];
  let unknownMinor = Math.max(0, anchor.officialBalanceMinor), unallocatedMinor = Math.max(0, -anchor.officialBalanceMinor);
  let pendingPlanMinor = 0, pendingOtherMinor = 0, pendingCreditMinor = 0;
  const total = () => sumMinor([unknownMinor, ...origins.map((origin) => origin.amount)]);
  function reduceCredit(amount: number) {
    const left = total();
    if (amount >= left) { for (const origin of origins) origin.amount = 0; unknownMinor = 0; unallocatedMinor = sumMinor([unallocatedMinor, amount - left]); return; }
    const buckets = new Set<string>(origins.filter((origin) => origin.amount > 0).map((origin) => origin.planId ? "plan" : "other"));
    if (unknownMinor > 0) buckets.add("unknown");
    // Attribution within one bucket is immaterial to the displayed split. Across buckets it is unknown.
    if (buckets.size > 1) { unallocatedMinor = sumMinor([unallocatedMinor, amount]); return; }
    let remaining = amount;
    const unknownOffset = Math.min(unknownMinor, remaining); unknownMinor -= unknownOffset; remaining -= unknownOffset;
    for (const origin of origins) { const part = Math.min(origin.amount, remaining); origin.amount -= part; remaining -= part; }
  }
  const rows = [...bridge.rows].sort((a, b) => effectiveActivityDate(a, card.id, workspace).localeCompare(effectiveActivityDate(b, card.id, workspace)) || Number(a.amountMinor > 0) - Number(b.amountMinor > 0) || a.id.localeCompare(b.id));
  for (const row of rows) {
    const link = currentPlanLink(workspace, row);
    const stalePlanEvidence = plans.some((plan) => planSources(plan).some((source) => source.transactionId === row.id && source.fingerprint !== row.fingerprint)) || workspace.planLinks?.some((entry) => entry.transactionId === row.id && entry.fingerprint !== row.fingerprint);
    const sourcePlan = plans.find((plan) => planSources(plan).some((source) => source.transactionId === row.id && source.fingerprint === row.fingerprint));
    // A fee may be linked to the agreement, but it is an expense rather than principal.
    const cost = financingCostKind(row, card, workspace) !== null || costFamily(activityKind(row, card, workspace, snapshot)) !== null;
    const planId = cost ? undefined : link?.planId ?? sourcePlan?.id;
    const pending = row.cleared !== true || activityKind(row, card, workspace, snapshot) === "payment" && paymentEvidence(row, snapshot, workspace) !== "confirmed";
    if (pending) {
      if (row.amountMinor > 0) pendingCreditMinor = sumMinor([pendingCreditMinor, row.amountMinor]);
      else if (planId) pendingPlanMinor = sumMinor([pendingPlanMinor, -row.amountMinor]);
      else pendingOtherMinor = sumMinor([pendingOtherMinor, -row.amountMinor]);
      continue;
    }
    if (row.amountMinor < 0) {
      if (stalePlanEvidence) { unknownMinor = sumMinor([unknownMinor, -row.amountMinor]); continue; }
      const converted = sourcePlan ? Math.min(sourcePlan.amountMinor, -row.amountMinor) : planId ? -row.amountMinor : 0;
      if (converted) origins.push({ id: row.id, planId, amount: converted });
      if (-row.amountMinor > converted) origins.push({ id: row.id, amount: -row.amountMinor - converted });
      continue;
    }
    if (link?.role === "conversion-credit") {
      const source = plans.find((plan) => plan.id === link.planId);
      const ids = new Set(source ? planSources(source).map((entry) => entry.transactionId) : []);
      let remaining = row.amountMinor;
      for (const origin of origins.filter((entry) => ids.has(entry.id) && entry.planId === source?.id)) {
        const offset = Math.min(origin.amount, remaining); origin.amount -= offset; remaining -= offset;
      }
      unallocatedMinor = sumMinor([unallocatedMinor, remaining]);
    } else if (link?.role === "refund") {
      let amount = row.amountMinor;
      for (const origin of origins.filter((entry) => entry.planId === link.planId)) { const part = Math.min(amount, origin.amount); origin.amount -= part; amount -= part; }
      unallocatedMinor = sumMinor([unallocatedMinor, amount]);
    } else reduceCredit(row.amountMinor);
    if (unallocatedMinor >= total() && total() > 0) { const offset = total(); for (const origin of origins) origin.amount = 0; unknownMinor = 0; unallocatedMinor -= offset; }
  }
  const planMinor = sumMinor(origins.filter((origin) => origin.planId).map((origin) => origin.amount));
  const otherMinor = sumMinor(origins.filter((origin) => !origin.planId).map((origin) => origin.amount));
  const calculated = sumMinor([planMinor, otherMinor, unknownMinor, pendingPlanMinor, pendingOtherMinor, -unallocatedMinor, -pendingCreditMinor]);
  return { known: true as const, planMinor, otherMinor, unknownMinor, unallocatedMinor, pendingPlanMinor, pendingOtherMinor, pendingCreditMinor, differenceMinor: bridge.currentOwedMinor - calculated, futureMinor, futureKnown, futureNeedsReview };
}

/** Adds only the liability assigned to this card; the card ledger already contains billed instalments. */
export function planDebtBreakdown(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, signedCurrentMinor: number, today: string) {
  const posted = postedPlanDebtBreakdown(card, workspace, snapshot, signedCurrentMinor, today);
  const tracking = trackedCardDebt(card, workspace, snapshot, signedCurrentMinor - (snapshot.futureDeltaMinor ?? 0), today);
  return { ...posted, ...(posted.known && tracking.tracked && tracking.known ? { planMinor: sumMinor([posted.planMinor, tracking.trackingMinor]) } : {}), tracking: tracking.tracked ? tracking : undefined };
}

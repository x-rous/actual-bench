import type { ActivitySnapshot, ActivityRow } from "./activity";
import { activityKind } from "./activity";
import type { Card, Workspace } from "./models";
import { statementReview, sumMinor } from "./statements";
import { settlements } from "./repayments";

/** Missing mappings cannot establish that all unclassified outflows were purchases. */
export function chargeClassificationKnown(card: Card, workspace: Workspace, rows: ActivityRow[], kind: "interest" | "fee") {
  if (kind === "interest" ? card.interestCategoryId : card.feeCategoryId) return true;
  return rows.filter((row) => row.amountMinor < 0 && !row.transferId && row.cleared === true).every((row) => workspace.classifications.some((entry) => entry.cardId === card.id && entry.transactionId === row.id && entry.fingerprint === row.fingerprint));
}

/** Observed charges require explicit classification; purchases are not guessed to be interest. */
export function statementHistory(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string) {
  const statuses = settlements(card, workspace, snapshot, today);
  return workspace.statements.filter((entry) => entry.cardId === card.id).sort((a, b) => b.closingDate.localeCompare(a.closingDate)).map((statement) => {
    const review = statementReview(statement, workspace, snapshot);
    const rows = review.rows.filter((_, index) => review.memberships[index].decision === "included");
    const classified = (kind: string) => sumMinor(rows.filter((row) => activityKind(row, card, workspace, snapshot) === kind && row.cleared === true).map((row) => Math.abs(row.amountMinor)));
    const covered = snapshot.from <= statement.periodStart && snapshot.to >= statement.closingDate && !snapshot.issues.length && review.unresolved === 0 && !review.duplicate;
    const interestKnown = chargeClassificationKnown(card, workspace, rows, "interest");
    const feesKnown = chargeClassificationKnown(card, workspace, rows, "fee");
    return { statement, covered, interestMinor: covered && interestKnown ? classified("interest") : null, feesMinor: covered && feesKnown ? classified("fee") : null, spendingMinor: covered && interestKnown && feesKnown ? sumMinor([classified("purchase"), classified("cash-advance")]) : null, refundsMinor: covered ? classified("refund") : null,
      utilization: card.creditLimitMinor && card.creditLimitMinor > 0 ? Math.max(0, statement.officialBalanceMinor) / card.creditLimitMinor * 100 : null,
      settlement: statuses.find((entry) => entry.statementId === statement.id)!,
    };
  });
}

/** Partial APR coverage is reported, never filled using another card's rate. */
export function portfolio(cards: Card[], balances: Map<string, { debtMinor: number; creditMinor: number }>) {
  const available = cards.filter((card) => balances.has(card.accountId));
  const debtMinor = sumMinor(available.map((card) => balances.get(card.accountId)!.debtMinor));
  const creditMinor = sumMinor(available.map((card) => balances.get(card.accountId)!.creditMinor));
  const withApr = available.filter((card) => card.purchaseAprBps !== null);
  const aprCoveredDebtMinor = sumMinor(withApr.map((card) => balances.get(card.accountId)!.debtMinor));
  const weighted = withApr.reduce((sum, card) => sum + BigInt(balances.get(card.accountId)!.debtMinor) * BigInt(card.purchaseAprBps!), BigInt(0));
  const weightedAprBps = aprCoveredDebtMinor ? Number((weighted + BigInt(aprCoveredDebtMinor) / BigInt(2)) / BigInt(aprCoveredDebtMinor)) : null;
  return { debtMinor, creditMinor, weightedAprBps, aprCoveredDebtMinor, balanceCoverage: available.length, totalCards: cards.length };
}


export function minimumPaymentStreak(statuses: ReturnType<typeof settlements>, today: string) {
  let count = 0;
  for (const status of statuses.filter((entry) => entry.dueDate < today).reverse()) {
    if (status.minimumByDue === null || status.provisionalMinor > 0) break;
    if (!status.minimumByDue) break;
    count += 1;
  }
  return count;
}

/** Integer minor-unit cumulative charges, never interest paid or a sum across coverage gaps. */
export function cumulativeInterestCharges(history: ReturnType<typeof statementHistory>) {
  if (history.some((entry) => entry.interestMinor === null)) return [];
  let totalMinor = 0;
  return [...history].reverse().map((entry) => {
    totalMinor = sumMinor([totalMinor, entry.interestMinor!]);
    return { date: entry.statement.closingDate, value: totalMinor };
  });
}

/** Reporting covers only available activity, using Actual posting dates. */
export function observedInterestTotals(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string) {
  const from = snapshot.from;
  const to = snapshot.to < today ? snapshot.to : today;
  const rows = snapshot.rows.filter((row) => row.date >= from && row.date <= to);
  const interest = rows.filter((row) => row.cleared === true && activityKind(row, card, workspace, snapshot) === "interest");
  return { classificationKnown: snapshot.issues.length === 0 && chargeClassificationKnown(card, workspace, rows, "interest"), totalMinor: sumMinor(interest.map((row) => -row.amountMinor)), from, to };
}

/** Billing-cycle bridge in integer minor units, including recorded pending activity.
 * Repayments after closing belong to settlement and must never enter this bridge. */
export function statementMovement(card: Card, statement: Workspace["statements"][number], workspace: Workspace, snapshot: ActivitySnapshot) {
  const review = statementReview(statement, workspace, snapshot);
  const rows = review.rows.filter((_, index) => review.memberships[index].decision === "included");
  const prior = workspace.statements.filter((entry) => entry.cardId === card.id && entry.bankConfirmed && entry.closingDate < statement.closingDate).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
  const recordedRows = rows.map((row) => ({ ...row, cleared: true }));
  const known = review.coverage && !review.unresolved && !review.duplicate && chargeClassificationKnown(card, workspace, recordedRows, "interest") && chargeClassificationKnown(card, workspace, recordedRows, "fee");
  const amount = (kinds: string[]) => known ? sumMinor(rows.filter((row) => kinds.includes(activityKind(row, card, workspace, snapshot))).map((row) => -row.amountMinor)) : null;
  const unavailableReason = !review.coverage ? "Load activity for the full billing cycle" : review.unresolved ? `Review ${review.unresolved} transaction decisions` : review.duplicate ? "Resolve overlapping statement decisions" : !known ? "Set charge categories or classify transactions" : null;
  return { unavailableReason, openingMinor: review.continuity ? prior?.officialBalanceMinor ?? null : null, purchasesMinor: amount(["purchase", "cash-advance"]), interestMinor: amount(["interest"]), feesMinor: amount(["fee"]), paymentsMinor: amount(["payment"]), refundsMinor: amount(["refund"]), otherMinor: amount(["other", "ambiguous"]), calculatedMinor: review.calculatedMinor, varianceMinor: review.varianceMinor };
}

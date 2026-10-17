import type { ActivitySnapshot } from "./activity";
import { activityKind } from "./activity";
import type { Card, Statement, Workspace } from "./models";
import { effectiveActivityDate, latestStatement, settlements } from "./repayments";
import { paymentTargetRemaining } from "./paymentTargets";
import { sumMinor, statementReview } from "./statements";

/** All bridge amounts are signed integer minor units: debt additions positive, credits negative. */
export function netActivitySinceStatement(card: Card, statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot, signedCurrentMinor: number, today: string) {
  // The bank balance already contains reviewed inclusions, even when their Actual date
  // crosses the cutoff. Reviewed exclusions within this cycle remain unbilled activity.
  const billedStatements = new Set(workspace.statements.filter((entry) => entry.cardId === card.id && entry.bankConfirmed && entry.closingDate <= statement.closingDate).map((entry) => entry.id));
  if (statement.bankConfirmed) billedStatements.add(statement.id);
  const currentReview = statementReview(statement, workspace, snapshot);
  const currentIncluded = new Set(currentReview.rows.filter((_, index) => currentReview.memberships[index].decision === "included").map((row) => row.id));
  const included = new Map<string, Set<string>>();
  const excluded = new Map<string, string>();
  for (const decision of workspace.memberships) {
    if (decision.cardId !== card.id) continue;
    if (decision.decision === "included" && billedStatements.has(decision.statementId)) {
      const fingerprints = included.get(decision.transactionId) ?? new Set<string>();
      fingerprints.add(decision.fingerprint);
      included.set(decision.transactionId, fingerprints);
    }
    if (decision.statementId === statement.id && decision.decision === "excluded") excluded.set(decision.transactionId, decision.fingerprint);
  }
  const rows = snapshot.rows.filter((row) => {
    if (row.accountId !== card.accountId || row.date > today) return false;
    const date = effectiveActivityDate(row, card.id, workspace);
    if (date > today || included.get(row.id)?.has(row.fingerprint) || currentIncluded.has(row.id)) return false;
    return date >= statement.periodStart || excluded.get(row.id) === row.fingerprint;
  });
  const covered = snapshot.from <= statement.closingDate && snapshot.to >= today && !snapshot.issues.length;
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const kind = activityKind(row, card, workspace, snapshot);
    const label = ["purchase", "cash-advance", "money-transfer", "balance-transfer"].includes(kind) ? "Purchases / borrowing" : kind === "payment" ? "Payments" : kind === "cashback" ? "Cashback" : kind === "refund" ? "Refunds / credits" : kind === "interest" ? "Interest" : kind === "fee" ? "Fees" : ["unclassified", "ambiguous"].includes(kind) ? row.amountMinor < 0 ? "Charges (unclassified)" : "Credits (unclassified)" : "Other adjustments";
    groups.set(label, [...(groups.get(label) ?? []), -row.amountMinor]);
  }
  const currentOwedMinor = sumMinor([-signedCurrentMinor, snapshot.futureDeltaMinor ?? 0]);
  const differenceMinor = sumMinor([currentOwedMinor, -statement.officialBalanceMinor]);
  const netMinor = sumMinor(rows.map((row) => -row.amountMinor));
  return { rows, covered, currentOwedMinor, differenceMinor, netMinor, unexplainedMinor: covered ? sumMinor([differenceMinor, -netMinor]) : null, pendingCount: rows.filter((row) => row.cleared !== true).length, groups: [...groups].map(([label, amounts]) => ({ label, value: sumMinor(amounts) })) };
}

/** Latest confirmed statement once per card; never sum rollover snapshots. Unknown cards remain explicit. */
export function statementPaymentTotals(cards: Card[], workspace: Workspace, sources: (ActivitySnapshot | undefined)[], todays: string[]) {
  const entries = cards.map((card, index) => {
    const statement = latestStatement(workspace.statements.filter((entry) => entry.bankConfirmed), card.id);
    const source = sources[index];
    const payment = statement && source ? settlements(card, workspace, source, todays[index]).find((entry) => entry.statementId === statement.id) : undefined;
    if (!payment || payment.fullRemainingMinor === null) return null;
    const remaining = paymentTargetRemaining(statement!, payment.confirmedPaidMinor);
    const minimum = Math.max(0, statement!.minimumDueMinor - payment.confirmedPaidMinor);
    return { remaining, minimum, pending: payment.provisionalMinor, overdue: statement!.dueDate < todays[index] && minimum > 0 ? minimum : 0 };
  });
  return { coverage: entries.filter(Boolean).length, total: cards.length, remainingMinor: sumMinor(entries.flatMap((entry) => entry ? [entry.remaining] : [])), minimumMinor: sumMinor(entries.flatMap((entry) => entry ? [entry.minimum] : [])), pendingMinor: sumMinor(entries.flatMap((entry) => entry ? [entry.pending] : [])), overdueMinimumMinor: sumMinor(entries.flatMap((entry) => entry ? [entry.overdue] : [])) };
}

/** Historical due-date points require bank facts and confirmed cutoff evidence. */
export function carriedDebtPoints(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string) {
  const statuses = settlements(card, workspace, snapshot, today);
  return workspace.statements.filter((statement) => statement.cardId === card.id).filter((statement) => statement.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((statement) => {
    const payment = statuses.find((entry) => entry.statementId === statement.id)!;
    return { date: statement.dueDate, value: payment.carriedAtDueMinor ?? null, source: "Confirmed payments at bank due date", breakdown: [{ label: "Billed statement balance", value: statement.officialBalanceMinor }, { label: "Confirmed payments by due date", value: payment.confirmedPaidByDueMinor ?? null }, { label: "Confirmed credits by due date", value: payment.confirmedCreditByDueMinor ?? payment.confirmedCashbackByDueMinor ?? null }] };
  });
}

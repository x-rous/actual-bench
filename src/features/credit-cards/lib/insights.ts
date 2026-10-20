import type { ActivitySnapshot } from "./activity";
import type { Card, Statement, Workspace } from "./models";
import { sumMinor, statementReview } from "./statements";
import { familyOf, type Family } from "./derive/families";
import { effectiveDate, statementPayments } from "./derive/payments";
import { activityKind } from "./derive/types";

const FAMILY_LABELS: Record<Family, string> = {
  charge: "Purchases and borrowing",
  plan: "Plan instalments",
  payment: "Payments",
  cashback: "Cashback",
  refund: "Refunds",
  interest: "Interest",
  fee: "Fees",
  adjustment: "Adjustments",
  transfer: "Transfers",
};

/** The latest saved statement of a card. */
export function latestStatement(statements: readonly Statement[], cardId: string) {
  return statements
    .filter((entry) => entry.cardId === cardId && !entry.estimate)
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
}

/**
 * New since statement (§7.1 #14): net card rows not billed on any saved statement, signed so
 * that charges are positive and credits negative.
 */
export function netActivitySinceStatement(
  card: Card, statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot, signedCurrentMinor: number, today: string,
) {
  const billed = new Set(workspace.statements
    .filter((entry) => entry.cardId === card.id && !entry.estimate && entry.closingDate <= statement.closingDate)
    .map((entry) => entry.id));
  const review = statementReview(statement, workspace, snapshot);
  const currentIncluded = new Set(review.rows.filter((_, index) => review.memberships[index].decision === "included").map((row) => row.id));
  const included = new Set(workspace.decisions
    .filter((entry) => entry.cardId === card.id && entry.decision === "included" && billed.has(entry.statementId))
    .map((entry) => `${entry.transactionId}\u0000${entry.sourceHash}`));
  const excluded = new Set(workspace.decisions
    .filter((entry) => entry.statementId === statement.id && entry.decision === "excluded")
    .map((entry) => `${entry.transactionId}\u0000${entry.sourceHash}`));
  const statements = workspace.statements.filter((entry) => entry.cardId === card.id);
  const rows = snapshot.rows.filter((row) => {
    if (row.accountId !== card.accountId || row.date > today) return false;
    const key = `${row.id}\u0000${row.fingerprint}`;
    if (included.has(key) || currentIncluded.has(row.id)) return false;
    const date = effectiveDate(row, card.id, workspace, statements);
    return date >= statement.periodStart || excluded.has(key);
  });
  const covered = snapshot.from <= statement.closingDate && snapshot.to >= today && !snapshot.issues.length;
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const label = FAMILY_LABELS[familyOf(activityKind(row, card, workspace, snapshot))];
    groups.set(label, [...(groups.get(label) ?? []), -row.amountMinor]);
  }
  const currentOwedMinor = sumMinor([-signedCurrentMinor, snapshot.futureDeltaMinor ?? 0]);
  const differenceMinor = sumMinor([currentOwedMinor, -statement.balanceMinor]);
  const netMinor = sumMinor(rows.map((row) => -row.amountMinor));
  return {
    rows,
    covered,
    currentOwedMinor,
    differenceMinor,
    netMinor,
    unexplainedMinor: covered ? sumMinor([differenceMinor, -netMinor]) : null,
    pendingCount: rows.filter((row) => row.cleared !== true).length,
    groups: [...groups].map(([label, amounts]) => ({ label, value: sumMinor(amounts) })),
  };
}

/** Left to pay, minimum left and overdue minimum across cards: each card's latest statement once. */
export function statementPaymentTotals(cards: Card[], workspace: Workspace, sources: (ActivitySnapshot | undefined)[], todays: string[]) {
  const entries = cards.map((card, index) => {
    const statement = latestStatement(workspace.statements, card.id);
    const source = sources[index];
    const payment = statement && source
      ? statementPayments(card, workspace, source, todays[index]).find((entry) => entry.statementId === statement.id)
      : undefined;
    if (!payment?.known || payment.leftToPayMinor === null || payment.minimumLeftMinor === null) return null;
    const overdue = statement!.dueDate < todays[index] ? payment.minimumLeftMinor : 0;
    return { remaining: payment.leftToPayMinor, minimum: payment.minimumLeftMinor, pending: payment.pendingMinor, overdue };
  });
  const total = (pick: (entry: NonNullable<(typeof entries)[number]>) => number) =>
    sumMinor(entries.flatMap((entry) => (entry ? [pick(entry)] : [])));
  return {
    coverage: entries.filter(Boolean).length,
    total: cards.length,
    remainingMinor: total((entry) => entry.remaining),
    minimumMinor: total((entry) => entry.minimum),
    pendingMinor: total((entry) => entry.pending),
    overdueMinimumMinor: total((entry) => entry.overdue),
  };
}

/** Unpaid at due date (§7.1 #13) per past statement. */
export function carriedDebtPoints(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string) {
  const payments = statementPayments(card, workspace, snapshot, today);
  return workspace.statements
    .filter((statement) => statement.cardId === card.id && !statement.estimate && statement.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((statement) => {
      const payment = payments.find((entry) => entry.statementId === statement.id)!;
      return {
        date: statement.dueDate,
        value: payment.unpaidAtDueMinor,
        source: "Unpaid at due date",
        breakdown: [
          { label: "Statement balance", value: statement.balanceMinor },
          { label: "Paid", value: payment.known ? payment.paidMinor : null },
          { label: "Credits", value: payment.known ? payment.creditsMinor : null },
        ],
      };
    });
}

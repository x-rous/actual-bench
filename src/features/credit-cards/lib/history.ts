import { limitOn } from "./derive/limits";
import type { ActivitySnapshot } from "./activity";
import type { Card, Workspace } from "./models";
import { sumMinor } from "./statements";
import { statementPayments } from "./derive/payments";
import { costFamilyOf } from "./derive/families";
import { statementBreakdown } from "./derive/breakdown";
import { transactionType } from "./derive/types";

/** Per-statement history; every amount comes from the shared statement breakdown. */
export function statementHistory(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string) {
  const payments = statementPayments(card, workspace, snapshot, today);
  return workspace.statements
    .filter((entry) => entry.cardId === card.id)
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate))
    .map((statement) => {
      const breakdown = statementBreakdown(card, statement, workspace, snapshot);
      // The limit that applied when this statement closed.
      const limit = limitOn(card, workspace, statement.closingDate);
      return {
        statement,
        covered: breakdown.known,
        breakdown,
        interestMinor: breakdown.interestMinor,
        feesMinor: breakdown.feesMinor,
        utilization: limit && limit > 0 ? Math.max(0, statement.balanceMinor) / limit * 100 : null,
        payment: payments.find((entry) => entry.statementId === statement.id)!,
      };
    });
}

/** Partial APR coverage is reported, never filled using another card's rate. */
export function portfolio(cards: Card[], balances: Map<string, { debtMinor: number; creditMinor: number }>) {
  const available = cards.filter((card) => balances.has(card.accountId));
  const debtOf = (card: Card) => balances.get(card.accountId)!.debtMinor;
  const debtMinor = sumMinor(available.map(debtOf));
  const creditMinor = sumMinor(available.map((card) => balances.get(card.accountId)!.creditMinor));
  const withApr = available.filter((card) => card.purchaseAprBps !== null);
  const aprCoveredDebtMinor = sumMinor(withApr.map(debtOf));
  const weighted = withApr.reduce((total, card) => total + BigInt(debtOf(card)) * BigInt(card.purchaseAprBps!), BigInt(0));
  const covered = BigInt(aprCoveredDebtMinor);
  const weightedAprBps = aprCoveredDebtMinor ? Number((weighted + covered / BigInt(2)) / covered) : null;
  return { debtMinor, creditMinor, weightedAprBps, aprCoveredDebtMinor, balanceCoverage: available.length, totalCards: cards.length };
}

/** Integer minor-unit cumulative charges, never interest paid or a sum across coverage gaps. */
export function cumulativeInterestCharges(history: ReturnType<typeof statementHistory>) {
  let totalMinor: number | null = 0;
  return [...history].reverse().map((entry) => {
    totalMinor = totalMinor === null || entry.interestMinor === null ? null : sumMinor([totalMinor, entry.interestMinor]);
    return { date: entry.statement.closingDate, value: totalMinor };
  });
}

/**
 * Interest or fees charged in the loaded posting-date window (§7.1 #17), net of refunds.
 * Suggested rows are not counted until accepted (A5); `suggestedCount` discloses them, and
 * `pendingCount` flags uncleared rows that are included.
 */
export function observedChargeTotals(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string, kind: "interest" | "fee") {
  const from = snapshot.from;
  const to = snapshot.to < today ? snapshot.to : today;
  const rows = snapshot.rows.filter((row) => row.date >= from && row.date <= to);
  const typed = rows.map((row) => ({ row, type: transactionType(row, card, workspace, snapshot) }))
    .filter(({ type }) => costFamilyOf(type.kind) === kind);
  const counted = typed.filter(({ type }) => type.counted).map(({ row }) => row);
  return {
    classificationKnown: snapshot.issues.length === 0,
    totalMinor: sumMinor(counted.map((row) => -row.amountMinor)),
    grossMinor: sumMinor(counted.filter((row) => row.amountMinor < 0).map((row) => -row.amountMinor)),
    refundsMinor: sumMinor(counted.filter((row) => row.amountMinor > 0).map((row) => row.amountMinor)),
    suggestedCount: typed.length - counted.length,
    pendingCount: counted.filter((row) => row.cleared !== true).length,
    from,
    to,
  };
}

/** Reporting covers only available activity, using Actual posting dates. */
export function observedInterestTotals(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string) {
  return observedChargeTotals(card, workspace, snapshot, today, "interest");
}

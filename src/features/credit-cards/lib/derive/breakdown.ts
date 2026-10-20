import type { ActivitySnapshot } from "../activity";
import type { Card, Statement, Workspace } from "../models";
import { statementReview, sumMinor } from "../statements";
import { familyOf } from "./families";
import { transactionType } from "./types";

/**
 * What is printed on one statement, in positive integer minor units. Every included
 * row lands in exactly one of the three headline columns, so
 * `calculated = previous − paymentsAndCredits + charges + interestAndFees`.
 * Amounts are null until coverage is complete and nothing is undecided.
 */
export type StatementBreakdown = {
  known: boolean;
  unavailableReason: string | null;
  /** Previous statement balance used as the starting point; signed, null when unknown. */
  openingMinor: number | null;
  /** Debits other than interest and fees, including plan instalments. */
  chargesMinor: number | null;
  /** Of `chargesMinor`: plan instalments billed on the card. */
  planChargesMinor: number | null;
  /** Of `chargesMinor`: suggested interest or fee rows not yet accepted (A5). */
  suggestedCostsMinor: number | null;
  suggestedCostCount: number;
  /** Net interest (charges minus interest refunds); counted rows only. */
  interestMinor: number | null;
  /** Net fees (charges minus fee refunds); counted rows only. */
  feesMinor: number | null;
  interestAndFeesMinor: number | null;
  /** Credits other than interest/fee refunds, payments net of reversals. */
  paymentsAndCreditsMinor: number | null;
  /** Of `paymentsAndCreditsMinor`: payments net of reversals. */
  paymentsMinor: number | null;
  /** Of `paymentsAndCreditsMinor`: everything that is not a payment. */
  creditsMinor: number | null;
  /** Of `creditsMinor`: merchant refunds and cashback. */
  refundsMinor: number | null;
  cashbackMinor: number | null;
  /** Signed: starting balance minus included rows (plus plan change, D15); null without a start. */
  calculatedMinor: number | null;
  /** Signed: bank statement balance minus `calculatedMinor`. */
  varianceMinor: number | null;
  /** The headline columns from the rows decided so far, even while some are undecided (review strip only). */
  soFar: { paymentsAndCreditsMinor: number; chargesMinor: number; interestAndFeesMinor: number };
};

type Review = ReturnType<typeof statementReview>;
const cache = new WeakMap<Review, WeakMap<Card, StatementBreakdown>>();

/** The one breakdown of a statement's included rows, used by every table, panel and chart. */
export function statementBreakdown(card: Card, statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot) {
  const review = statementReview(statement, workspace, snapshot);
  let byCard = cache.get(review);
  if (!byCard) {
    byCard = new WeakMap();
    cache.set(review, byCard);
  }
  let result = byCard.get(card);
  if (!result) {
    result = calculate(card, workspace, snapshot, review);
    byCard.set(card, result);
  }
  return result;
}

function calculate(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, review: Review): StatementBreakdown {
  const known = review.complete;
  const unavailableReason = !review.coverage ? "Load activity for the full billing cycle"
    : review.unresolved ? `Review ${review.unresolved} transaction decisions`
      : review.duplicate ? "Resolve overlapping statement decisions" : null;
  const totals = {
    charges: [] as number[], plan: [] as number[], suggested: [] as number[],
    interest: [] as number[], fees: [] as number[],
    paymentsAndCredits: [] as number[], payments: [] as number[], credits: [] as number[],
    refunds: [] as number[], cashback: [] as number[],
  };
  review.rows.forEach((row, index) => {
    if (review.memberships[index].decision !== "included") return;
    const type = transactionType(row, card, workspace, snapshot);
    const family = familyOf(type.kind);
    const cost = family === "interest" || family === "fee";
    if (cost && type.counted) {
      (family === "interest" ? totals.interest : totals.fees).push(-row.amountMinor);
    } else if (family === "payment") {
      // Payments and their reversals net on the statement's payments line.
      totals.paymentsAndCredits.push(row.amountMinor);
      totals.payments.push(row.amountMinor);
    } else if (row.amountMinor < 0) {
      totals.charges.push(-row.amountMinor);
      if (family === "plan") totals.plan.push(-row.amountMinor);
      if (cost) totals.suggested.push(-row.amountMinor);
    } else if (row.amountMinor > 0) {
      totals.paymentsAndCredits.push(row.amountMinor);
      totals.credits.push(row.amountMinor);
      if (family === "refund") totals.refunds.push(row.amountMinor);
      if (family === "cashback") totals.cashback.push(row.amountMinor);
    }
  });
  const value = (amounts: number[]) => known ? sumMinor(amounts) : null;
  const interestMinor = value(totals.interest);
  const feesMinor = value(totals.fees);
  return {
    known,
    unavailableReason,
    openingMinor: review.startingBalanceMinor,
    chargesMinor: value(totals.charges),
    planChargesMinor: value(totals.plan),
    suggestedCostsMinor: value(totals.suggested),
    suggestedCostCount: totals.suggested.length,
    interestMinor,
    feesMinor,
    interestAndFeesMinor: interestMinor === null || feesMinor === null ? null : sumMinor([interestMinor, feesMinor]),
    paymentsAndCreditsMinor: value(totals.paymentsAndCredits),
    paymentsMinor: value(totals.payments),
    creditsMinor: value(totals.credits),
    refundsMinor: value(totals.refunds),
    cashbackMinor: value(totals.cashback),
    calculatedMinor: review.calculatedMinor,
    varianceMinor: review.varianceMinor,
    soFar: {
      paymentsAndCreditsMinor: sumMinor(totals.paymentsAndCredits),
      chargesMinor: sumMinor(totals.charges),
      interestAndFeesMinor: sumMinor([...totals.interest, ...totals.fees]),
    },
  };
}

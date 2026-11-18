/**
 * Does the account close where the statement says it does?
 *
 * The standard reconciliation test, and the one Actual's own Reconcile button
 * performs: the account's balance on the statement's closing date against the
 * closing balance the bank printed.
 *
 * A balance strip was built and withdrawn once (knowledge.md, 2026-09) because
 * the Actual side was "a date range derived from the first and last row", so
 * it could not tally by construction. This is a different figure: the
 * account's whole balance as of the bank's own closing date — every
 * transaction ever posted up to it, not a window's sum — compared with the
 * bank's own closing figure. It is only offered when the statement printed one
 * (`closingBalanceFromPdf`), so nothing here is estimated.
 *
 * All amounts are integer minor units in Actual's sign convention.
 */

import type { ApplyPlan } from "../apply/operations";
import type { MinorUnitAmount } from "../types";
import type { StatementClosingBalance } from "../statement/normalize";

/**
 * The account's balance at the end of `asOf`, from its balance today and the
 * transactions dated after `asOf` (split children excluded: the parent carries
 * the amount).
 */
export function balanceAsOf(
  currentBalance: MinorUnitAmount,
  later: { amount: MinorUnitAmount; date: string; isChild?: boolean }[],
  asOf: string
): MinorUnitAmount {
  let balance = currentBalance;
  for (const transaction of later) {
    if (transaction.isChild || transaction.date <= asOf) continue;
    balance -= transaction.amount;
  }
  return balance;
}

/**
 * What the planned writes do to the balance on `asOf`: creates and deletes on or
 * before it, amount corrections, and date moves across it.
 */
export function planEffectOn(plan: Pick<ApplyPlan, "operations">, asOf: string): MinorUnitAmount {
  let effect = 0;
  for (const operation of plan.operations) {
    if (operation.kind === "create") {
      if (operation.date <= asOf) effect += operation.amount;
    } else if (operation.kind === "delete") {
      if (operation.date <= asOf) effect -= operation.amount;
    } else {
      const before = operation.date <= asOf ? operation.amount : 0;
      const date = operation.patch.date?.staged ?? operation.date;
      const amount = operation.patch.amount?.staged ?? operation.amount;
      effect += (date <= asOf ? amount : 0) - before;
    }
  }
  return effect;
}

export type ClosingBalanceCheck = {
  statement: StatementClosingBalance;
  /** Actual's balance on `statement.asOf`, as Actual holds it now. */
  actualNow: MinorUnitAmount;
  /** The same balance once the planned writes are applied. */
  afterApply: MinorUnitAmount;
  /** `statement.amount - afterApply`: zero when the reconciliation closes. */
  difference: MinorUnitAmount;
  reconciles: boolean;
};

export function checkClosingBalance(input: {
  statement: StatementClosingBalance;
  actualNow: MinorUnitAmount;
  plan: Pick<ApplyPlan, "operations">;
}): ClosingBalanceCheck {
  const afterApply = input.actualNow + planEffectOn(input.plan, input.statement.asOf);
  const difference = input.statement.amount - afterApply;
  return { statement: input.statement, actualNow: input.actualNow, afterApply, difference, reconciles: difference === 0 };
}

/** Read a stored closing balance from a session's `totals` JSON, defensively. */
export function storedClosingBalance(totals: unknown): StatementClosingBalance | null {
  const value = (totals as { closingBalance?: unknown } | null)?.closingBalance as
    | Partial<StatementClosingBalance>
    | undefined;
  if (!value || typeof value !== "object") return null;
  if (!Number.isSafeInteger(value.amount) || typeof value.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf)) return null;
  if (value.source !== "closing-line" && value.source !== "last-row") return null;
  if (value.polarity !== "deposit" && value.polarity !== "liability") return null;
  return {
    amount: value.amount as number,
    asOf: value.asOf,
    source: value.source,
    polarity: value.polarity,
    polarityDetected: value.polarityDetected === true,
  };
}

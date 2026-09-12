/**
 * The one outcome that damages a budget, caught before it happens.
 *
 * A statement row staged as **create** while the transaction it actually refers
 * to is staged as **delete**: apply both and the transaction is duplicated and
 * the original removed. Each half is entirely reasonable on its own — a *Will
 * create* row and a *Will delete* row, usually pages apart under date order —
 * which is exactly why nobody notices.
 *
 * This runs over the finished plan because that is the first moment both halves
 * are in hand. The workbench cannot see it: it shows one row at a time, ordered
 * by date, and the two rows concerned are not adjacent.
 *
 * **The thresholds here are the guard's own, and deliberately looser than the
 * matcher's.** That is the whole design, and the first draft of it was circular:
 * by the time a create and a delete both exist in a plan, the matcher has
 * already refused to pair them *using its own floors*. Asking the same question
 * again returns the same answer, and the guard catches nothing. The asymmetry is
 * the point — the matcher must be conservative because it **acts**, and this can
 * be liberal because it only **asks**. A false positive costs one glance; a
 * false negative costs a duplicated transaction.
 *
 * What is kept from the matcher is user intent rather than tolerance: which
 * Actual field carries the merchant text, and the needle floor that stops `FEE`
 * matching a third of the account.
 */

import type { ApplyPlan, CreateOperation, DeleteOperation } from "./operations";
import { dayDelta } from "../match/score";
import { scoreText, type TextCorpus } from "../match/text";
import type {
  ActualTransactionSnapshot,
  MinorUnitAmount,
  NeedleFloor,
  TextMatchConfig,
} from "../types";

/**
 * Text agreement a pair must reach to be worth showing.
 *
 * The matcher's equivalents are 0.75 and 0.8. Half is deliberate: the pairs
 * worth catching here are precisely the ones those floors rejected. `Danube-D-
 * JEDDAH SAU SAR53.45` against a note of `#API Danube-D-8505` scores 0.667 —
 * invisible to the matcher, obvious to a person, and a duplicate waiting to be
 * written.
 */
const TEXT_FLOOR = 0.5;

/**
 * How far apart the two dates may be.
 *
 * Twice the matcher's tolerance, because a posting delay is one of the main
 * reasons a pairing was missed in the first place — and a pair the matcher
 * could see is not in this pool at all.
 */
const DAY_WINDOW = 14;

export type SuspectedDuplicate = {
  createOperationId: string;
  deleteOperationId: string;
  /** 0..1 text agreement. Ranks the pairs, and lets the user weigh one. */
  similarity: number;
  /** `delete - create`, in integer minor units. Zero when the two agree. */
  amountDifference: MinorUnitAmount;
  /** Signed whole days, `delete - create`. */
  dayGap: number;
};

export type DuplicateGuardInput = {
  plan: ApplyPlan;
  /** Snapshots for the delete side: the operation itself carries no text. */
  transactions: Map<string, ActualTransactionSnapshot>;
  /** The session's configured text targets — which field holds the merchant. */
  text: TextMatchConfig;
  needleFloor: NeedleFloor;
  /** Token frequencies across the loaded window; built by the caller. */
  corpus?: TextCorpus;
};

/** What the bank called a row being created. */
function createText(operation: CreateOperation): string {
  return operation.importedPayee?.trim() || operation.notes?.trim() || "";
}

export function findSuspectedDuplicates(input: DuplicateGuardInput): SuspectedDuplicate[] {
  const creates = input.plan.operations.filter(
    (operation): operation is CreateOperation => operation.kind === "create"
  );
  const deletes = input.plan.operations.filter(
    (operation): operation is DeleteOperation => operation.kind === "delete"
  );
  if (creates.length === 0 || deletes.length === 0) return [];

  const pairs: SuspectedDuplicate[] = [];

  for (const create of creates) {
    const statementText = createText(create);
    if (!statementText) continue;

    for (const remove of deletes) {
      // An outflow is never the same event as an inflow, at any tolerance.
      if (Math.sign(create.amount) !== Math.sign(remove.amount)) continue;

      const dayGap = dayDelta(create.date, remove.date);
      if (Math.abs(dayGap) > DAY_WINDOW) continue;

      const transaction = input.transactions.get(remove.transactionId);
      if (!transaction) continue;

      const text = scoreText(
        statementText,
        {
          payeeName: transaction.payeeName,
          importedPayee: transaction.importedPayee,
          notes: transaction.notes,
        },
        input.text,
        input.needleFloor,
        input.corpus
      );
      if (text.similarity === null || text.similarity < TEXT_FLOOR) continue;

      // No amount condition at all. "The recorded amount is wildly wrong" is one
      // of the reasons the matcher missed the pairing, so excluding it on those
      // grounds would rule out the case being looked for.
      pairs.push({
        createOperationId: create.id,
        deleteOperationId: remove.id,
        similarity: text.similarity,
        amountDifference: remove.amount - create.amount,
        dayGap,
      });
    }
  }

  /*
   * One pairing per operation, strongest first.
   *
   * Three rows being created for one merchant will each look like the single row
   * being deleted, and reporting all three reads as three problems rather than
   * one uncertainty about which row that transaction belongs to.
   *
   * Ties break on date closeness and then on ids, so the same plan always
   * produces the same warning.
   */
  pairs.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      Math.abs(a.dayGap) - Math.abs(b.dayGap) ||
      (a.createOperationId < b.createOperationId ? -1 : 1)
  );

  const usedCreates = new Set<string>();
  const usedDeletes = new Set<string>();
  const chosen: SuspectedDuplicate[] = [];

  for (const pair of pairs) {
    if (usedCreates.has(pair.createOperationId)) continue;
    if (usedDeletes.has(pair.deleteOperationId)) continue;
    usedCreates.add(pair.createOperationId);
    usedDeletes.add(pair.deleteOperationId);
    chosen.push(pair);
  }

  return chosen;
}

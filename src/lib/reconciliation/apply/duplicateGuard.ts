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

/**
 * What identifies a row being created.
 *
 * Exported because the warning has to show the reader the same text the
 * comparison used. Rendering `importedPayee` alone showed "No payee" for a pair
 * that matched on the notes — naming a row by a field that played no part in
 * relating it.
 */
export function createIdentity(operation: CreateOperation): string {
  return operation.importedPayee?.trim() || operation.notes?.trim() || "";
}

/** The same, for the transaction on the other side of a suspected pair. */
export function transactionIdentity(transaction: ActualTransactionSnapshot): string {
  return (
    transaction.payeeName?.trim() ||
    transaction.importedPayee?.trim() ||
    transaction.notes?.trim() ||
    ""
  );
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
    const statementText = createIdentity(create);
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
   * One pairing per operation, and **as many pairings as the evidence allows**.
   *
   * One-to-one is deliberate: three rows being created for one merchant all
   * resemble the single row being deleted, and reporting every combination
   * reads as three problems rather than one question about which row that
   * transaction belongs to.
   *
   * Taking the strongest pair first and moving on does not give the most
   * pairings, though, and here that matters. Create A may fit deletes 1 and 2
   * while create B fits only delete 1: pick A-1 because it scores highest and
   * B-1 is blocked, A-2 is blocked, and one of two real warnings is lost.
   *
   * `assign.ts` faces the same choice and answers it the other way, on purpose.
   * There greedy is chosen over an optimal assignment for *explainability* -
   * the matcher **acts**, so "why did it choose that one?" has to be
   * answerable. This only **asks**, and its failure mode is staying quiet about
   * a duplicate. So it maximises the number of pairs first and uses quality
   * only to choose between matchings of the same size, which is what ordering
   * each row's candidates best-first achieves.
   *
   * Augmenting paths (Kuhn's). The pools are leftovers of leftovers, so this is
   * a handful of rows against a handful of transactions.
   */
  const edgesByCreate = new Map<string, SuspectedDuplicate[]>();
  for (const pair of pairs) {
    const existing = edgesByCreate.get(pair.createOperationId);
    if (existing) existing.push(pair);
    else edgesByCreate.set(pair.createOperationId, [pair]);
  }
  for (const edges of edgesByCreate.values()) edges.sort(byQuality);

  // Creates are attempted in order of their best available pairing, so a row
  // with one obvious counterpart is settled before one with several.
  const order = [...edgesByCreate.keys()].sort((a, b) =>
    byQuality(edgesByCreate.get(a)![0], edgesByCreate.get(b)![0])
  );

  /** delete operation id -> the pair currently holding it. */
  const held = new Map<string, SuspectedDuplicate>();

  function augment(createOperationId: string, seen: Set<string>): boolean {
    for (const edge of edgesByCreate.get(createOperationId) ?? []) {
      if (seen.has(edge.deleteOperationId)) continue;
      seen.add(edge.deleteOperationId);

      const incumbent = held.get(edge.deleteOperationId);
      // Free, or its current holder can be re-homed somewhere else.
      if (!incumbent || augment(incumbent.createOperationId, seen)) {
        held.set(edge.deleteOperationId, edge);
        return true;
      }
    }
    return false;
  }

  for (const createOperationId of order) augment(createOperationId, new Set());

  return [...held.values()].sort(byQuality);
}

/** Strongest text agreement first, then closest dates, then ids for determinism. */
function byQuality(a: SuspectedDuplicate, b: SuspectedDuplicate): number {
  return (
    b.similarity - a.similarity ||
    Math.abs(a.dayGap) - Math.abs(b.dayGap) ||
    (a.createOperationId < b.createOperationId ? -1 : 1)
  );
}

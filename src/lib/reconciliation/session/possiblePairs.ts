/**
 * A statement row and a transaction that are probably the same thing, found
 * while it can still be acted on.
 *
 * The pairs this looks for are the ones matching refused: text below its floor,
 * dates beyond its tolerance, amounts past its ratio guard. Left alone they
 * become a row created and a row deleted for one real transaction — the account
 * ends up exactly as wrong as it started, with a day's reconciling to redo.
 *
 * **It reads the items, not the plan.** An earlier version compared `create`
 * against `delete` operations, which meant it could only speak once both
 * decisions were staged — asking the user to unwind two choices rather than
 * never making them, and pointing them at a screen they had just left. Nothing
 * in the comparison uses the decisions, so nothing required waiting for them.
 * Reading the items also catches a create whose duplicate is *not* being
 * deleted, which the operation-based version structurally could not: same
 * duplication, no delete to pair it with.
 *
 * ## Why a floor this low is safe here
 *
 * The matcher's floors are strict, and lowering them was considered and refused
 * (F-151i). This is not that decision reversed, and the reason is worth being
 * precise about:
 *
 * > The matcher is conservative because **an offered candidate is one keypress
 * > from becoming a decision**. `Enter` accepts it; bulk actions act on it. The
 * > threshold is not what protects the user — the cheapness of acting is what
 * > makes a low threshold dangerous.
 *
 * A pair from here is acted on only by an explicit two-row confirmation: not
 * `Enter`, not the candidate list, not in bulk. The gesture is the safeguard, so
 * the floor can be far looser without changing the cost of any existing action.
 *
 * Nothing here is persisted or becomes a `reasonCode`. It is derived state for
 * display, and `match()` returns exactly the graph it always did.
 */

import { dayDelta } from "../match/score";
import { scoreText, type TextCorpus } from "../match/text";
import { statementText } from "../statement/text";
import type {
  ActualTransactionSnapshot,
  MinorUnitAmount,
  NeedleFloor,
  ReconciliationItem,
  StatementRow,
  TextMatchConfig,
} from "../types";
import { isActualOnly, isStatementOnly } from "./build";

/**
 * Text agreement a pair must reach to be worth offering.
 *
 * The matcher's equivalents are 0.75 and 0.8. Half is deliberate: the pairs
 * worth finding here are precisely the ones those floors rejected.
 * `Danube-D- JEDDAH SAU SAR53.45` against a note of `#API Danube-D-8505` scores
 * 0.667 — invisible to matching, obvious to a person.
 */
const TEXT_FLOOR = 0.5;

/**
 * How far apart the two dates may be.
 *
 * Twice the matcher's tolerance, because a posting delay is one of the main
 * reasons a pairing was missed — and a pair matching could see is not in this
 * pool at all.
 */
const DAY_WINDOW = 14;

export type PossiblePair = {
  /** The item holding the statement row with nothing in Actual. */
  statementItemId: string;
  /** The item holding the transaction with nothing on the statement. */
  actualItemId: string;
  /** 0..1 text agreement. Ranks the pairs, and lets the user weigh one. */
  similarity: number;
  /** `transaction - statement`, in integer minor units. Zero when they agree. */
  amountDifference: MinorUnitAmount;
  /** Signed whole days, `transaction - statement`. */
  dayGap: number;
};

export type PossiblePairsInput = {
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  /** The session's configured text targets — which field holds the merchant. */
  text: TextMatchConfig;
  /** Kept from matching: it says what counts as evidence, not how much. */
  needleFloor: NeedleFloor;
  /** Token frequencies across the loaded window; built by the caller. */
  corpus?: TextCorpus;
};

export function findPossiblePairs(input: PossiblePairsInput): PossiblePair[] {
  /*
   * Disposition is deliberately not part of the pool.
   *
   * Whether the user has decided yet does not change whether two rows are the
   * same real transaction, and excluding decided rows would reintroduce exactly
   * the "only once both halves are staged" limitation this was moved to escape.
   */
  const statementSide = input.items.filter(isStatementOnly);
  const actualSide = input.items.filter(isActualOnly);
  if (statementSide.length === 0 || actualSide.length === 0) return [];

  const edges: PossiblePair[] = [];

  for (const left of statementSide) {
    const row = input.statementRows.get(left.statementRowIds[0] ?? "");
    if (!row) continue;
    const needle = statementText(row);
    if (!needle) continue;

    for (const right of actualSide) {
      const transaction = input.transactions.get(right.actualTransactionIds[0] ?? "");
      if (!transaction) continue;

      // An outflow is never the same event as an inflow, at any tolerance.
      if (Math.sign(transaction.amount) !== Math.sign(row.amount)) continue;

      const dayGap = dayDelta(row.postedDate, transaction.date);
      if (Math.abs(dayGap) > DAY_WINDOW) continue;

      const text = scoreText(
        needle,
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

      // No amount condition at all. "The recorded amount is wrong" is one of the
      // reasons matching missed the pairing, so ruling it out on those grounds
      // would exclude the case being looked for.
      edges.push({
        statementItemId: left.id,
        actualItemId: right.id,
        similarity: text.similarity,
        amountDifference: transaction.amount - row.amount,
        dayGap,
      });
    }
  }

  return maximumMatching(edges);
}

/**
 * One pairing per row, and **as many pairings as the evidence allows**.
 *
 * One-to-one is deliberate: three rows for one merchant all resemble the single
 * transaction, and offering every combination reads as three problems rather
 * than one question about which row it belongs to.
 *
 * Taking the strongest pair first does not give the most pairings, though, and
 * here that matters. Row A may fit transactions 1 and 2 while row B fits only 1:
 * take A-1 because it scores highest and B is stranded, so one of two real
 * pairings is never offered.
 *
 * `assign.ts` faces the same choice and answers it the other way on purpose.
 * There greedy is chosen over an optimal assignment for *explainability* — the
 * matcher **acts**, so "why did it choose that one?" has to be answerable. This
 * only **offers**, and its failure is staying quiet. So the count comes first,
 * and `improveQuality` then trades pairings that keep the count and raise the
 * quality — because augmenting paths settle the count and say nothing at all
 * about which pairs make it up.
 *
 * Augmenting paths (Kuhn's). The pools are leftovers of leftovers.
 */
function maximumMatching(edges: PossiblePair[]): PossiblePair[] {
  const byStatement = new Map<string, PossiblePair[]>();
  for (const edge of edges) {
    const existing = byStatement.get(edge.statementItemId);
    if (existing) existing.push(edge);
    else byStatement.set(edge.statementItemId, [edge]);
  }
  for (const list of byStatement.values()) list.sort(byQuality);

  // Rows are attempted in order of their best available pairing, so one with an
  // obvious counterpart is settled before one with several.
  const order = [...byStatement.keys()].sort((a, b) =>
    byQuality(byStatement.get(a)![0], byStatement.get(b)![0])
  );

  /** actual item id -> the pair currently holding it. */
  const held = new Map<string, PossiblePair>();

  function augment(statementItemId: string, seen: Set<string>): boolean {
    for (const edge of byStatement.get(statementItemId) ?? []) {
      if (seen.has(edge.actualItemId)) continue;
      seen.add(edge.actualItemId);

      const incumbent = held.get(edge.actualItemId);
      // Free, or its current holder can be re-homed somewhere else.
      if (!incumbent || augment(incumbent.statementItemId, seen)) {
        held.set(edge.actualItemId, edge);
        return true;
      }
    }
    return false;
  }

  for (const statementItemId of order) augment(statementItemId, new Set());

  return improveQuality(held, byStatement).sort(byQuality);
}

/**
 * Trade pairings that keep the count but raise the quality.
 *
 * Augmenting paths guarantee the *number* of pairs and nothing about which ones.
 * Taking the first path found lets a later row displace an earlier one from its
 * near-certain partner onto a weak one: with `A-X 1.00`, `A-Y 0.50`, `B-X 0.89`
 * and `B-Y 0.78`, `B` evicts `A` from `X`, and the result is `A-Y + B-X` (1.39)
 * where `A-X + B-Y` (1.78) was available. Both have two pairs, so the count is
 * no help — and the user is shown the weaker of two suggestions for both rows.
 *
 * So matched pairs are swapped wherever the swap is possible and better. Each
 * pass is O(pairs²) and every accepted swap strictly raises the total, so this
 * terminates; the cap is there for the pathological shape rather than the
 * expected one, since these pools are leftovers of leftovers.
 *
 * **It is a local optimum, not a proven global one.** Saying so matters: an
 * earlier version of this docblock claimed ordering candidates best-first gave
 * the best matching of a given size, which is simply not true, and a comment
 * that overstates what the code does stops the next reader checking it.
 */
function improveQuality(
  held: Map<string, PossiblePair>,
  byStatement: Map<string, PossiblePair[]>
): PossiblePair[] {
  /** The edge joining these two, if the pair was admissible at all. */
  const edgeFor = (statementItemId: string, actualItemId: string) =>
    byStatement.get(statementItemId)?.find((edge) => edge.actualItemId === actualItemId);

  const PASSES = 8;
  for (let pass = 0; pass < PASSES; pass++) {
    let swapped = false;

    const current = [...held.values()];
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const left = current[i];
        const right = current[j];

        // The crossed alternative: each row takes the other's transaction.
        const leftSwap = edgeFor(left.statementItemId, right.actualItemId);
        const rightSwap = edgeFor(right.statementItemId, left.actualItemId);
        if (!leftSwap || !rightSwap) continue;

        const now = left.similarity + right.similarity;
        const after = leftSwap.similarity + rightSwap.similarity;
        if (after <= now) continue;

        held.set(right.actualItemId, leftSwap);
        held.set(left.actualItemId, rightSwap);
        current[i] = leftSwap;
        current[j] = rightSwap;
        swapped = true;
      }
    }

    if (!swapped) break;
  }

  return [...held.values()];
}

/**
 * Strongest text agreement first, then closest dates, then ids.
 *
 * Both ids, and a real zero when they are equal. Comparing only the statement id
 * returned `1` in both directions for two candidates of the *same* row - which
 * is not an ordering, and leaves the result at the mercy of the input order and
 * the engine's sort. The ids are the last resort precisely because they are the
 * only thing guaranteed to differ.
 */
function byQuality(a: PossiblePair, b: PossiblePair): number {
  if (a.similarity !== b.similarity) return b.similarity - a.similarity;

  const byDate = Math.abs(a.dayGap) - Math.abs(b.dayGap);
  if (byDate !== 0) return byDate;

  if (a.statementItemId !== b.statementItemId) {
    return a.statementItemId < b.statementItemId ? -1 : 1;
  }
  if (a.actualItemId !== b.actualItemId) {
    return a.actualItemId < b.actualItemId ? -1 : 1;
  }
  return 0;
}

/**
 * Would applying the plan actually write either half of this pair?
 *
 * On the workbench every possible pair is worth seeing. At the gate into Review
 * only the ones that would put something in the budget should stop anyone: a
 * pair where neither side is staged writes nothing, and interrupting for it
 * teaches the user to click past the interruption.
 */
export function wouldWrite(
  pair: PossiblePair,
  items: Map<string, ReconciliationItem>
): boolean {
  return (
    items.get(pair.statementItemId)?.disposition === "create" ||
    items.get(pair.actualItemId)?.disposition === "delete"
  );
}

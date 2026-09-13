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
 * One pairing per row, as many pairings as the evidence allows, and the best
 * such set.
 *
 * One-to-one is deliberate: three rows for one merchant all resemble the single
 * transaction, and offering every combination reads as three problems rather
 * than one question about which row it belongs to.
 *
 * **Count first, then quality, and both exactly.** Augmenting paths settle the
 * count and say nothing about which pairs make it up, so taking the first path
 * found lets a later row evict an earlier one from its own transaction onto
 * someone else's — same number of suggestions, both of them worse.
 *
 * The fix is to augment along the **best** path rather than the first: repeatedly
 * extending a matching by its maximum-gain augmenting path yields, after k
 * extensions, the maximum-weight matching among all matchings of size k. So the
 * count is maximal because every augmentation adds a pair, and the quality is
 * maximal at that count because every augmentation was the best available.
 *
 * A previous version did this with a plain DFS and then traded pairs in twos.
 * That was neither: swapping two can never perform a three-way rotation, so
 * `0→1, 1→2, 2→0` stood at 2.41 where `0→2, 1→0, 2→1` scored 2.60 and no pair
 * of them could be exchanged to get there. Doing half the job is worse than a
 * stated limitation, because the comment then has to describe something with no
 * name.
 *
 * `assign.ts` faces the same choice and answers it the other way on purpose.
 * There greedy is chosen over an optimal assignment for *explainability* — the
 * matcher **acts**, so "why did it choose that one?" has to be answerable. This
 * only **offers**, and its failure is staying quiet or suggesting the weaker of
 * two partners, so the optimum is worth the search. The pools are leftovers of
 * leftovers, and the search is bounded by their size.
 *
 * Exported for its own tests: the optimality claim is the contract, and pinning
 * it through `findPossiblePairs` would mean hunting for statement text whose
 * similarities happen to land on a chosen shape — which tests the text, not the
 * algorithm.
 */
export function maximumMatching(edges: PossiblePair[]): PossiblePair[] {
  const byStatement = new Map<string, PossiblePair[]>();
  for (const edge of edges) {
    const existing = byStatement.get(edge.statementItemId);
    if (existing) existing.push(edge);
    else byStatement.set(edge.statementItemId, [edge]);
  }
  for (const list of byStatement.values()) list.sort(byQuality);

  /** actual item id -> the pair currently holding it. */
  const held = new Map<string, PossiblePair>();

  /*
   * Extend one pair at a time, always by the best extension available anywhere.
   *
   * "Anywhere" is load-bearing and was wrong at first: taking each row in turn
   * and giving it *its* best path is not the same as taking the best path in
   * the graph, and the difference shows up as a matching that is the right size
   * and not the best of that size. The property test found it immediately.
   */
  for (;;) {
    const paired = new Set([...held.values()].map((edge) => edge.statementItemId));
    const free = [...byStatement.keys()].filter((row) => !paired.has(row));
    if (free.length === 0) break;

    const path = bestAugmentation(free, byStatement, held);
    if (path.length === 0) break;
    for (const edge of path) held.set(edge.actualItemId, edge);
  }

  return [...held.values()].sort(byQuality);
}

/**
 * The augmenting path that gains the most quality, as the edges to apply.
 *
 * An augmenting path alternates: take a transaction, displace whoever held it,
 * let them take another, and so on until someone lands on a free one. Its gain
 * is what the added pairs are worth less what the displaced ones were worth, so
 * a path that moves a row off a 1.00 partner to gain a 0.89 one scores −0.11
 * and loses to any path that does better.
 *
 * Seeded from **every** unpaired row at once, not one at a time: the theorem
 * this relies on — that extending a best-of-its-size matching by its best
 * augmenting path gives a best-of-the-next-size matching — is about the best
 * path in the whole graph. Per-row bests are a different thing and produce a
 * matching of the right size that is not the best of that size.
 *
 * Relaxation rather than a depth-first walk, because the best path is not
 * generally the first found: arriving at a row by a worse route early must not
 * fix it. Bounded by the number of rows, which is what makes this safe without
 * a cutoff — there are no positive alternating cycles to loop on, since every
 * matching built this way is already the best of its size.
 */
function bestAugmentation(
  sources: string[],
  byStatement: Map<string, PossiblePair[]>,
  held: Map<string, PossiblePair>
): PossiblePair[] {
  /** Best gain with which an alternating path can arrive at this row. */
  const gainTo = new Map<string, number>(sources.map((row) => [row, 0]));
  /** The edge that displaced the row, so the path can be walked back. */
  const arrivedBy = new Map<string, PossiblePair>();
  const isSource = new Set(sources);

  let best: { gain: number; last: PossiblePair } | null = null;
  const rows = [...byStatement.keys()];

  for (let round = 0; round < rows.length; round++) {
    let improved = false;

    for (const row of rows) {
      const gain = gainTo.get(row);
      if (gain === undefined) continue;

      for (const edge of byStatement.get(row) ?? []) {
        const incumbent = held.get(edge.actualItemId);

        if (!incumbent) {
          // A free transaction ends the path, and the pair is pure gain.
          const total = gain + edge.similarity;
          if (!best || total > best.gain) best = { gain: total, last: edge };
          continue;
        }

        // Taking it costs whoever holds it; they carry on from there.
        const displaced = incumbent.statementItemId;
        const onward = gain + edge.similarity - incumbent.similarity;
        const known = gainTo.get(displaced);
        if (known === undefined || onward > known) {
          gainTo.set(displaced, onward);
          arrivedBy.set(displaced, edge);
          improved = true;
        }
      }
    }

    if (!improved) break;
  }

  if (!best) return [];

  // Walk back to whichever unpaired row started this path.
  const path: PossiblePair[] = [best.last];
  let cursor = best.last.statementItemId;
  while (!isSource.has(cursor)) {
    const edge = arrivedBy.get(cursor);
    if (!edge) break;
    path.push(edge);
    cursor = edge.statementItemId;
  }
  return path;
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

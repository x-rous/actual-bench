/**
 * Conservative fuzzy candidate matching (RD-078 §5.4).
 *
 * Two hard rules, both enforced here rather than downstream:
 *
 * 1. **Bucket before comparing.** A budget can hold thousands of payees;
 *    comparing every pair is quadratic and pointless — two names that share no
 *    leading characters are not typo variants of each other.
 * 2. **Fuzzy similarity is evidence, not proof.** This module returns *pairs*
 *    only. It never builds groups, and the resolver refuses to chain the pairs
 *    it returns (see `clusterResolver.ts`).
 */

import { bigramDice, normalizeForCompare } from "@/lib/reconciliation/match/text";
import type { DetectedPayee } from "./detectors";

/**
 * Character-level similarity floor.
 *
 * Uses `bigramDice` rather than the module's blended `symmetricSimilarity`.
 * That blend (0.6 Dice + 0.4 token overlap) is tuned for matching a bank
 * statement line against a payee, where sharing whole tokens is the strongest
 * available signal. Here it is actively wrong in both directions, as the tests
 * for this module show:
 *
 * - it *under*-scores real typos, because a single-token misspelling shares no
 *   tokens at all (`CARREFOURE` / `CARREFOURA` → overlap 0);
 * - it *over*-scores sub-brands, because a subset shares all of the smaller
 *   side's tokens (`EMIRATES` / `EMIRATES NBD` → overlap 1.0).
 *
 * Character bigrams measure what fuzzy matching is actually for here: is this
 * the same word, spelled slightly differently?
 */
export const FUZZY_THRESHOLD = 0.85;

/** Bucket key length. Short enough to survive a first-character typo rarely, long enough to prune hard. */
const BUCKET_PREFIX = 3;

export type FuzzyPair = {
  leftId: string;
  rightId: string;
  similarity: number;
};

/**
 * Buckets payees by the first characters of their normalized name *and* by
 * their first token, so `AMAZON MARKETPLACE` and `AMAZON` land together even
 * though a raw prefix bucket would already have matched them — the second key
 * is what catches variants that differ early but share a stem word.
 */
function bucketsFor(payee: DetectedPayee): string[] {
  const normalized = payee.forms.punctuationNormalized;
  if (!normalized) return [];

  const keys = new Set<string>();
  keys.add(normalized.slice(0, BUCKET_PREFIX));
  const firstToken = payee.forms.tokenized[0];
  if (firstToken) keys.add(`T:${firstToken}`);
  return [...keys];
}

/**
 * Returns candidate pairs above the similarity floor, strongest first.
 *
 * Pairs are deduplicated across buckets and ordered deterministically so the
 * same budget always produces the same suggestions.
 */
export function findFuzzyPairs(
  payees: DetectedPayee[],
  threshold: number = FUZZY_THRESHOLD
): FuzzyPair[] {
  const buckets = new Map<string, DetectedPayee[]>();
  for (const payee of payees) {
    for (const key of bucketsFor(payee)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(payee);
      else buckets.set(key, [payee]);
    }
  }

  const seen = new Set<string>();
  const pairs: FuzzyPair[] = [];

  for (const bucket of buckets.values()) {
    // A bucket that swallowed most of the budget is not a useful signal — it
    // means the prefix is generic. Skip it rather than doing the quadratic work.
    if (bucket.length < 2 || bucket.length > MAX_BUCKET_SIZE) continue;

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const left = bucket[i];
        const right = bucket[j];
        const [leftId, rightId] =
          left.candidate.id < right.candidate.id
            ? [left.candidate.id, right.candidate.id]
            : [right.candidate.id, left.candidate.id];

        const key = `${leftId}|${rightId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // A subset pair is an *extra word*, not a misspelling — `EMIRATES` vs
        // `EMIRATES NBD`, `WOOLWORTHS` vs `WOOLWORTHS MOBILE`. Those are very
        // often genuinely different businesses, and character similarity is
        // high precisely because one name contains the other. Rejecting them
        // here is what keeps §7.2's "ambiguous branch/sub-brand naming" out of
        // the suggestions list rather than relying on the score to bury it.
        if (isTokenSubset(left.forms.tokenized, right.forms.tokenized)) continue;

        const similarity = bigramDice(
          normalizeForCompare(left.candidate.name),
          normalizeForCompare(right.candidate.name)
        );
        if (similarity >= threshold) {
          pairs.push({ leftId, rightId, similarity });
        }
      }
    }
  }

  return pairs.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      a.leftId.localeCompare(b.leftId) ||
      a.rightId.localeCompare(b.rightId)
  );
}

/**
 * Above this, a bucket is generic rather than informative. Comparing 500
 * payees that merely start with the same three letters produces noise, not
 * suggestions.
 */
const MAX_BUCKET_SIZE = 200;

/** True when either token set contains the other — i.e. the difference is whole words. */
function isTokenSubset(left: string[], right: string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return false;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}

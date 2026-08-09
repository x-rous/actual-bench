/**
 * Text normalization and comparison for reconciliation matching (RD-071 §5.3).
 *
 * Two rules govern this module:
 *
 * 1. **Text never finds candidates, it only ranks them.** Candidate generation
 *    is exact-amount + date-window (see `actualIndex.ts`). Text similarity may
 *    never bridge an amount difference (feature spec §11).
 * 2. **Comparison mode is per target.** The curated/imported payee is a
 *    short-vs-short `symmetric` comparison; notes are an asymmetric
 *    `containment` comparison, because a note may legitimately contain the
 *    bank's text *plus* the user's own additions. Scoring notes symmetrically
 *    would penalise a true match for the user's own words.
 */

import { stripNoteTags } from "../noteTags";
import type {
  MatchReason,
  NeedleFloor,
  TextCompareMode,
  TextMatchConfig,
  TextPreprocessStep,
  TextTarget,
  TextTargetField,
} from "../types";

/**
 * Normalize free text for comparison (feature spec §13).
 *
 * Case-insensitive, diacritic-insensitive, punctuation-insensitive, whitespace
 * collapsed. Punctuation becomes a space rather than being deleted, so
 * `AMZN Mktp AE*2J8G4` tokenizes as `AMZN MKTP AE 2J8G4` and `*` cannot glue
 * two unrelated tokens together.
 */
export function normalizeForCompare(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    // Strip combining marks so "Café" and "Cafe" compare equal.
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split normalized text into tokens. Returns `[]` for empty input. */
export function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(" ") : [];
}

/**
 * Dice coefficient over character bigrams — good at catching shared merchant
 * stems (`CARREFOUR MARKET` vs `Carrefour`) that token equality misses.
 */
export function bigramDice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (aGrams.size === 0 || bGrams.size === 0) return 0;

  let shared = 0;
  for (const [gram, count] of aGrams) {
    const other = bGrams.get(gram);
    if (other) shared += Math.min(count, other);
  }
  return (2 * shared) / (countAll(aGrams) + countAll(bGrams));
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  const compact = value.replace(/\s+/g, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function countAll(grams: Map<string, number>): number {
  let total = 0;
  for (const count of grams.values()) total += count;
  return total;
}

/**
 * Token overlap coefficient: shared tokens over the *smaller* token set.
 *
 * Deliberately not Jaccard. `AMAZON AE` vs `AMAZON` should read as a strong
 * signal; Jaccard would halve it purely because one side carries an extra
 * country token.
 */
export function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const token of new Set(a)) {
    if (setB.has(token)) shared += 1;
  }
  return shared / Math.min(new Set(a).size, new Set(b).size);
}

/**
 * Symmetric similarity for short-vs-short fields (payee, imported payee).
 *
 * Blends bigram Dice with token overlap: Dice catches stem similarity, overlap
 * catches exact shared tokens. Identical strings score 1.
 */
export function symmetricSimilarity(a: string, b: string): number {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return 0.6 * bigramDice(left, right) + 0.4 * tokenOverlap(tokenize(left), tokenize(right));
}

/**
 * Asymmetric containment: does `needle` occur inside `haystack`?
 *
 * This is what makes the notes target work. For a user whose transactions are
 * created by SMS/n8n automation, notes hold the bank's own text verbatim plus
 * the user's own comment — `"<bank text> #One | paid for Dad"`. A contiguous
 * token-aligned hit scores 1.0 and the user's extra words cost nothing; a
 * symmetric metric would score that true match around 0.65.
 *
 * Falls back to the fraction of needle tokens present in the haystack when
 * there is no contiguous hit, so a reordered or partially-rewritten note still
 * contributes proportionally.
 */
export function containmentSimilarity(needle: string, haystack: string): number {
  const n = normalizeForCompare(needle);
  const h = normalizeForCompare(haystack);
  if (!n || !h) return 0;

  // Pad so matching is token-aligned: "FEE" must not hit inside "COFFEE".
  if (` ${h} `.includes(` ${n} `)) return 1;

  const needleTokens = new Set(tokenize(n));
  if (needleTokens.size === 0) return 0;
  const haystackTokens = new Set(tokenize(h));
  let present = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) present += 1;
  }
  return present / needleTokens.size;
}

// ---------------------------------------------------------------------------
// Needle floor
// ---------------------------------------------------------------------------

/**
 * Corpus token frequencies, used to reject needles that carry no distinguishing
 * information. Built once per session from the Actual candidate window.
 */
export type TextCorpus = {
  documentCount: number;
  /** token -> number of documents containing it. */
  documentFrequency: Map<string, number>;
};

/**
 * Below this many documents, token frequencies are meaningless: in a 3-document
 * corpus the smallest possible non-zero frequency is 0.33, so a strict
 * `maxCorpusFrequency` would reject every needle. Small candidate windows fall
 * back to the length/token floor alone.
 */
export const MIN_CORPUS_FOR_FREQUENCY = 10;

export function buildTextCorpus(documents: (string | null | undefined)[]): TextCorpus {
  const documentFrequency = new Map<string, number>();
  let documentCount = 0;
  for (const document of documents) {
    const normalized = normalizeForCompare(document);
    if (!normalized) continue;
    documentCount += 1;
    for (const token of new Set(tokenize(normalized))) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  return { documentCount, documentFrequency };
}

/**
 * Decide whether a needle is distinctive enough to be trusted under
 * `containment` (RD-071 §5.3 — mandatory, not a nicety).
 *
 * Without this, a statement description of `FEE` or `PAYMENT` matches a large
 * share of an account's notes and containment becomes a false-positive
 * generator. Two independent guards:
 *
 * - **length/token floor**: very short single-token needles are rejected;
 * - **corpus frequency**: a needle whose every token is common across the
 *   candidate window carries no information, whatever its length.
 */
export function passesNeedleFloor(
  needle: string,
  floor: NeedleFloor,
  corpus?: TextCorpus
): boolean {
  const normalized = normalizeForCompare(needle);
  if (!normalized) return false;

  const tokens = tokenize(normalized);
  const alphanumericLength = normalized.replace(/\s/g, "").length;
  if (alphanumericLength < floor.minChars && tokens.length < floor.minTokens) {
    return false;
  }

  if (corpus && corpus.documentCount >= MIN_CORPUS_FOR_FREQUENCY) {
    const everyTokenIsCommon = tokens.every((token) => {
      const frequency = (corpus.documentFrequency.get(token) ?? 0) / corpus.documentCount;
      return frequency > floor.maxCorpusFrequency;
    });
    if (everyTokenIsCommon) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Target evaluation
// ---------------------------------------------------------------------------

/** The Actual-side values a target can read. */
export type TextTargetValues = Record<TextTargetField, string | null>;

export type TextEvaluation = {
  /** 0..1, already scaled by the target's weight. `null` when nothing scored. */
  similarity: number | null;
  reasons: MatchReason[];
};

function applyPreprocess(value: string, steps: TextPreprocessStep[]): string {
  let out = value;
  for (const step of steps) {
    if (step === "strip-tags") out = stripNoteTags(out);
  }
  return out;
}

function compare(
  statementText: string,
  targetValue: string,
  mode: TextCompareMode
): number {
  return mode === "containment"
    ? containmentSimilarity(statementText, targetValue)
    : symmetricSimilarity(statementText, targetValue);
}

/**
 * Score one target, returning both the similarity and the structured reason.
 *
 * A skipped target emits a `text-skipped` reason rather than a zero, so the
 * inspector can say *why* a field contributed nothing — "Payee not compared
 * (empty)" — which is how a mis-configured profile becomes visible instead of
 * mysterious.
 */
export function evaluateTarget(
  statementDescription: string,
  values: TextTargetValues,
  target: TextTarget,
  floor: NeedleFloor,
  corpus?: TextCorpus
): TextEvaluation {
  const statementText = normalizeForCompare(statementDescription);
  if (!statementText) {
    return {
      similarity: null,
      reasons: [{ kind: "text-skipped", field: target.field, why: "no-statement-text" }],
    };
  }

  const rawValue = values[target.field];
  const value = rawValue ? applyPreprocess(rawValue, target.preprocess) : "";
  if (!normalizeForCompare(value)) {
    return {
      similarity: null,
      reasons: [{ kind: "text-skipped", field: target.field, why: "empty" }],
    };
  }

  // The floor guards the asymmetric direction only: under `symmetric` both
  // sides constrain each other, so a short string is not dangerous there.
  if (target.mode === "containment" && !passesNeedleFloor(statementDescription, floor, corpus)) {
    return {
      similarity: null,
      reasons: [{ kind: "text-skipped", field: target.field, why: "below-needle-floor" }],
    };
  }

  const similarity = compare(statementText, value, target.mode) * target.weight;
  return {
    similarity,
    reasons: [
      { kind: "text", field: target.field, mode: target.mode, similarity: round2(similarity) },
    ],
  };
}

export type TextScore = {
  /** 0..1 across all enabled targets, or `null` when none could be scored. */
  similarity: number | null;
  /** The target that produced `similarity`. */
  field: TextTargetField | null;
  reasons: MatchReason[];
};

/**
 * Score the statement description against every enabled target and combine.
 *
 * `best-of` (default) takes the max, so an empty or irrelevant field
 * contributes nothing rather than diluting the score — which is why it is safe
 * as the default for a brand-new profile that knows nothing about the user's
 * workflow. `priority-first` walks by priority and takes the first target that
 * clears the threshold, for users who know which field is authoritative.
 */
export function scoreText(
  statementDescription: string,
  values: TextTargetValues,
  config: TextMatchConfig,
  floor: NeedleFloor,
  corpus?: TextCorpus
): TextScore {
  const enabled = config.targets
    .filter((target) => target.enabled)
    .sort((a, b) => a.priority - b.priority);

  const reasons: MatchReason[] = [];
  let best: { similarity: number; field: TextTargetField } | null = null;

  for (const target of enabled) {
    const evaluation = evaluateTarget(statementDescription, values, target, floor, corpus);
    reasons.push(...evaluation.reasons);
    if (evaluation.similarity === null) continue;

    if (config.combine === "priority-first") {
      if (evaluation.similarity >= config.priorityFirstThreshold) {
        return { similarity: evaluation.similarity, field: target.field, reasons };
      }
      // Below threshold: remember it, but keep walking to a lower-priority target.
      if (!best || evaluation.similarity > best.similarity) {
        best = { similarity: evaluation.similarity, field: target.field };
      }
      continue;
    }

    // best-of: strictly greater, so an earlier (higher-priority) target wins ties.
    if (!best || evaluation.similarity > best.similarity) {
      best = { similarity: evaluation.similarity, field: target.field };
    }
  }

  return best
    ? { similarity: best.similarity, field: best.field, reasons }
    : { similarity: null, field: null, reasons };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

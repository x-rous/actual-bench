/**
 * Rules that match whole import strings instead of the merchant (RD-088).
 *
 * Actual writes these itself. Answering "apply this rename in the future" to the
 * payee-rename prompt creates `imported_payee is "<the whole bank line>" → set
 * payee`, and every later rename of the same merchant appends to it, so the
 * condition grows into a list of complete bank strings:
 *
 *   imported_payee oneOf [
 *     "MARKET BOYS PTY LTD Melbourne VI AUS Card xx4534 Value Date: 12/03/2024",
 *     "MARKET BOYS PTY LTD Melbourne VI AUS Card xx9166 Value Date: 24/12/2024",
 *     "MARKET BOYS PTY LTD Sydney Value Date: 10/11/2025"
 *   ] → set payee = MARKET BOYS
 *
 * That rule is already broken for the next import: the card number and the value
 * date change every time, so the next string is not in the list, nothing matches,
 * and a duplicate payee arrives. The list grows by one and never starts working.
 *
 * The condition that would work is the part all of them agree on —
 * `contains "MARKET BOYS PTY"` — and finding it is the problem RD-078 already
 * solved for Payee Cleanup. Its core is imported here **unchanged**: which words
 * name a merchant and which are scenery is one question, and answering it twice
 * produces two differently shaped rules from one budget.
 *
 * Two things are deliberately *not* done here:
 *
 *   * **No backtest.** The diagnostics engine is synchronous and pure over the
 *     rule set; the corpus a backtest needs is a whole-budget read. So detection
 *     claims only what is provable from the rule alone — these values cannot
 *     match the next variant — and the proposal is checked against the budget's
 *     history in the dialog that offers it.
 *   * **No provenance test.** Actual marks nothing, so this matches the *shape*,
 *     and a hand-written rule of the same shape is reported too. That is correct:
 *     it fails on the next import for exactly the same reason.
 */

import {
  compileRuleMatcher,
  coreLadder,
  normalizePatternText,
  rankedCommonRuns,
  type TokenSpread,
} from "@/features/payee-cleanup/lib/core";
import {
  buildCandidates,
  type RuleCandidate,
  type SourceField,
} from "@/features/payee-cleanup/lib/ruleCandidates";
import type { ConditionOrAction, Rule } from "@/types/entities";

/** The two fields a bank's raw merchant text lands in, in preference order. */
const SOURCE_FIELDS: SourceField[] = ["imported_payee", "notes"];

const LITERAL_OPS = new Set(["is", "oneOf"]);
const PATTERN_OPS = new Set(["contains", "matches", "doesNotContain"]);

export type LiteralImportConditions = {
  field: SourceField;
  /** The conditions a rewrite would replace. */
  conditions: ConditionOrAction[];
  /** Distinct literal values across them, in the order they appear. */
  values: string[];
};

function literalValues(part: ConditionOrAction): string[] {
  const raw = Array.isArray(part.value) ? part.value : [part.value];
  return raw.filter((value): value is string => typeof value === "string" && value.trim() !== "");
}

/**
 * The exact-match conditions on one text field, or null when the rule is not of
 * this shape.
 *
 * Several `is` conditions only count under `conditionsOp: "or"`. Under `and`
 * they cannot all be true at once, which is a different and worse problem that
 * `impossibleConditions` already reports — describing the same rule twice, once
 * as impossible and once as improvable, would be noise.
 */
export function collectLiteralImportConditions(rule: Rule): LiteralImportConditions | null {
  for (const field of SOURCE_FIELDS) {
    const onField = rule.conditions.filter((part) => part.field === field);
    if (onField.length === 0) continue;

    // A rule that already matches on a pattern is already general, whatever else
    // may be wrong with it.
    if (onField.some((part) => PATTERN_OPS.has(part.op))) continue;

    const literals = onField.filter((part) => LITERAL_OPS.has(part.op));
    if (literals.length === 0) continue;
    if (literals.length > 1 && rule.conditionsOp !== "or") continue;

    // Case-insensitively, because Actual lower-cases both sides of an `is`
    // comparison — but *not* whitespace-insensitively, because it does not trim
    // either (`fieldValue === this.value`). Trimming here merged two literals
    // that Actual treats as different, and the same trim in the backtest then
    // read a history row as already matched when the rule does not match it,
    // which is how a conflicting rewrite could look clean.
    const seen = new Set<string>();
    const values: string[] = [];
    for (const part of literals) {
      for (const value of literalValues(part)) {
        const key = value.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(value);
      }
    }

    if (values.length < 2) continue;
    return { field, conditions: literals, values };
  }

  return null;
}

export type Generalisation = {
  /** The words the listed strings share — what the rule was always trying to say. */
  stem: string;
  /**
   * Rewrites that catch **every** value the rule lists today, narrowest first.
   * Ranking between them needs the budget's history and happens in the dialog.
   */
  candidates: RuleCandidate[];
};

/** A stem made only of digits names a card, not a merchant. */
function hasWord(stem: string): boolean {
  return stem.split(" ").some((token) => /^\p{L}{2,}$/u.test(token));
}

/**
 * Whether a candidate still catches everything the rule catches today.
 *
 * The rewrite replaces the list, so anything it does not match is a match the
 * user silently loses. A stem shared by three of five values is a real stem and
 * a bad rewrite; `rankedCommonRuns` is content with a majority, so this is the
 * gate that makes the difference.
 */
function coversAll(candidate: RuleCandidate, values: string[]): boolean {
  const matches = compileRuleMatcher(candidate.op, candidate.value);
  return values.every((value) => matches(value));
}

/**
 * The rewrite these values support, or null when they support none.
 *
 * `spread` is the budget's word-rarity measure. Detection runs without it and is
 * optimistic by design; the dialog re-derives with it once the history is loaded.
 */
export function deriveGeneralisation(
  values: string[],
  field: SourceField,
  spread?: TokenSpread
): Generalisation | null {
  const all = collectGeneralisations(values, field, spread);
  const first = all[0];
  if (!first) return null;
  return {
    stem: first.stem,
    candidates: all.filter((entry) => entry.stem === first.stem).map((entry) => entry.candidate),
  };
}

export type GeneralisationCandidate = { stem: string; candidate: RuleCandidate };

/**
 * How many rewrites are worth putting in front of someone.
 *
 * They differ only in how much of the merchant's name they keep, and a person
 * choosing between nine variations of one sentence is not being given a choice,
 * they are being given a puzzle. Three: the best one, and two that generalise
 * further.
 */
const MAX_STEMS = 3;

/**
 * Every rewrite these values support, best-guess first — one form per stem.
 *
 * More than one stem, because whether a stem is *usable* depends on what else is
 * in the budget and only a backtest knows that: `UBER` covers every one of that
 * payee's imports and is shared with Uber Eats, at which point there has to be a
 * next candidate rather than silence. Shorter stems also answer the opposite
 * failure — the longest run three imports share can include a price or a branch
 * that changes next month.
 *
 * Only one *form* per stem, though. `buildCandidates` offers a `contains` and
 * two regexes for each, and where the plain `contains` already catches every
 * value the regexes catch exactly the same text while being harder to read: the
 * dialog was offering `contains "MARKET BOYS PTY LTD"` three times in three
 * notations, twice of them labelled identically. The regex forms are kept only
 * for the case they exist for — a name whose punctuation stops a literal
 * `contains` from covering the values at all.
 */
export function collectGeneralisations(
  values: string[],
  field: SourceField,
  spread?: TokenSpread
): GeneralisationCandidate[] {
  // Values differing only in spacing or punctuation are one string to Actual's
  // matcher, and one string shows nothing about what varies.
  const distinct = new Set(values.map((value) => normalizePatternText(value)));
  if (distinct.size < 2) return [];

  const found: GeneralisationCandidate[] = [];
  const seenStems = new Set<string>();

  for (const run of rankedCommonRuns(values, undefined, 0.5, spread)) {
    for (const stem of coreLadder(run)) {
      if (!hasWord(stem)) continue;
      if (seenStems.has(stem)) continue;

      const forms = buildCandidates(stem, field).filter((candidate) =>
        coversAll(candidate, values)
      );
      const chosen = forms.find((candidate) => candidate.op === "contains") ?? forms[0];
      if (!chosen) continue;

      seenStems.add(stem);
      found.push({ stem, candidate: chosen });
      if (found.length >= MAX_STEMS) return found;
    }
  }

  return found;
}

export type OverSpecificImportMatch = LiteralImportConditions & Generalisation;

/** Detection end to end, for one rule. */
export function detectOverSpecificImportMatch(rule: Rule): OverSpecificImportMatch | null {
  const literal = collectLiteralImportConditions(rule);
  if (!literal) return null;
  const generalisation = deriveGeneralisation(literal.values, literal.field);
  if (!generalisation) return null;
  return { ...literal, ...generalisation };
}

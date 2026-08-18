/**
 * Payees the next import will fail to re-resolve (RD-087).
 *
 * Actual resolves an imported transaction's payee **by name and only by name**
 * (`resolvePayee` → `getPayeeByName`, pinned in `nativeSemantics.test.ts`).
 * There is no historical `imported_payee` lookup and no learning, so the moment
 * a user curates a payee — renames it, or merges variants into it — the next
 * import of the original bank text creates a fresh duplicate. Cleaning up
 * without a rule is temporary by construction.
 *
 * This module finds the payees in that position and proposes the rule that
 * fixes it, in Actual's own shape and stage.
 *
 * **Two rule shapes, chosen from the evidence** (§5):
 *
 * - *Stable text* — a handful of distinct import strings. Proposes
 *   `imported_payee oneOf [texts]`, exactly what Actual's own
 *   `updatePayeeRenameRule` writes. Needs **no backtest**: an exact string
 *   cannot match text that does not equal it, so the only risk is another payee
 *   holding an identical string, which is one index lookup.
 * - *Varying text sharing a stem* — the card/store number changes every time.
 *   Proposes the RD-078 regex candidate, which **must** be backtested, because
 *   a pattern broad enough to catch future variants is broad enough to catch
 *   somebody else's transactions.
 *
 * If the text neither repeats nor shares a stem, there is no honest rule to
 * propose and the payee simply does not appear.
 */

import type { Rule } from "@/types/entities";
import type { PayeeCleanupCandidate } from "../types";
import { isCleanupEligible } from "./eligibility";
import { reduceFully } from "./reduce";
import {
  chooseCondition,
  classifyRelatedRules,
  exactNameCoverage,
  scoreCandidate,
  type CandidateScore,
  type ImportedTextRow,
  type RuleCandidate,
  type SourceField,
} from "./ruleCandidates";
import {
  commonTokenRun,
  compileRuleMatcher,
  coreTokens,
  followedInSomeText,
  hasMarker,
  maximalCommonRun,
  measureTokenSpread,
  type TokenSpread,
} from "./core";

/** The share of a payee's transactions an existing rule must catch to settle it. */
const COVERED_SHARE = 0.5;

/** Below this, a payee is a one-off rather than a pattern worth automating. */
export const DEFAULT_TRANSACTION_FLOOR = 2;

export type RuleGapProposal =
  | {
      shape: "one-of";
      field: SourceField;
      /** The exact import strings to match, as they appear in the history. */
      texts: string[];
      /**
       * An existing `pre`-stage rename rule for this payee, if there is one.
       * Present means *extend that rule*, not create a second one — which is
       * what keeps a budget from accumulating one rule per merchant.
       */
      extendsRule: Rule | null;
    }
  | {
      shape: "matches";
      field: SourceField;
      candidate: RuleCandidate;
      score: CandidateScore;
      extendsRule: null;
      /** True when the user typed this condition rather than the scan proposing it. */
      edited?: boolean;
      /** Set when the user's pattern will not compile. */
      invalid?: boolean;
    };

/** A rule that already sets this payee, and how much of its history it catches. */
export type ExistingPayeeRule = {
  rule: Rule;
  /** Transactions of this payee whose import text the rule already matches. */
  covered: number;
  /** Total transactions the payee has import text for. */
  total: number;
  /**
   * True when every condition could be checked against the import text. A rule
   * that also tests an amount or an account cannot be judged from here, so it is
   * shown but never used to rule a payee out.
   */
  fullyChecked: boolean;
};

export type RuleGap = {
  payee: PayeeCleanupCandidate;
  transactionCount: number;
  /** Distinct import strings on record, most frequent first. */
  texts: ImportedTextRow[];
  proposal: RuleGapProposal;
  /**
   * Safe to create without opening it: nothing else in the budget's history
   * would be caught, and no existing rule is flagged as competing.
   */
  safe: boolean;
  /** Why it is not safe, in the user's terms. Empty when it is. */
  cautions: string[];
  /**
   * Rules that already set this payee. Present when they do not cover enough of
   * its history to rule it out — the user should be able to see and open the
   * rule they already have rather than be told, wrongly, that there isn't one.
   */
  existingRules: ExistingPayeeRule[];
};

/** A condition the user typed themselves, replacing the proposed one. */
export type RuleGapOverride = {
  field: SourceField;
  op: "matches" | "contains";
  value: string;
};

export type RuleGapInputs = {
  candidates: PayeeCleanupCandidate[];
  rows: ImportedTextRow[];
  rules: Rule[];
  /** Undefined means "not loaded" — see `transactionCounts` in `orphans.ts`. */
  transactionCounts: Map<string, number> | undefined;
  /**
   * Payees already part of a live cleanup suggestion. Excluded, because that
   * suggestion's own "Future imports" step already proposes a rule for them:
   * listing them here would offer the same rule from two places, with
   * independently editable text. Merge first.
   */
  clusteredPayeeIds: Set<string>;
  /** The history read hit its row cap, so "nothing else matches" is not provable. */
  truncated?: boolean;
  transactionFloor?: number;
  /**
   * Edits keyed by payee id, so they survive a re-scan — the same reasoning as
   * cluster corrections. An override replaces the proposal outright rather than
   * adjusting it, because the user has said what they want the rule to be.
   */
  overrides?: Map<string, RuleGapOverride>;
};

/** Whether a user-typed pattern will compile at all. */
export function isValidPattern(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

/** A `pre`-stage `imported_payee oneOf … → set payee <id>` rule, Actual's own shape. */
export function findRenameRuleFor(rules: Rule[], payeeId: string): Rule | null {
  return (
    rules.find(
      (rule) =>
        rule.stage === "pre" &&
        rule.actions.some(
          (a) => a.field === "payee" && a.op === "set" && a.value === payeeId
        ) &&
        rule.conditions.some(
          (c) => c.field === "imported_payee" && c.op === "oneOf" && Array.isArray(c.value)
        )
    ) ?? null
  );
}

/**
 * What one rule condition says about a piece of import text.
 *
 * Three answers, not two, and collapsing the last two was a bug:
 *
 * - a **boolean** when the condition is about this very field;
 * - `"not-applicable"` when it is about the *other* text field. The index holds
 *   one row per field, so a `notes` condition simply has nothing to say about an
 *   `imported_payee` row — the transaction behind it may well have matching
 *   notes we are not looking at. That is not an inability to read the rule;
 * - `"unreadable"` when it is about something absent from the index entirely —
 *   an amount, an account, a date. Only this one may stop a rule settling a
 *   payee, because only this one might be the condition that fails.
 */
type ConditionVerdict = boolean | "not-applicable" | "unreadable";

const TEXT_FIELDS = new Set<string>(["imported_payee", "notes"]);

function conditionMatches(
  condition: Rule["conditions"][number],
  field: SourceField,
  text: string
): ConditionVerdict {
  if (condition.field !== field) {
    return condition.field && TEXT_FIELDS.has(condition.field)
      ? "not-applicable"
      : "unreadable";
  }

  const upper = text.toUpperCase();
  const value = condition.value;
  const asString = typeof value === "string" ? value.toUpperCase() : null;
  const asList = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => v.toUpperCase())
    : null;

  switch (condition.op) {
    case "is":
      return asString === null ? "unreadable" : upper === asString;
    case "contains":
      return asString === null
        ? "unreadable"
        : compileRuleMatcher("contains", String(value))(text);
    case "doesNotContain":
      return asString === null
        ? "unreadable"
        : !compileRuleMatcher("contains", String(value))(text);
    case "oneOf":
      return asList === null ? "unreadable" : asList.includes(upper);
    case "notOneOf":
      return asList === null ? "unreadable" : !asList.includes(upper);
    case "matches":
      if (asString === null) return "unreadable";
      // Through the shared matcher, so this agrees with the backtest and with
      // the engine. It decides whether a payee is already handled and which of
      // its text to subtract, so a wrong verdict here hides a payee outright.
      return compileRuleMatcher("matches", String(value))(text);
    default:
      return "unreadable";
  }
}

/**
 * Whether a rule matches one piece of import text, and whether that answer can
 * be trusted to rule the payee out.
 *
 * The two operators need opposite reasoning, and conflating them was a bug:
 *
 * - **`or`** — a condition that matches is enough on its own, so anything the
 *   unreadable conditions might do can only *add* matches. The count is a lower
 *   bound, and a lower bound is exactly what an exclusion needs. A rule reading
 *   `notes contains RIDEGO or imported payee contains RIDEGO` is fully
 *   understood even though only one of its two conditions applies to any given
 *   row.
 * - **`and`** — every condition must hold, so a condition we cannot read might
 *   be the one that fails. The count is an upper bound, and an upper bound
 *   cannot be used to hide a payee.
 */
function ruleMatchesText(
  rule: Rule,
  field: SourceField,
  text: string
): { matches: boolean; fullyChecked: boolean } {
  const verdicts = rule.conditions.map((c) => conditionMatches(c, field, text));
  const answered = verdicts.filter((v): v is boolean => typeof v === "boolean");
  const unreadable = verdicts.some((v) => v === "unreadable");

  // Nothing to go on for this row: a `notes` rule against an imported-payee row
  // cannot match it, but that says nothing about how well the rule is understood.
  if (answered.length === 0) return { matches: false, fullyChecked: !unreadable };

  if (rule.conditionsOp === "or") {
    return { matches: answered.some(Boolean), fullyChecked: true };
  }
  return { matches: answered.every(Boolean), fullyChecked: !unreadable };
}

/**
 * The rules that already set this payee, measured against its own import text.
 *
 * The stem of the payee's *name* is the wrong thing to compare: a payee called
 * `K&M Fashion` whose imports read `K AND M ASHDOWN` shares no words with either,
 * so a rule reading `notes contains "K AND M"` looked unrelated — and the payee
 * was reported as needing the rule it already had.
 */
export function rulesSettingPayee(
  rules: Rule[],
  payeeId: string,
  texts: ImportedTextRow[]
): ExistingPayeeRule[] {
  const total = texts.reduce((sum, row) => sum + row.transactionCount, 0);
  const found: ExistingPayeeRule[] = [];

  for (const rule of rules) {
    const setsThisPayee = rule.actions.some((a) => {
      if (a.field !== "payee" || a.op !== "set") return false;
      const values = Array.isArray(a.value) ? a.value : [a.value];
      return values.some((v) => typeof v === "string" && v === payeeId);
    });
    if (!setsThisPayee) continue;

    let covered = 0;
    let fullyChecked = true;
    for (const row of texts) {
      const result = ruleMatchesText(rule, row.field, row.text);
      if (result.matches) covered += row.transactionCount;
      if (!result.fullyChecked) fullyChecked = false;
    }

    found.push({ rule, covered, total, fullyChecked });
  }

  return found.sort((a, b) => b.covered - a.covered);
}

/** The texts an existing rename rule already covers, for the comparison form. */
function textsAlreadyCovered(rule: Rule | null): Set<string> {
  if (!rule) return new Set();
  const covered = new Set<string>();
  for (const condition of rule.conditions) {
    if (condition.field !== "imported_payee" || condition.op !== "oneOf") continue;
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    for (const value of values) {
      if (typeof value === "string") covered.add(value.trim().toUpperCase());
    }
  }
  return covered;
}

/**
 * Whether another payee's history holds an identical import string.
 *
 * This is the entire safety check an exact-match rule needs. If two payees
 * genuinely receive the same text, no rule can tell them apart and the user has
 * to be told rather than handed a rule that will steal transactions.
 */
function textsClaimedByOthers(
  texts: ImportedTextRow[],
  rows: ImportedTextRow[],
  payeeId: string,
  payeeName: string
): string[] {
  // Field and text in one key, separated by a character no bank statement can
  // contain, so `notes "ACME"` and `imported_payee "ACME"` stay distinct.
  const wanted = new Map(texts.map((t) => [`${t.field}\u0000${t.text.toUpperCase()}`, t.text]));
  const clashes = new Set<string>();

  const ownName = payeeName.toUpperCase();
  for (const row of rows) {
    // Attributed by id *or* name, exactly as the backtest attributes them: a
    // grouped read can return one without the other, and skipping every row
    // with no id meant a text claimed by another payee under its name alone
    // raised no caution at all.
    if (row.payeeId === payeeId) continue;
    if (row.payeeId === null && (row.payeeName ?? "").toUpperCase() === ownName) continue;
    if (row.payeeId === null && !row.payeeName) continue;

    const hit = wanted.get(`${row.field}\u0000${row.text.toUpperCase()}`);
    if (hit) clashes.add(hit);
  }
  return [...clashes];
}

function groupRowsByPayee(rows: ImportedTextRow[]): Map<string, ImportedTextRow[]> {
  const byPayee = new Map<string, ImportedTextRow[]>();
  for (const row of rows) {
    if (!row.payeeId) continue;
    byPayee.set(row.payeeId, [...(byPayee.get(row.payeeId) ?? []), row]);
  }
  return byPayee;
}

/**
 * The payees that need a rule, most valuable first.
 *
 * Exclusions run cheapest-first on purpose (§3): the regex backtest is the only
 * expensive step here, and by the time a payee reaches it almost everything has
 * already been ruled out — most of it by the exact-name test, since a payee
 * whose imports already equal its name needs nothing at all.
 */
export function findRuleGaps(inputs: RuleGapInputs): RuleGap[] {
  // Fail closed, exactly as the orphan finder does: without counts we cannot
  // apply the floor, and guessing would put one-off payees in front of the user.
  if (!inputs.transactionCounts) return [];

  const floor = inputs.transactionFloor ?? DEFAULT_TRANSACTION_FLOOR;
  // Measured once for the whole budget: which words belong to one payee and
  // which are scenery everyone shares.
  const spread = measureTokenSpread(inputs.rows);
  const byPayee = groupRowsByPayee(inputs.rows);
  const gaps: RuleGap[] = [];

  for (const payee of inputs.candidates) {
    // 1 — transfer and tombstoned payees are never touched.
    if (!isCleanupEligible(payee.metadata)) continue;

    // 2 — already being dealt with as a merge, which carries its own rule.
    if (inputs.clusteredPayeeIds.has(payee.id)) continue;

    // 3 — nothing to match on. A manually created payee has no import history,
    // and a rule built from nothing would match nothing.
    const texts = byPayee.get(payee.id) ?? [];
    if (texts.length === 0) continue;

    // 4 — Actual already resolves these by name, so a rule would be noise. This
    // is the exclusion that does the heavy lifting on a curated budget.
    //
    // Only meaningful when there *are* imported-payee rows: a payee whose text
    // arrives in `notes` has nothing for name matching to compare against, and
    // reading "0 of 0 covered" as full coverage hid it entirely.
    const importedRows = texts.filter((t) => t.field === "imported_payee");
    const exact = exactNameCoverage(payee.name, texts);
    if (importedRows.length > 0 && exact.covered === importedRows.length) continue;

    // 5 — is this payee already handled?
    //
    // Measured against the payee's own import text, not against the stem of its
    // name. A payee called `K&M Fashion` whose imports read `K AND M ASHDOWN`
    // shares no words with either, so a rule reading `notes contains "K AND M"`
    // looked unrelated and the payee was reported as needing the rule it already
    // had — while being told, wrongly, that the rule set a *different* payee.
    //
    // Rules that also test something invisible from here (an amount, an account)
    // are never used to rule a payee out, only shown.
    const renameRule = findRenameRuleFor(inputs.rules, payee.id);
    const ownRules = rulesSettingPayee(inputs.rules, payee.id, texts);
    const totalTextTransactions = texts.reduce((sum, r) => sum + r.transactionCount, 0);
    const alreadyHandled = ownRules.some(
      (r) =>
        r.fullyChecked &&
        r.rule.id !== renameRule?.id &&
        totalTextTransactions > 0 &&
        r.covered / totalTextTransactions >= COVERED_SHARE
    );
    if (alreadyHandled) continue;

    // The payee's own rename rule is deliberately not disqualifying: it resolves
    // the texts it lists and nothing else, so a text it has never seen still
    // needs adding. `proposeRule` decides whether anything is missing.
    const related = classifyRelatedRules(
      inputs.rules,
      new Set([payee.id]),
      reduceFully(payee.name).stem
    );

    // 6 — one transaction is a coincidence, not a pattern.
    const transactionCount = inputs.transactionCounts.get(payee.id) ?? 0;
    if (transactionCount < floor) continue;

    // 7 — is there an honest rule to propose at all?
    const proposal = proposeRule(payee, texts, inputs, renameRule, ownRules, spread);
    if (!proposal) continue;

      // Backstop. The subtraction above should already prevent it, but a proposal
    // identical to a rule that exists would create a second rule doing exactly
    // what the first does — the sprawl this whole feature is meant to prevent —
    // and that is worth refusing outright rather than relying on one guard.
    if (duplicatesExistingRule(proposal, ownRules)) continue;

    const cautions = collectCautions(
      proposal,
      texts,
      inputs,
      related,
      payee.id,
      ownRules,
      transactionCount,
      payee.name
    );
    gaps.push({
      payee,
      transactionCount,
      texts: [...texts].sort((a, b) => b.transactionCount - a.transactionCount),
      proposal,
      safe: cautions.length === 0,
      cautions,
      // Only the rules that do not already settle the matter — those excluded
      // the payee above.
      existingRules: ownRules,
    });
  }

  // Most valuable first: the number of past transactions the rule would have
  // assigned is the honest measure of what it is worth.
  return gaps.sort((a, b) => b.transactionCount - a.transactionCount);
}

/**
 * Picks the shape for one payee.
 *
 * Stable text wins when it applies, because an exact-match rule cannot
 * misfire and it is what Actual itself writes. The regex is the fallback for
 * text that varies — the case an exact list could never keep up with.
 */
function proposeRule(
  payee: PayeeCleanupCandidate,
  texts: ImportedTextRow[],
  inputs: RuleGapInputs,
  renameRule: Rule | null,
  ownRules: ExistingPayeeRule[],
  spread: TokenSpread
): RuleGapProposal | null {
  const imported = texts.filter((t) => t.field === "imported_payee");
  const notes = texts.filter((t) => t.field === "notes");
  // `imported_payee` is where a bank's own text lands; `notes` is the fallback
  // for the institutions that put it there instead.
  const source = imported.length > 0 ? imported : notes;
  if (source.length === 0) return null;
  const field: SourceField = imported.length > 0 ? "imported_payee" : "notes";

  // A rename rule matches on `imported_payee`, so it cannot extend a notes proposal.
  const extendsRule = field === "imported_payee" ? renameRule : null;
  const alreadyListed = textsAlreadyCovered(extendsRule);

  // Only the texts nothing already handles. Subtracting the rename rule's own
  // list is not enough: *any* rule that sets this payee already catches what it
  // matches, and deriving the core from that text produced a rule identical to
  // the one already doing the job — `notes contains NIMBUS OFFICE APPS`
  // proposed alongside `notes contains NIMBUS OFFICE APPS`.
  const uncovered = source.filter((row) => {
    if (alreadyListed.has(row.text.trim().toUpperCase())) return false;
    // Only rules we could read in full. A rule that also tests an amount was
    // deliberately not trusted to hide the payee, and it must not quietly
    // remove the payee's text either — that would hide it just as effectively.
    return !ownRules.some(
      (r) => r.fullyChecked && ruleMatchesText(r.rule, row.field, row.text).matches
    );
  });
  if (uncovered.length === 0) return null;

  const override = inputs.overrides?.get(payee.id);
  if (override) {
    const candidate: RuleCandidate = {
      field: override.field,
      op: override.op,
      value: override.value,
      description:
        override.op === "contains"
          ? `contains "${override.value}"`
          : `matches ${override.value}`,
    };
    const score = scoreCandidate(
      candidate,
      inputs.rows,
      new Set([payee.id]),
      new Set([payee.name.toUpperCase()])
    );
    return {
      shape: "matches",
      field: override.field,
      candidate,
      score,
      extendsRule: null,
      edited: true,
      invalid: override.op === "matches" && !isValidPattern(override.value),
    };
  }

  const uncoveredTexts = uncovered.map((row) => row.text);

  // Does the text vary around a core, or is it the same string every time?
  //
  // The count of distinct texts is *not* the test — three texts each carrying
  // their own date look "stable" by that measure while being guaranteed never to
  // recur, so an exact list of them catches the transactions already on record
  // and nothing ever again. What matters is whether anything varies around a
  // shared core, which is what a pattern is for.
  const weights = uncovered.map((row) => row.transactionCount);
  const run = commonTokenRun(uncoveredTexts, weights, 0.5, spread);
  const runLength = run ? run.split(" ").length : 0;

  // Text carrying a marker *does* vary, whatever is left once the marker is
  // stripped. Asking this of the stripped text was inconsistent: two imports
  // reading `#2023-10 BB Kestrel BELMONT` and `#2023-09 BB Kestrel BELMONT` were
  // judged identical, and then listed verbatim — producing a rule that matches
  // one month and never fires again.
  const dated = uncoveredTexts.some(hasMarker);
  const variesAroundRun =
    run !== null &&
    (dated || uncoveredTexts.some((text) => coreTokens(text).length > runLength));

  if (variesAroundRun && run) {
    // Did anything ever follow the *longest* thing these imports share? If not,
    // where the merchant ends is an artefact of the sample rather than a fact —
    // three identical `Nimbus Storage Spring Valley CA USD10.99` imports make
    // the price look like part of the name.
    //
    // Asked of the longest shared run, not of the core: the core is capped at
    // four words, so text following it may be text we cut ourselves.
    const longest = maximalCommonRun(uncoveredTexts, weights);
    const boundaryShown = longest !== null && followedInSomeText(longest, uncoveredTexts);

    const best = chooseCondition(
      run,
      field,
      inputs.rows,
      new Set([payee.id]),
      new Set([payee.name.toUpperCase()]),
      !boundaryShown
    );

    // Nothing safe means nothing to offer (RD-087 §3, step 7). Proposing the
    // best unsafe attempt instead read as helpful and was not: a budget whose
    // notes all begin the same way put the same doomed condition on every payee
    // at once, each warning that it would catch the others. A condition the user
    // types is different — that one is shown, with what it would catch.
    if (!best || !best.safe || best.score.expectedMatches === 0) return null;

    return {
      shape: "matches",
      field,
      candidate: best.score.candidate,
      score: best.score,
      extendsRule: null,
    };
  }

  // Nothing varies around a shared core, so an exact list is the only honest
  // shape — but only for text that has actually been seen more than once, and
  // only for text carrying no marker. A one-off string is as dead as a dated
  // one: both catch what is already on record and nothing ever again.
  const listable = uncovered.filter(
    (row) => row.transactionCount > 1 && !hasMarker(row.text)
  );
  if (listable.length === 0) return null;

  return {
    shape: "one-of",
    field,
    texts: listable.map((row) => row.text),
    extendsRule,
  };
}

/**
 * Whether this proposal is a rule the payee already has.
 *
 * Compared on what the rule *does* — field, operator and value, with case and
 * spacing folded — rather than on identity, since the point is that creating it
 * would change nothing.
 */
function duplicatesExistingRule(
  proposal: RuleGapProposal,
  ownRules: ExistingPayeeRule[]
): boolean {
  const normalise = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ");

  const proposed =
    proposal.shape === "matches"
      ? [{ op: proposal.candidate.op, value: normalise(proposal.candidate.value) }]
      : proposal.texts.map((t) => ({ op: "oneOf", value: normalise(t) }));

  const covered = (candidate: { op: string; value: string }) =>
    ownRules.some((r) =>
      r.rule.conditions.some((condition) => {
        if (condition.field !== proposal.field) return false;
        if (condition.op !== candidate.op) return false;
        const values = Array.isArray(condition.value) ? condition.value : [condition.value];
        return values.some((v) => typeof v === "string" && normalise(v) === candidate.value);
      })
    );

  // Every part of it, not any part. A proposal listing ["A", "B"] beside a rule
  // that lists ["A"] still offers "B", and discarding it for the overlap took
  // the payee off the tab entirely — reaching past the guard that stops a rule
  // it cannot fully read from removing that payee's text.
  return proposed.every(covered);
}

/** Why a proposal needs a human, in the user's terms rather than the model's. */
function collectCautions(
  proposal: RuleGapProposal,
  texts: ImportedTextRow[],
  inputs: RuleGapInputs,
  related: ReturnType<typeof classifyRelatedRules>,
  payeeId: string,
  ownRules: ExistingPayeeRule[],
  transactionCount: number,
  payeeName: string
): string[] {
  const cautions: string[] = [];

  if (proposal.shape === "one-of") {
    const clashes = textsClaimedByOthers(
      texts.filter((t) => t.field === proposal.field),
      inputs.rows,
      payeeId,
      payeeName
    );
    if (clashes.length > 0) {
      cautions.push(
        `Another payee receives the same text (${clashes.slice(0, 2).join(", ")}), so no rule can tell them apart.`
      );
    }
  } else {
    if (proposal.invalid) {
      cautions.push("That pattern is not valid, so it would never match anything.");
    } else if (proposal.edited && proposal.score.expectedMatches === 0) {
      cautions.push("Nothing in your import history matches this pattern.");
    }
    if (proposal.score.unexpectedMatches > 0) {
      const names = proposal.score.unexpectedExamples
        .map((e) => e.payeeName ?? e.text)
        .slice(0, 2)
        .join(", ");
      cautions.push(
        `This pattern would also catch ${proposal.score.unexpectedMatches} transactions belonging to ${names}.`
      );
    }
    // A "catches nothing else" claim from a partial read is not a basis for
    // creating a rule unseen. Exact-match proposals are unaffected: they do not
    // rest on having seen the whole history.
    if (inputs.truncated) {
      cautions.push(
        "Only the most recent imports were checked, so this pattern may catch more than is shown."
      );
    }
  }

  // A proposal drawn from a fraction of what the payee actually has is thin
  // evidence, whatever the backtest said about the part it could see. The
  // history read is capped, and a payee whose text is mostly beyond that cap
  // looks identical on screen to one read in full.
  const textTransactions = texts.reduce((sum, row) => sum + row.transactionCount, 0);
  if (transactionCount > 0 && textTransactions * 2 < transactionCount) {
    cautions.push(
      `Only ${textTransactions} of this payee's ${transactionCount} transactions had import text that was read, so this rests on part of its history.`
    );
  }

  // Said only when it is true. `classifyRelatedRules` reports a rule as a
  // potential conflict whenever it cannot tie the rule to the payee by name,
  // which includes rules that set this very payee — so claiming a different
  // payee on that basis alone was simply wrong.
  const ownRuleIds = new Set(ownRules.map((r) => r.rule.id));
  if (
    related.some(
      (r) => r.interaction === "potential-conflict" && !ownRuleIds.has(r.rule.id)
    )
  ) {
    cautions.push("An existing rule matches this text and sets a different payee.");
  }

  const partial = ownRules.find((r) => r.covered > 0);
  if (partial) {
    cautions.push(
      `A rule you already have catches ${partial.covered} of these ${partial.total} transactions${
        partial.fullyChecked ? "" : ", and also tests something this page cannot check"
      }.`
    );
  }

  return cautions;
}

/**
 * The `pre`-stage exact-match rule, in the shape Actual's own
 * `updatePayeeRenameRule` writes.
 */
export function buildExactMatchRule(
  field: SourceField,
  texts: string[],
  targetPayeeId: string,
  id: string
): Rule {
  return {
    id,
    stage: "pre",
    conditionsOp: "and",
    conditions: [{ field, op: "oneOf", value: texts, type: "string" }],
    actions: [{ field: "payee", op: "set", value: targetPayeeId, type: "id" }],
  };
}

/**
 * The conditions for an existing rename rule with more texts added.
 *
 * Merges into the rule's own `oneOf` list rather than appending a condition,
 * because `and`-ing two `oneOf` conditions on the same field would match
 * nothing at all.
 */
export function extendExactMatchConditions(
  rule: Rule,
  addTexts: string[]
): Rule["conditions"] {
  let extended = false;
  const conditions = rule.conditions.map((condition) => {
    if (
      extended ||
      condition.field !== "imported_payee" ||
      condition.op !== "oneOf" ||
      !Array.isArray(condition.value)
    ) {
      return condition;
    }
    extended = true;
    const existing = condition.value.filter(
      (v): v is string => typeof v === "string"
    );
    const seen = new Set(existing.map((v) => v.trim().toUpperCase()));
    return {
      ...condition,
      value: [
        ...existing,
        ...addTexts.filter((t) => !seen.has(t.trim().toUpperCase())),
      ],
    };
  });

  return conditions;
}

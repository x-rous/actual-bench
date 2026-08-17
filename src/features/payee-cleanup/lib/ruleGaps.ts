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
  buildCandidates,
  classifyRelatedRules,
  exactNameCoverage,
  normalizePatternText,
  rankCandidates,
  scoreCandidate,
  type CandidateScore,
  type ImportedTextRow,
  type RuleCandidate,
  type SourceField,
} from "./ruleCandidates";

/**
 * How far the ladder may shorten a core. `LVL UP` and `FITNESS` are too little
 * to hang a rule on; `EMIRATES` and `READY SET` are enough. It does not apply to
 * the run itself — see `coreLadder`.
 */
const MIN_CORE_LENGTH = 8;

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
  payeeId: string
): string[] {
  // Field and text in one key, separated by a character no bank statement can
  // contain, so `notes "ACME"` and `imported_payee "ACME"` stay distinct.
  const wanted = new Map(texts.map((t) => [`${t.field}\u0000${t.text.toUpperCase()}`, t.text]));
  const clashes = new Set<string>();

  for (const row of rows) {
    if (row.payeeId === payeeId) continue;
    if (row.payeeId === null) continue;
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

    // 5 — an existing rule already sets this payee. Includes schedule-linked
    // rules, which reach their payee through a rule of their own.
    //
    // The payee's *own* rename rule is deliberately not disqualifying: it
    // resolves the texts it lists and nothing else, so a text it has never seen
    // still needs adding. `proposeRule` decides whether anything is missing.
    const renameRule = findRenameRuleFor(inputs.rules, payee.id);
    const related = classifyRelatedRules(
      inputs.rules,
      new Set([payee.id]),
      reduceFully(payee.name).stem
    );
    if (
      related.some(
        (r) => r.interaction === "already-resolves" && r.rule.id !== renameRule?.id
      )
    ) {
      continue;
    }

    // 6 — one transaction is a coincidence, not a pattern.
    const transactionCount = inputs.transactionCounts.get(payee.id) ?? 0;
    if (transactionCount < floor) continue;

    // 7 — is there an honest rule to propose at all?
    const proposal = proposeRule(payee, texts, inputs, renameRule);
    if (!proposal) continue;

    const cautions = collectCautions(proposal, texts, inputs, related, payee.id);
    gaps.push({
      payee,
      transactionCount,
      texts: [...texts].sort((a, b) => b.transactionCount - a.transactionCount),
      proposal,
      safe: cautions.length === 0,
      cautions,
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
  renameRule: Rule | null
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
  const alreadyCovered = textsAlreadyCovered(extendsRule);

  // Only the texts that are not already handled — the point of extending a rule
  // is to add what is missing, not to restate what it does.
  const uncovered = source.filter(
    (row) => !alreadyCovered.has(row.text.trim().toUpperCase())
  );
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
  const run = commonTokenRun(
    uncoveredTexts,
    uncovered.map((row) => row.transactionCount)
  );
  const runLength = run ? run.split(" ").length : 0;
  const variesAroundRun =
    run !== null &&
    uncoveredTexts.some(
      (text) => normalizePatternText(text).split(" ").filter(Boolean).length > runLength
    );

  if (variesAroundRun && run) {
    // Did anything ever follow the core? If not, its end is an artefact of the
    // sample rather than a fact about the merchant — three identical
    // `Google Storage Mountain View CA SAR10.99` imports make the price look
    // like part of the name.
    const runTokens = run.split(" ");
    const boundaryShown = uncoveredTexts.some((text) => {
      const tokens = normalizePatternText(text).split(" ").filter(Boolean);
      for (let i = 0; i + runTokens.length <= tokens.length; i++) {
        if (runTokens.every((word, k) => tokens[i + k] === word)) {
          return i + runTokens.length < tokens.length;
        }
      }
      return false;
    });

    const best = chooseCondition(run, field, inputs.rows, payee, !boundaryShown);
    if (!best || best.expectedMatches === 0) return null;

    return { shape: "matches", field, candidate: best.candidate, score: best, extendsRule: null };
  }

  // Nothing varies around a shared core, so an exact list is the only honest
  // shape — but only for text that has actually been seen more than once.
  // A one-off string is as dead as a varying one: listing it catches the
  // transaction already on record and nothing ever again.
  const recurring = uncovered.filter((row) => row.transactionCount > 1);
  if (recurring.length === 0) return null;

  return {
    shape: "one-of",
    field,
    texts: recurring.map((row) => row.text),
    extendsRule,
  };
}

/**
 * The longest run of words that *most* of the import text contains.
 *
 * This is what makes a rule catch text it has never seen. Requiring the texts to
 * *reduce* to the same stem was too strict — the reducer is tuned for payee
 * names and leaves different leading noise on each one — but so was requiring
 * the run in every single text. One outlier is enough to ruin it: nine imports
 * reading `LVL UP FITNESS CTR DUBAI UAE` and one reading `LVLUP FITNESS` share
 * only `FITNESS`, and a stray `EMIRATES62385176881` means the payee's other
 * fifteen `EMIRATES` imports share nothing at all.
 *
 * So the run has to cover a **majority of the transactions**, not every distinct
 * string — weighted by transaction count, because a one-off oddity should not
 * outvote text that arrives every month.
 *
 * Contiguous by design: `buildCandidates` joins the words with "any run of
 * non-alphanumerics", which only means anything if they were adjacent.
 */
export function commonTokenRun(
  texts: string[],
  weights?: number[],
  minShare = 0.5
): string | null {
  const entries = texts
    .map((text, i) => ({
      tokens: normalizePatternText(text).split(" ").filter(Boolean),
      weight: weights?.[i] ?? 1,
    }))
    .filter((entry) => entry.tokens.length > 0);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total === 0) return null;

  const containsRun = (tokens: string[], run: string[]) => {
    for (let i = 0; i + run.length <= tokens.length; i++) {
      if (run.every((word, k) => tokens[i + k] === word)) return true;
    }
    return false;
  };

  // Seeded from the text carrying the most transactions, since that is the one
  // most likely to be representative — the shortest string is as often the
  // oddity as the essence.
  const seed = [...entries].sort((a, b) => b.weight - a.weight)[0].tokens;

  for (let length = seed.length; length >= 1; length--) {
    for (let start = 0; start + length <= seed.length; start++) {
      const run = seed.slice(start, start + length);
      const matching = entries.filter((entry) => containsRun(entry.tokens, run));
      // Shared by at least two texts when there is more than one, or a single
      // dominant string defines the run all by itself — date and all.
      if (entries.length > 1 && matching.length < 2) continue;

      const covered = matching.reduce((sum, entry) => sum + entry.weight, 0);
      if (covered / total < minShare) continue;

      // A laxer floor than the trimming one below: `COLES` and `IKEA` are whole
      // merchants, and the evidence says so. `MIN_CORE_LENGTH` exists to stop
      // the ladder shortening *past* the evidence, not to overrule it.
      const joined = run.join(" ");
      return run.length >= 2 || run[0].length >= 4 ? joined : null;
    }
  }
  return null;
}

/**
 * Shorter and shorter leading parts of the run, longest first.
 *
 * The run is the longest core the history *permits*, not the shortest that
 * *works*. Three identical `Google Storage Mountain View CA SAR10.99` imports
 * make the price look like part of the merchant, and a rule carrying it breaks
 * the day the price changes.
 */
function coreLadder(run: string): string[] {
  const tokens = run.split(" ");
  // The full run is always allowed however short it is — it is what the imports
  // actually share. Only the shortened forms have to clear the floor.
  const ladder: string[] = [run];
  for (let length = tokens.length - 1; length >= 1; length--) {
    const core = tokens.slice(0, length).join(" ");
    if (core.length >= MIN_CORE_LENGTH) ladder.push(core);
  }
  return ladder;
}

/**
 * The simplest condition that catches this payee and nothing else.
 *
 * Two preferences, in order:
 *
 * 1. **The shortest safe core.** Shortening can only ever match *more*, so the
 *    shortest core the backtest still clears is the one most likely to catch a
 *    variant that has not arrived yet — which is the entire point of the rule.
 *    It also drops trailing noise, like a subscription price, without needing to
 *    know what it is.
 * 2. **`contains` over a pattern.** `contains "READY SET GO KIDS"` and
 *    `matches \bREADY[^A-Za-z0-9]*SET[^A-Za-z0-9]*GO[^A-Za-z0-9]*KIDS\b` do the
 *    same job, and only one of them can be read at a glance. The pattern is kept
 *    for what it exists for: text whose punctuation varies between imports,
 *    where a literal substring would miss.
 */
function chooseCondition(
  run: string,
  field: SourceField,
  rows: ImportedTextRow[],
  payee: PayeeCleanupCandidate,
  trimmable: boolean
): CandidateScore | null {
  const clusterIds = new Set([payee.id]);
  const clusterNames = new Set([payee.name.toUpperCase()]);
  // Only shorten when the imports never showed where the merchant ends. If
  // something follows the run in some text — `READY SET GO KIDS` then `AMUS` in
  // one import and `DUBAI` in another — the data located the boundary and
  // second-guessing it would throw away the evidence.
  const ladder = trimmable ? coreLadder(run) : coreLadder(run).slice(0, 1);
  if (ladder.length === 0) return null;

  let longestAttempt: CandidateScore | null = null;

  // Shortest first, so the first safe one wins.
  for (const core of [...ladder].reverse()) {
    const scored = buildCandidates(core, field).map((candidate) =>
      scoreCandidate(candidate, rows, clusterIds, clusterNames)
    );
    const safe = scored.filter((s) => s.unexpectedMatches === 0 && s.expectedMatches > 0);

    if (safe.length === 0) {
      // Keep the longest core's best attempt: a payee whose text cannot be
      // caught safely still deserves a proposal and an explanation rather than
      // disappearing from the list.
      if (core === ladder[0]) longestAttempt = rankCandidates(scored)[0] ?? null;
      continue;
    }

    const simplest = safe.find((s) => s.candidate.op === "contains");
    return simplest ?? rankCandidates(safe)[0] ?? null;
  }

  return longestAttempt;
}

/** Why a proposal needs a human, in the user's terms rather than the model's. */
function collectCautions(
  proposal: RuleGapProposal,
  texts: ImportedTextRow[],
  inputs: RuleGapInputs,
  related: ReturnType<typeof classifyRelatedRules>,
  payeeId: string
): string[] {
  const cautions: string[] = [];

  if (proposal.shape === "one-of") {
    const clashes = textsClaimedByOthers(
      texts.filter((t) => t.field === proposal.field),
      inputs.rows,
      payeeId
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

  if (related.some((r) => r.interaction === "potential-conflict")) {
    cautions.push("An existing rule matches this text and sets a different payee.");
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

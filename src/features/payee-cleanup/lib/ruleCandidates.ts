/**
 * Generating and scoring the rule that best catches a payee (RD-078 §15–§17).
 *
 * The decision order matters more than the pattern:
 *
 *   1. will the surviving payee's own name already resolve this? Actual matches
 *      an imported name to an existing payee by exact name, so cleanup alone
 *      often fixes future imports and no rule is needed;
 *   2. does an existing rule already resolve it?
 *   3. only then, is a new narrow rule worth adding?
 *
 * Skipping that order is how a budget ends up with a rule per merchant variant,
 * which is the mess this feature exists to clean up.
 *
 * **Verified against the rule engine** (`@actual-app/core/src/shared/rules.ts`,
 * `transaction-rules.ts`) rather than assumed, as 041a required:
 * `imported_payee` and `notes` are both `string` fields; `matches` compiles to
 * `$regexp` and `contains` to `$like`; `notes` disallows `oneOf`/`notOneOf`.
 */

import {
  COVERAGE_MARGIN,
  commonTokenRun,
  compileRuleMatcher,
  coreLadder,
  followedInSomeText,
  maximalCommonRun,
  measureTokenSpread,
  normalizePatternText,
} from "./core";
import type { Rule } from "@/types/entities";
import type { PayeeCleanupCandidate } from "../types";

/** The two fields a bank's raw merchant text can land in. */
export type SourceField = "imported_payee" | "notes";

/**
 * One row of the historical index: a distinct piece of raw text, the payee it
 * currently resolves to, and how often it occurs.
 *
 * Grouped rather than per-transaction — a budget can hold tens of thousands of
 * transactions but only hundreds of distinct import strings, and the distinct
 * strings are what a pattern is tested against.
 */
export type ImportedTextRow = {
  field: SourceField;
  text: string;
  payeeId: string | null;
  /** Carried so an unexpected match can be attributed to a payee by name. */
  payeeName?: string | null;
  transactionCount: number;
};

export type RuleCandidate = {
  field: SourceField;
  op: "contains" | "matches";
  value: string;
  /** Shown to the user as the rule they are about to create. */
  description: string;
};

export type CandidateScore = {
  candidate: RuleCandidate;
  /** Transactions already belonging to this cluster that the pattern catches. */
  expectedMatches: number;
  /** Transactions belonging to *other* payees that it would also catch. */
  unexpectedMatches: number;
  /** A sample of the unexpected ones, so the user can judge them. */
  unexpectedExamples: { text: string; payeeName: string | null }[];
  /** Distinct import strings matched, for the "will this catch new variants" question. */
  matchedTexts: number;
};

const UNEXPECTED_SAMPLE = 5;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the candidate patterns for a cluster, narrowest first.
 *
 * All three are anchored on the *reduced stem* — the merchant text with the
 * noise already removed — because that is the part that stays constant across
 * variants. A pattern built from a raw name would match one transaction.
 */
export function buildCandidates(stem: string, field: SourceField): RuleCandidate[] {
  const trimmed = stem.trim();
  if (trimmed.length < 3) return [];

  // The core has had its punctuation normalized to spaces, but the text a rule
  // runs against has not. `TEMU COM PARRAMATTA` must still match
  // `TEMU.COM PARRAMATTA`, so the gaps between words have to be flexible —
  // otherwise every merchant with a dot, slash or ampersand in its name silently
  // gets no rule at all.
  //
  // `.*` rather than a class of everything-except-letters-and-digits. It is
  // broader, which is the point: it also catches a word appearing between two
  // parts of the name. And a rule is only useful if its owner can read it —
  // `MAYA.*BORDERS` can be read at a glance, `\bMAYA[^A-Za-z0-9]*BORDERS\b`
  // cannot. Anything it over-reaches is caught by the backtest.
  const flexible = trimmed.split(" ").map(escapeRegex).join(".*");

  return [
    {
      field,
      op: "contains",
      value: trimmed,
      description: `contains "${trimmed}"`,
    },
    {
      field,
      op: "matches",
      value: `^${flexible}`,
      description: `starts with "${trimmed}"`,
    },
    {
      field,
      op: "matches",
      value: flexible,
      description: `contains "${trimmed}"`,
    },
  ];
}

/**
 * Scores one candidate against the budget's own history.
 *
 * "Expected" is a transaction that already belongs to this cluster — the rule
 * would have done the right thing. "Unexpected" is one belonging to some other
 * payee, which is the number that decides whether the rule is safe.
 */
export function scoreCandidate(
  candidate: RuleCandidate,
  rows: ImportedTextRow[],
  clusterPayeeIds: Set<string>,
  clusterPayeeNames: Set<string> = new Set()
): CandidateScore {
  let expectedMatches = 0;
  let unexpectedMatches = 0;
  let matchedTexts = 0;
  const unexpectedExamples: CandidateScore["unexpectedExamples"] = [];
  // Compiled once rather than per row: the pattern is tested against every
  // row in the history, and building it inside that loop meant thousands of
  // identical compilations per candidate.
  const matches = compileRuleMatcher(candidate.op, candidate.value);

  for (const row of rows) {
    if (row.field !== candidate.field) continue;
    if (!matches(row.text)) continue;

    matchedTexts += 1;

    // Attribution accepts the id *or* the name. The two are checked because a
    // grouped query can return either depending on how the field serializes,
    // and mis-attributing a payee's own transactions as belonging to someone
    // else makes a perfectly safe rule look dangerous.
    const belongsToCluster =
      (row.payeeId !== null && clusterPayeeIds.has(row.payeeId)) ||
      (row.payeeName != null && clusterPayeeNames.has(row.payeeName.toUpperCase()));

    if (belongsToCluster) {
      expectedMatches += row.transactionCount;
      continue;
    }

    // A row with no payee belongs to nobody. Counting it against the rule would
    // report a conflict with a payee that does not exist.
    if (row.payeeId === null && !row.payeeName) continue;

    unexpectedMatches += row.transactionCount;
    if (unexpectedExamples.length < UNEXPECTED_SAMPLE) {
      unexpectedExamples.push({ text: row.text, payeeName: row.payeeName ?? null });
    }
  }

  return {
    candidate,
    expectedMatches,
    unexpectedMatches,
    unexpectedExamples,
    matchedTexts,
  };
}

/**
 * Picks the pattern that best catches this payee.
 *
 * Ordering, in priority:
 *
 * 1. **no unexpected matches** — a rule that steals another payee's
 *    transactions is worse than no rule at all, whatever else it does well;
 * 2. **most expected matches** — among safe patterns, the one that catches the
 *    most of this merchant's history will catch the most of its future;
 * 3. **narrowest** — `matches ^stem\b` before a bare `contains`, so the rule
 *    stays specific as the budget grows.
 */
export function rankCandidates(scores: CandidateScore[]): CandidateScore[] {
  const narrowness = (c: RuleCandidate) =>
    c.op === "matches" && c.value.startsWith("^") ? 0 : c.op === "matches" ? 1 : 2;

  return [...scores].sort((a, b) => {
    const aSafe = a.unexpectedMatches === 0 ? 0 : 1;
    const bSafe = b.unexpectedMatches === 0 ? 0 : 1;
    if (aSafe !== bSafe) return aSafe - bSafe;
    if (b.expectedMatches !== a.expectedMatches) {
      return b.expectedMatches - a.expectedMatches;
    }
    return narrowness(a.candidate) - narrowness(b.candidate);
  });
}

/**
 * How many historical import strings the surviving payee's own name already
 * resolves (RD-078 §1.3).
 *
 * Actual matches an imported name to an existing payee by exact name, so these
 * need no rule at all — and proposing one for them is the rule sprawl this
 * decision order exists to avoid.
 */
export function exactNameCoverage(
  finalName: string,
  rows: ImportedTextRow[]
): { covered: number; transactionCount: number } {
  const target = finalName.trim().toUpperCase();
  if (!target) return { covered: 0, transactionCount: 0 };

  let covered = 0;
  let transactionCount = 0;
  for (const row of rows) {
    if (row.field !== "imported_payee") continue;
    if (row.text.trim().toUpperCase() !== target) continue;
    covered += 1;
    transactionCount += row.transactionCount;
  }
  return { covered, transactionCount };
}

export type RelatedRule = {
  rule: Rule;
  /** What the rule does, not merely that it mentions the payee. */
  kind: "payee-resolution" | "category-or-other-action" | "references-payee";
  interaction: "compatible" | "already-resolves" | "potential-conflict";
};

/**
 * Classifies the rules already touching this cluster (RD-078 §18).
 *
 * The distinction that matters: a rule that *sets* the payee already does this
 * job — proposing another is duplication — whereas a rule that merely
 * references the payee to set a category is unaffected and compatible.
 */
export function classifyRelatedRules(
  rules: Rule[],
  clusterPayeeIds: Set<string>,
  stem: string
): RelatedRule[] {
  const stemUpper = stem.trim().toUpperCase();
  const related: RelatedRule[] = [];

  for (const rule of rules) {
    const setsPayee = rule.actions.some((a) => a.field === "payee");
    // ...and specifically to a payee in this cluster. A rule whose text matches
    // this merchant but which assigns *someone else* does not resolve it;
    // treating it as though it did set `existing-rule-covers-it` and dropped the
    // rule the cleanup actually needed.
    const setsClusterPayee = rule.actions.some((a) => {
      if (a.field !== "payee") return false;
      const values = Array.isArray(a.value) ? a.value : [a.value];
      return values.some((v) => typeof v === "string" && clusterPayeeIds.has(v));
    });
    const referencesCluster = [...rule.conditions, ...rule.actions].some((part) => {
      if (part.field !== "payee" && part.field !== "imported_payee") return false;
      const values = Array.isArray(part.value) ? part.value : [part.value];
      return values.some((v) => typeof v === "string" && clusterPayeeIds.has(v));
    });

    // A condition whose text overlaps this merchant would compete with the
    // proposed rule even when it names no payee in the cluster.
    const matchesStem = rule.conditions.some((c) => {
      if (c.field !== "imported_payee" && c.field !== "notes") return false;
      if (stemUpper.length === 0) return false;
      // Arrays too: an `imported_payee oneOf [...]` rule already resolves this
      // merchant. Reading only string values classified it as a conflict and
      // proposed a second rule for something already handled — the rule sprawl
      // this decision order exists to prevent. `referencesCluster` above
      // already normalizes arrays; these two agreed on nothing else.
      const values = Array.isArray(c.value) ? c.value : [c.value];
      return values.some((value) => {
        if (typeof value !== "string") return false;
        const upper = value.toUpperCase().trim();
        if (upper.includes(stemUpper)) return true;
        // The reverse direction needs a floor. A two-character condition value
        // like `CO` is a substring of a great many stems, and treating that as
        // an overlap let an unrelated rule be read as covering this merchant —
        // which then suppressed the rule cleanup needed. Three characters, the
        // same floor `buildCandidates` uses.
        return upper.length >= 3 && stemUpper.includes(upper);
      });
    });

    if (!referencesCluster && !matchesStem) continue;

    if (setsClusterPayee && matchesStem) {
      related.push({
        rule,
        kind: "payee-resolution",
        interaction: "already-resolves",
      });
    } else if (setsPayee) {
      related.push({ rule, kind: "payee-resolution", interaction: "potential-conflict" });
    } else if (referencesCluster) {
      related.push({ rule, kind: "category-or-other-action", interaction: "compatible" });
    } else {
      related.push({ rule, kind: "references-payee", interaction: "potential-conflict" });
    }
  }

  return related;
}

export type FutureResolution = {
  /** Import strings the surviving name already handles, needing no rule. */
  exactName: { covered: number; transactionCount: number };
  relatedRules: RelatedRule[];
  /** Ranked best-first; empty when no pattern could be built. */
  candidates: CandidateScore[];
  /** The one offered, or null when a rule should not be proposed at all. */
  recommended: CandidateScore | null;
  /** Why no rule is recommended, when that is the case. */
  skipReason:
    | "already-resolved-by-name"
    | "existing-rule-covers-it"
    | "no-safe-pattern"
    | "no-matching-pattern"
    | null;
  /**
   * False when the best candidate still catches other payees' transactions.
   * The UI must not pre-select such a rule (RD-078 §17).
   */
  safeToPreselect: boolean;
  /** The text the recommended pattern was built from, for the editor. */
  matchText: string;
  /** True when the backtest ran over a truncated read of the history. */
  historyTruncated: boolean;
};

export function analyzeFutureResolution(input: {
  stem: string;
  finalName: string;
  members: PayeeCleanupCandidate[];
  rows: ImportedTextRow[];
  rules: Rule[];
  /** A pattern the user typed, which replaces the generated ones. */
  override?: { field: SourceField; text: string };
  /** Set when the history read hit its row cap. */
  historyTruncated?: boolean;
}): FutureResolution {
  const clusterPayeeIds = new Set(input.members.map((m) => m.id));
  const clusterPayeeNames = new Set(input.members.map((m) => m.name.toUpperCase()));
  const exactName = exactNameCoverage(input.finalName, input.rows);
  const relatedRules = classifyRelatedRules(input.rules, clusterPayeeIds, input.stem);

  // The same derivation the "Needs a rule" tab uses, on the same evidence: the
  // cluster's own imports. Deriving it from the reduced stem and the final name
  // instead meant one budget produced two differently shaped rules depending on
  // which half of cleanup proposed them — and only one of the two knew that a
  // date is not a merchant, or that a word used by two hundred payees names
  // none of them.
  const ownRows = input.rows.filter(
    (row) =>
      (row.payeeId !== null && clusterPayeeIds.has(row.payeeId)) ||
      (row.payeeName != null && clusterPayeeNames.has(row.payeeName.toUpperCase()))
  );
  const spread = measureTokenSpread(input.rows);

  // The words each candidate was built from, so the editor can be seeded with
  // something the user can edit. Seeding it with the pattern itself looked
  // helpful and was not: the override path normalizes what it is given, so
  // changing one character of `^FILMBOX.*COM` turned it into `FILMBOX COM` and
  // silently dropped the anchor and the gaps.
  const coreFor = new Map<CandidateScore, string>();

  const scored = input.override
    ? buildCandidates(
        normalizePatternText(input.override.text),
        input.override.field
      ).map((candidate) =>
        scoreCandidate(candidate, input.rows, clusterPayeeIds, clusterPayeeNames)
      )
    : (["imported_payee", "notes"] as SourceField[]).flatMap((field) => {
        const texts = ownRows.filter((row) => row.field === field);
        if (texts.length === 0) return [];

        const weights = texts.map((row) => row.transactionCount);
        const run = commonTokenRun(
          texts.map((row) => row.text),
          weights,
          0.5,
          spread
        );
        if (!run) return [];

        const longest = maximalCommonRun(
          texts.map((row) => row.text),
          weights
        );
        const boundaryShown =
          longest !== null &&
          followedInSomeText(
            longest,
            texts.map((row) => row.text)
          );

        const chosen = chooseCondition(
          run,
          field,
          input.rows,
          clusterPayeeIds,
          clusterPayeeNames,
          !boundaryShown
        );
        if (!chosen) return [];
        coreFor.set(chosen, run);
        return [chosen];
      });

  // A pattern that catches nothing is not a candidate.
  const matching = scored.filter((s) => s.expectedMatches > 0);
  const candidates = rankCandidates(matching);
  const best = candidates[0] ?? null;

  // Decision order (§15), in order.
  //
  // The question for step 2 is not "does exact-name matching cover a lot?" but
  // "does the rule catch anything exact-name matching would miss?" — the
  // *residual*. A merchant whose every past import already equals the surviving
  // name needs no rule; one that also arrives as `GROCERGO 0183` does, however
  // much of its history matched by name.
  //
  // Only an `imported_payee` candidate can be netted off this way:
  // `exactNameCoverage` counts `imported_payee` rows, and subtracting those from
  // a `notes` candidate's matches drove the residual to zero and declared the
  // merchant "already resolved by name" for text name matching never sees.
  const residual =
    best && best.candidate.field === "imported_payee"
      ? best.expectedMatches - exactName.transactionCount
      : (best?.expectedMatches ?? 0);

  let skipReason: FutureResolution["skipReason"] = null;
  if (relatedRules.some((r) => r.interaction === "already-resolves")) {
    skipReason = "existing-rule-covers-it";
  } else if (!best) {
    // Two different failures, and telling a user "no pattern catches this
    // without catching others" when in truth nothing matched at all sends them
    // hunting for a conflict that does not exist.
    skipReason = scored.some((s) => s.unexpectedMatches > 0)
      ? "no-safe-pattern"
      : "no-matching-pattern";
  } else if (exactName.covered > 0 && residual <= 0) {
    skipReason = "already-resolved-by-name";
  }

  return {
    exactName,
    relatedRules,
    candidates,
    recommended: skipReason ? null : best,
    skipReason,
    // Never pre-select a rule whose safety rests on a partial read.
    safeToPreselect:
      Boolean(best) &&
      best!.unexpectedMatches === 0 &&
      !skipReason &&
      !input.historyTruncated,
    // What the editor starts from: the text of whatever was actually chosen,
    // so editing begins from what the user can see rather than from a stem they
    // were never shown.
    // The core, not the pattern built from it. Both read the same when the
    // condition is a plain substring, and only one of them survives being
    // edited.
    matchText:
      input.override?.text ?? (best ? (coreFor.get(best) ?? best.candidate.value) : ""),
    historyTruncated: input.historyTruncated === true,
  };
}

/**
 * The simplest condition that catches these payees and nothing else.
 *
 * Two preferences, in order:
 *
 * 1. **The shortest safe core.** Shortening can only ever match *more*, so the
 *    shortest core the backtest still clears is the one most likely to catch a
 *    variant that has not arrived yet — which is the entire point of the rule.
 *    It also drops trailing noise, like a subscription price, without needing to
 *    know what it is.
 * 2. **`contains` over a pattern.** `contains "SPRINT SET GO KIDS"` and
 *    `matches \bREADY[^A-Za-z0-9]*SET[^A-Za-z0-9]*GO[^A-Za-z0-9]*KIDS\b` do the
 *    same job, and only one of them can be read at a glance. The pattern is kept
 *    for what it exists for: text whose punctuation varies between imports,
 *    where a literal substring would miss.
 */
export function chooseCondition(
  run: string,
  field: SourceField,
  rows: ImportedTextRow[],
  clusterIds: Set<string>,
  clusterNames: Set<string>,
  trimmable: boolean
): CandidateScore | null {
  // Only shorten when the imports never showed where the merchant ends. If
  // something follows the run in some text — `SPRINT SET GO KIDS` then `AMUS` in
  // one import and `ASHDOWN` in another — the data located the boundary and
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

    // Simplest, but not at any price. A literal substring only reads the same as
    // the pattern when it catches roughly the same imports, and it need not: a
    // merchant written `TEMU.COM` in most of its imports and `TEMU COM` in one
    // gives a `contains` catching the one and a pattern catching all of them.
    //
    // Roughly, not exactly — the same margin the core ranking uses. One import
    // written without its space should not cost the user a readable rule, while
    // a substring catching a fraction of them should.
    const best = Math.max(...safe.map((s) => s.expectedMatches));
    const simplest = safe.find(
      (s) =>
        s.candidate.op === "contains" &&
        s.expectedMatches >= best * (1 - COVERAGE_MARGIN)
    );
    return simplest ?? rankCandidates(safe)[0] ?? null;
  }

  return longestAttempt;
}

/**
 * The staged rule for the recommended candidate, targeting the surviving payee.
 *
 * **`pre` stage, matching Actual's own payee-rename rules.** Actual normalizes
 * the payee in `pre` (`updatePayeeRenameRule` in
 * `@actual-app/core/src/server/transactions/transaction-rules.ts`) precisely so
 * that `default`-stage rules matching *on* payee see the corrected value. A
 * payee-setting rule in `default` runs in the same stage as those rules, which
 * makes the outcome depend on rule order rather than on stage.
 */
export function buildNormalizationRule(
  candidate: RuleCandidate,
  targetPayeeId: string,
  id: string
): Rule {
  return {
    id,
    stage: "pre",
    conditionsOp: "and",
    conditions: [
      { field: candidate.field, op: candidate.op, value: candidate.value, type: "string" },
    ],
    actions: [{ field: "payee", op: "set", value: targetPayeeId, type: "id" }],
  };
}

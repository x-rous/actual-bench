/**
 * What a proposed rewrite would newly catch (RD-088 §2).
 *
 * Replacing a list of exact strings with `contains "<merchant>"` only ever
 * *widens* a rule, so the proposal cannot be judged from the rule alone. It has
 * to be run against the budget's own import history — the same corpus Payee
 * Cleanup backtests against, read through the same cached query — and the number
 * that decides it is how many transactions belonging to *someone else* the wider
 * condition would sweep up.
 *
 * Payee Cleanup's `scoreCandidate` answers a neighbouring question: given a
 * cluster of payees being merged, what does this pattern catch that is not
 * theirs? Here there is no cluster — the subject is a rule, which may set a
 * category and name no payee at all, and under that scorer every match would
 * count against it and nothing would ever be offered. So the matcher is shared
 * (`compileRuleMatcher`, which reproduces Actual's own comparison rather than a
 * plausible imitation of it) and the accounting is the rule's:
 *
 *   * what the rule matches **today** stays out of the comparison — the rewrite
 *     is not responsible for it;
 *   * what it would newly catch is split by where that text currently lands:
 *     the payee this rule already sets (agreeing — the rule was trying to catch
 *     it), nobody (unassigned), or a different payee (conflicting).
 *
 * Only the third number gates the proposal. It is the one that means "this rule
 * would start relabelling somebody else's transactions".
 */

import { compileRuleMatcher } from "@/features/payee-cleanup/lib/core";
import type {
  ImportedTextRow,
  RuleCandidate,
  SourceField,
} from "@/features/payee-cleanup/lib/ruleCandidates";

/** How many conflicting strings are quoted back to the user. */
const CONFLICT_SAMPLE = 5;

export type GeneralisationImpact = {
  stem: string;
  candidate: RuleCandidate;
  /** Distinct import strings the rule's current conditions already match. */
  coveredToday: number;
  /** Newly caught strings whose transactions already carry a payee this rule sets. */
  newAgreeing: number;
  /** Newly caught strings carrying no payee at all. */
  newUnassigned: number;
  /** Newly caught strings belonging to another payee — the number that decides it. */
  newConflicting: number;
  conflictingTransactions: number;
  conflictingExamples: { text: string; payeeName: string | null }[];
  /** True when nothing belonging to another payee is caught. */
  clean: boolean;
};

export type BacktestInput = {
  field: SourceField;
  /** The literal values the rule matches today. */
  currentValues: string[];
  /** Payees this rule sets, by id and by upper-cased name. */
  targetPayeeIds: Set<string>;
  targetPayeeNames: Set<string>;
  rows: ImportedTextRow[];
};

export function assessGeneralisation(
  entry: { stem: string; candidate: RuleCandidate },
  input: BacktestInput
): GeneralisationImpact {
  const matches = compileRuleMatcher(entry.candidate.op, entry.candidate.value);
  // Case only. Actual compares `is` with `===` on the lower-cased text and does
  // not trim, so two values differing by a trailing space are two values.
  const current = new Set(input.currentValues.map((value) => value.toUpperCase()));

  let coveredToday = 0;
  let newAgreeing = 0;
  let newUnassigned = 0;
  let newConflicting = 0;
  let conflictingTransactions = 0;
  const conflictingExamples: GeneralisationImpact["conflictingExamples"] = [];

  for (const row of input.rows) {
    if (row.field !== input.field) continue;
    if (!matches(row.text)) continue;

    if (current.has(row.text.toUpperCase())) {
      coveredToday += 1;
      continue;
    }

    const name = row.payeeName?.trim().toUpperCase() ?? "";
    const belongsToTarget =
      (row.payeeId !== null && input.targetPayeeIds.has(row.payeeId)) ||
      (name !== "" && input.targetPayeeNames.has(name));

    if (belongsToTarget) {
      newAgreeing += 1;
      continue;
    }

    // Text nobody has claimed cannot be taken from anybody.
    if (row.payeeId === null && name === "") {
      newUnassigned += 1;
      continue;
    }

    newConflicting += 1;
    conflictingTransactions += row.transactionCount;
    if (conflictingExamples.length < CONFLICT_SAMPLE) {
      conflictingExamples.push({ text: row.text, payeeName: row.payeeName ?? null });
    }
  }

  return {
    ...entry,
    coveredToday,
    newAgreeing,
    newUnassigned,
    newConflicting,
    conflictingTransactions,
    conflictingExamples,
    clean: newConflicting === 0,
  };
}

/**
 * Every proposal, assessed and ordered: safe first, then the one that catches
 * the most of this merchant's other text, then the most readable.
 *
 * Readability rather than narrowness, which is where this parts company with
 * Payee Cleanup's ranking. `contains "MARKET BOYS PTY LTD"` and
 * `matches ^MARKET.*BOYS.*PTY.*LTD` catch the same three strings, but only the
 * first can be read by the person who has to maintain it — and the anchor in the
 * second is a liability here: a bank that starts prefixing its text with
 * `CARD PURCHASE` breaks an anchored rule and not a `contains` one. The regex
 * forms stay in the list, and win when the plain one is not clean.
 *
 * Unsafe ones are kept rather than dropped. A user who can see *what* a rewrite
 * would also catch can tell whether it matters; one shown nothing is left with a
 * rule that does not work and no explanation.
 */
export function assessGeneralisations(
  entries: { stem: string; candidate: RuleCandidate }[],
  input: BacktestInput
): GeneralisationImpact[] {
  const readability = (candidate: RuleCandidate) =>
    candidate.op === "contains" ? 0 : candidate.value.startsWith("^") ? 1 : 2;

  return entries
    .map((entry) => assessGeneralisation(entry, input))
    .sort(
      (a, b) =>
        Number(b.clean) - Number(a.clean) ||
        b.newAgreeing - a.newAgreeing ||
        a.newConflicting - b.newConflicting ||
        readability(a.candidate) - readability(b.candidate)
    );
}

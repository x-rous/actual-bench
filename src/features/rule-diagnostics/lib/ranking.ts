/**
 * Ordering findings by what acting on them is worth (F-110 / PR-049).
 *
 * Severity says what *kind* of problem this is; it says nothing about this
 * instance of it. Under severity, findings arrived in check-registration order,
 * which is arbitrary — a broad match on a rule nothing depends on sat above a
 * family of six.
 *
 * Every signal here is read from the rule set already in memory. Deliberately
 * **not** transaction counts: a rule's fire count is not a property of the rule.
 * Actual applies rules on transaction create, in stage order, with each rule
 * seeing what earlier ones wrote — reproducing that is a rule engine, which this
 * project does not have. A number we guessed would be a number users trusted, on
 * a page whose whole value is being right about rules.
 *
 * So this ranks like a linter: not how often the code runs, but how many places
 * are wrong and how much one fix buys.
 */

import type { Rule } from "@/types/entities";
import type { Finding, Severity } from "../types";

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * `pre` runs before everything else and its writes are what later stages see,
 * so a broken `pre` rule is a broken import pipeline rather than one bad
 * categorisation.
 */
const STAGE_RANK: Record<string, number> = { pre: 0, default: 1, post: 2 };

export type RankingContext = {
  rulesById: Map<string, Rule>;
  /** How many findings name each rule — built once per report. */
  findingsPerRule: Map<string, number>;
};

export function buildRankingContext(findings: Finding[], rules: Rule[]): RankingContext {
  const findingsPerRule = new Map<string, number>();
  for (const finding of findings) {
    for (const ref of finding.affected) {
      findingsPerRule.set(ref.id, (findingsPerRule.get(ref.id) ?? 0) + 1);
    }
    if (finding.counterpart) {
      const id = finding.counterpart.id;
      findingsPerRule.set(id, (findingsPerRule.get(id) ?? 0) + 1);
    }
  }
  return { rulesById: new Map(rules.map((r) => [r.id, r])), findingsPerRule };
}

/**
 * How much of the transaction stream a rule *claims*, from its conditions
 * alone. An `oneOf` over forty payees asserts more reach than an `is` over one.
 *
 * This is a claim, not a measurement, and it is honest about that: it says what
 * the rule was written to cover, never what it caught.
 */
function conditionBreadth(rule: Rule | undefined): number {
  if (!rule) return 0;
  let breadth = 0;
  for (const condition of rule.conditions) {
    breadth += Array.isArray(condition.value) ? condition.value.length : 1;
  }
  return breadth;
}

/** The rules a finding is about, counterpart included. */
function participantIds(finding: Finding): string[] {
  const ids = finding.affected.map((r) => r.id);
  if (finding.counterpart) ids.push(finding.counterpart.id);
  return ids;
}

export type FindingWeight = {
  severity: number;
  /** Rules this finding would consolidate — what one fix buys. */
  consolidates: number;
  /** The most findings any one participant carries. */
  findingsOnRule: number;
  stage: number;
  breadth: number;
};

export function findingWeight(finding: Finding, ctx: RankingContext): FindingWeight {
  const ids = participantIds(finding);
  const rules = ids.map((id) => ctx.rulesById.get(id));

  let findingsOnRule = 0;
  for (const id of ids) {
    findingsOnRule = Math.max(findingsOnRule, ctx.findingsPerRule.get(id) ?? 0);
  }

  let stage = STAGE_RANK.post;
  for (const rule of rules) {
    if (!rule) continue;
    stage = Math.min(stage, STAGE_RANK[rule.stage] ?? STAGE_RANK.post);
  }

  let breadth = 0;
  for (const rule of rules) breadth = Math.max(breadth, conditionBreadth(rule));

  return {
    severity: SEVERITY_RANK[finding.severity],
    consolidates: ids.length,
    findingsOnRule,
    stage,
    breadth,
  };
}

/**
 * Severity first, then payoff, then reach. The final tiebreak is the code and
 * the first rule id, so two findings that are equal by every measure still come
 * out in the same order on every run — the report has to be byte-identical for
 * staleness detection to mean anything.
 */
export function compareByWeight(a: Finding, b: Finding, ctx: RankingContext): number {
  const wa = findingWeight(a, ctx);
  const wb = findingWeight(b, ctx);

  if (wa.severity !== wb.severity) return wa.severity - wb.severity;
  if (wa.consolidates !== wb.consolidates) return wb.consolidates - wa.consolidates;
  if (wa.findingsOnRule !== wb.findingsOnRule) return wb.findingsOnRule - wa.findingsOnRule;
  if (wa.stage !== wb.stage) return wa.stage - wb.stage;
  if (wa.breadth !== wb.breadth) return wb.breadth - wa.breadth;

  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  const aId = a.affected[0]?.id ?? "";
  const bId = b.affected[0]?.id ?? "";
  if (aId === bId) return 0;
  return aId < bId ? -1 : 1;
}

export function rankFindings(findings: Finding[], rules: Rule[]): Finding[] {
  const ctx = buildRankingContext(findings, rules);
  return [...findings].sort((a, b) => compareByWeight(a, b, ctx));
}

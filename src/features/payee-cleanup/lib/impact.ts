/**
 * What a cleanup proposal would actually touch (RD-078 §10).
 *
 * Merging payees changes which rules match and which transactions display under
 * which name. A proposal is only safe to accept if its blast radius is visible
 * first, expressed in Actual's real concepts rather than an invented
 * "metadata conflict" bucket.
 *
 * Three findings from the native-semantics verification shape this module:
 *
 * - **Schedules are rules.** Actual links a schedule to a payee *through* its
 *   rule, and `getPayeeRuleCounts` deliberately skips rules belonging to
 *   completed schedules. Reporting "3 rules · 1 schedule" would count the same
 *   relationship twice, so the three kinds are separated instead.
 * - **Merge does not rewrite rules.** `db.mergePayees` never touches the rules
 *   table; conditions keep the old payee id and resolve through
 *   `payee_mapping`. The UI must say what actually happens.
 * - **`favorite` and `learn_categories` cannot be written** through any
 *   supported API, so they are reported as read-only differences. Choosing the
 *   target *is* how the user resolves them.
 */

import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import type { Rule, Schedule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import type { PayeeCluster } from "./clusterResolver";
import type { PayeeCleanupCandidate } from "../types";

/** Payee-referencing condition/action fields, matching the Usage Inspector. */
const PAYEE_FIELDS = ["payee", "imported_payee"];

export type RuleImpact = {
  /** Rules that are not attached to a schedule. */
  regular: number;
  /** Rules belonging to a schedule that is still running. */
  activeSchedule: number;
  /**
   * Rules belonging to a completed schedule. Reported separately and excluded
   * from the active count — the same choice Actual makes internally.
   */
  completedSchedule: number;
};

export type BehaviorImpact = {
  favoriteDiffers: boolean;
  learnCategoriesDiffers: boolean;
  /** The values that will survive: the target's own, because merge does not combine them. */
  survivingFavorite: boolean;
  survivingLearnCategories: boolean;
};

export type MemberImpact = {
  payeeId: string;
  name: string;
  transactionCount: number | undefined;
  ruleCount: number;
};

export type ClusterImpact = {
  /** Undefined until the counts have loaded — never conflated with zero. */
  transactionTotal: number | undefined;
  transactionsLoading: boolean;
  rules: RuleImpact;
  behavior: BehaviorImpact;
  members: MemberImpact[];
};

export type ImpactSources = {
  stagedRules: StagedMap<Rule>;
  schedules: Schedule[];
  /** Undefined while loading; an empty map means "loaded, none found". */
  transactionCounts: Map<string, number> | undefined;
  transactionsLoading: boolean;
};

/**
 * Splits rule references into regular / active-schedule / completed-schedule.
 *
 * A rule is schedule-linked when a schedule names it in `ruleId`; the schedule's
 * `completed` flag then decides which bucket it lands in.
 */
export function classifyRuleReferences(
  payeeIds: string[],
  stagedRules: StagedMap<Rule>,
  schedules: Schedule[]
): RuleImpact {
  const scheduleByRuleId = new Map<string, Schedule>();
  for (const schedule of schedules) {
    if (schedule.ruleId) scheduleByRuleId.set(schedule.ruleId, schedule);
  }

  const ids = new Set(payeeIds);
  const impact: RuleImpact = { regular: 0, activeSchedule: 0, completedSchedule: 0 };

  for (const staged of Object.values(stagedRules)) {
    if (staged.isDeleted) continue;
    const rule = staged.entity;

    const referencesCluster = [...rule.conditions, ...rule.actions].some((part) => {
      if (!part.field || !PAYEE_FIELDS.includes(part.field)) return false;
      const values = Array.isArray(part.value) ? part.value : [part.value];
      return values.some((v) => typeof v === "string" && ids.has(v));
    });
    if (!referencesCluster) continue;

    const schedule = scheduleByRuleId.get(rule.id);
    if (!schedule) impact.regular += 1;
    else if (schedule.completed) impact.completedSchedule += 1;
    else impact.activeSchedule += 1;
  }

  return impact;
}

/**
 * Favorite / category-learning differences across the cluster.
 *
 * Reports what *survives* rather than what the user might want, because Bench
 * cannot write either field: the target keeps its own values and the sources are
 * tombstoned.
 */
export function compareBehavior(
  members: PayeeCleanupCandidate[],
  targetId: string
): BehaviorImpact {
  const target = members.find((m) => m.id === targetId) ?? members[0];

  return {
    favoriteDiffers: new Set(members.map((m) => m.metadata.favorite)).size > 1,
    learnCategoriesDiffers:
      new Set(members.map((m) => m.metadata.learnCategories)).size > 1,
    survivingFavorite: target.metadata.favorite,
    survivingLearnCategories: target.metadata.learnCategories,
  };
}

export function buildClusterImpact(
  cluster: PayeeCluster,
  targetId: string,
  sources: ImpactSources
): ClusterImpact {
  const memberIds = cluster.members.map((m) => m.id);
  const ruleCounts = buildRuleReferenceMap(sources.stagedRules, PAYEE_FIELDS);

  const members: MemberImpact[] = cluster.members.map((member) => ({
    payeeId: member.id,
    name: member.name,
    // A loaded map with no row for this payee means zero, not unknown. Reading
    // it as unknown rendered "counting…" forever next to every payee that has
    // no transactions — which is exactly the payee a user is deciding about.
    transactionCount: sources.transactionCounts
      ? (sources.transactionCounts.get(member.id) ?? 0)
      : undefined,
    ruleCount: ruleCounts.get(member.id) ?? 0,
  }));

  const transactionTotal = sources.transactionCounts
    ? memberIds.reduce((sum, id) => sum + (sources.transactionCounts?.get(id) ?? 0), 0)
    : undefined;

  return {
    transactionTotal,
    transactionsLoading: sources.transactionsLoading,
    rules: classifyRuleReferences(memberIds, sources.stagedRules, sources.schedules),
    behavior: compareBehavior(cluster.members, targetId),
    members,
  };
}

/**
 * Signals the confidence model and target scorer consume, derived from impact.
 *
 * Keeping this a separate step means 041b's pure pipeline stays usable without
 * any of the data this module needs.
 */
export function impactSignals(impact: ClusterImpact): {
  behaviorConflict: boolean;
  ruleConflict: boolean;
} {
  return {
    behaviorConflict:
      impact.behavior.favoriteDiffers || impact.behavior.learnCategoriesDiffers,
    // More than one member carrying rules means the merge changes which rules
    // point where, and the user should look before accepting.
    ruleConflict: impact.members.filter((m) => m.ruleCount > 0).length > 1,
  };
}

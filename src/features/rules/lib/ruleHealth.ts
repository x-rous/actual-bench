import type { ConditionOrAction, Rule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import type { EntityMaps } from "../utils/rulePreview";
import { ACTION_FIELDS, CONDITION_FIELDS, conditionValueKind } from "../utils/ruleFields";

/**
 * Problems a rule can have that Actual never reports: it keeps a rule whose
 * payee, category or account was deleted, runs two identical rules twice, and
 * never fires a rule without conditions. Read-only checks against the staged
 * data; nothing here changes a rule.
 */
export type RuleIssue = "missing-reference" | "duplicate" | "no-conditions";

export const RULE_ISSUE_LABELS: Record<RuleIssue, string> = {
  "missing-reference": "Refers to a deleted payee, category or account",
  duplicate: "Same as another rule",
  "no-conditions": "No conditions, so it never matches",
};

type EntityKind = "payee" | "category" | "account" | "categoryGroup";

function mapFor(kind: EntityKind, maps: EntityMaps): StagedMap<{ id: string }> {
  if (kind === "payee") return maps.payees;
  if (kind === "category") return maps.categories;
  if (kind === "account") return maps.accounts;
  return maps.categoryGroups;
}

/** The entity ids a condition or action names, with their kind. Text operators on id fields compare raw strings, not ids. */
function referencedIds(part: ConditionOrAction, isAction: boolean): { kind: EntityKind; ids: string[] } | null {
  const field = part.field;
  if (!field) return null;
  const def = isAction ? ACTION_FIELDS[field] : CONDITION_FIELDS[field];
  const kind = def?.entity;
  if (!kind) return null;
  if (!isAction) {
    const valueKind = conditionValueKind(field, part.op);
    if (valueKind !== "entity" && valueKind !== "multi-entity") return null;
  }
  const values = Array.isArray(part.value) ? part.value : [part.value];
  const ids = values.filter((v): v is string => typeof v === "string" && v !== "");
  return ids.length ? { kind, ids } : null;
}

const KIND_NAMES: Record<EntityKind, string> = {
  payee: "payee",
  category: "category",
  account: "account",
  categoryGroup: "category group",
};

/** The kinds of entity a rule names that the budget no longer has, in a fixed order. */
export function missingReferenceKinds(rule: Rule, maps: EntityMaps): EntityKind[] {
  const found = new Set<EntityKind>();
  const parts: [ConditionOrAction, boolean][] = [
    ...rule.conditions.map((c): [ConditionOrAction, boolean] => [c, false]),
    ...rule.actions.map((a): [ConditionOrAction, boolean] => [a, true]),
  ];
  for (const [part, isAction] of parts) {
    const ref = referencedIds(part, isAction);
    if (!ref) continue;
    const map = mapFor(ref.kind, maps);
    if (ref.ids.some((id) => !map[id] || map[id].isDeleted)) found.add(ref.kind);
  }
  return (["payee", "category", "categoryGroup", "account"] as const).filter((k) => found.has(k));
}

/** "Refers to a deleted account", "Refers to a deleted payee and category". */
export function missingReferenceLabel(rule: Rule, maps: EntityMaps): string {
  const names = missingReferenceKinds(rule, maps).map((k) => KIND_NAMES[k]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "item";
  return `Refers to a deleted ${list}. Open the rule to remove or replace it.`;
}

export function hasMissingReference(rule: Rule, maps: EntityMaps): boolean {
  const parts: [ConditionOrAction, boolean][] = [
    ...rule.conditions.map((c): [ConditionOrAction, boolean] => [c, false]),
    ...rule.actions.map((a): [ConditionOrAction, boolean] => [a, true]),
  ];
  for (const [part, isAction] of parts) {
    const ref = referencedIds(part, isAction);
    if (!ref) continue;
    const map = mapFor(ref.kind, maps);
    if (ref.ids.some((id) => !map[id] || map[id].isDeleted)) return true;
  }
  return false;
}

/**
 * A stable key for a rule's behavior: stage, operator, conditions in any order,
 * and actions in their order. Actual runs actions in sequence, so the same
 * actions in another order can give another result (set notes, then append).
 */
function ruleKey(rule: Rule): string {
  const part = (p: ConditionOrAction) => JSON.stringify([p.field, p.op, p.value, p.options ?? null]);
  return JSON.stringify([
    rule.stage || "default",
    rule.conditionsOp,
    rule.conditions.map(part).sort(),
    rule.actions.map(part),
  ]);
}

/** Issues per rule id, for live (not deleted) rules. Rules without issues are absent. */
export function findRuleIssues(rules: StagedMap<Rule>, maps: EntityMaps): Map<string, RuleIssue[]> {
  const live = Object.values(rules).filter((s) => !s.isDeleted).map((s) => s.entity);
  const byKey = new Map<string, string[]>();
  for (const rule of live) {
    if (rule.conditions.length === 0) continue;
    const key = ruleKey(rule);
    byKey.set(key, [...(byKey.get(key) ?? []), rule.id]);
  }
  const duplicates = new Set([...byKey.values()].filter((ids) => ids.length > 1).flat());

  const issues = new Map<string, RuleIssue[]>();
  for (const rule of live) {
    const list: RuleIssue[] = [];
    if (hasMissingReference(rule, maps)) list.push("missing-reference");
    if (duplicates.has(rule.id)) list.push("duplicate");
    if (rule.conditions.length === 0) list.push("no-conditions");
    if (list.length) issues.set(rule.id, list);
  }
  return issues;
}

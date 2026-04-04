/**
 * Generates a human-readable one-line summary of a rule.
 * Resolves entity IDs to names using the staged store maps.
 */

import type { Rule, ConditionOrAction, AmountRange } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import type { Payee, Category, Account } from "@/types/entities";
import { CONDITION_FIELDS, ACTION_FIELDS } from "./ruleFields";

type EntityMaps = {
  payees: StagedMap<Payee>;
  categories: StagedMap<Category>;
  accounts: StagedMap<Account>;
};

/** Safely convert any condition/action value to a plain string for display. */
export function valueToString(value: string | number | string[] | AmountRange | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "object") {
    const r = value as AmountRange;
    return `${r.num1} – ${r.num2}`;
  }
  return String(value);
}

function resolveValue(
  field: string,
  value: string | number | string[] | AmountRange,
  maps: EntityMaps,
  fieldDefs: Record<string, { entity?: string }>
): string {
  const def = fieldDefs[field];
  const val = valueToString(value);

  if (def?.entity === "payee") {
    const p = maps.payees[val];
    return p ? p.entity.name : val;
  }
  if (def?.entity === "category") {
    const c = maps.categories[val];
    return c ? c.entity.name : val;
  }
  if (def?.entity === "account") {
    const a = maps.accounts[val];
    return a ? a.entity.name : val;
  }
  return val;
}

function summariseCondition(c: ConditionOrAction, maps: EntityMaps): string {
  const fieldLabel = CONDITION_FIELDS[c.field]?.label ?? c.field;
  const valueLabel = resolveValue(c.field, c.value, maps, CONDITION_FIELDS);
  return `${fieldLabel} ${c.op} "${valueLabel}"`;
}

function summariseAction(a: ConditionOrAction, maps: EntityMaps): string {
  const fieldLabel = ACTION_FIELDS[a.field]?.label ?? a.field;
  if (a.options !== undefined && "template" in a.options) {
    return `set ${fieldLabel} → template: ${a.options.template}`;
  }
  const valueLabel = resolveValue(a.field, a.value, maps, ACTION_FIELDS);
  return `set ${fieldLabel} → "${valueLabel}"`;
}

export function rulePreview(rule: Rule, maps: EntityMaps): string {
  const condParts = rule.conditions.map((c) => summariseCondition(c, maps));
  const actParts = rule.actions.map((a) => summariseAction(a, maps));

  const condText =
    condParts.length === 0 ? "(no conditions)" : condParts.join(` ${rule.conditionsOp} `);
  const actText = actParts.length === 0 ? "(no actions)" : actParts.join(", ");

  return `If ${condText} → ${actText}`;
}

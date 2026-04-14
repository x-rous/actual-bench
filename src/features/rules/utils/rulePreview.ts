/**
 * Generates a human-readable one-line summary of a rule.
 * Resolves entity IDs to names using the staged store maps.
 */

import type { Rule, ConditionOrAction, AmountRange, Schedule, RecurConfig } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import type { Payee, Category, Account, CategoryGroup } from "@/types/entities";
import { recurSummary } from "@/features/schedules/lib/recurSummary";
import { CONDITION_FIELDS, ACTION_FIELDS, ACTION_OPS } from "./ruleFields";

/** True when value is a RecurConfig (schedule-linked date condition). */
export function isRecurConfig(value: unknown): value is RecurConfig {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "frequency" in (value as object)
  );
}

export type EntityMaps = {
  payees: StagedMap<Payee>;
  categories: StagedMap<Category>;
  accounts: StagedMap<Account>;
  categoryGroups: StagedMap<CategoryGroup>;
  schedules?: StagedMap<Schedule>;
};

/** Safely convert any condition/action value to a plain string for display. */
export function valueToString(
  value: string | number | boolean | null | string[] | AmountRange | RecurConfig | undefined
): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (isRecurConfig(value)) return recurSummary(value) || "recurring";
  if (typeof value === "object") {
    const r = value as AmountRange;
    return `${r.num1} – ${r.num2}`;
  }
  return String(value);
}

function resolveValue(
  field: string,
  value: ConditionOrAction["value"],
  maps: EntityMaps,
  fieldDefs: Record<string, { entity?: string }>
): string {
  // Date conditions in schedule-linked rules carry a RecurConfig object as their value.
  if (field === "date" && isRecurConfig(value)) {
    return recurSummary(value) || "recurring";
  }

  const def = fieldDefs[field];

  // For array values with an entity field, resolve each ID individually before
  // joining — valueToString() would join the raw UUIDs first, making map lookups fail.
  if (Array.isArray(value) && def?.entity) {
    return (value as string[])
      .filter(Boolean)
      .map((id) => {
        if (def.entity === "payee")         return maps.payees[id]?.entity.name         ?? id;
        if (def.entity === "category")      return maps.categories[id]?.entity.name     ?? id;
        if (def.entity === "account")       return maps.accounts[id]?.entity.name       ?? id;
        if (def.entity === "categoryGroup") return maps.categoryGroups[id]?.entity.name ?? id;
        return id;
      })
      .join(", ");
  }

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
  if (def?.entity === "categoryGroup") {
    const cg = maps.categoryGroups[val];
    return cg ? cg.entity.name : val;
  }
  return val;
}

function summariseCondition(c: ConditionOrAction, maps: EntityMaps): string {
  const field = c.field ?? "";
  const fieldLabel = CONDITION_FIELDS[field]?.label ?? field;
  const valueLabel = resolveValue(field, c.value, maps, CONDITION_FIELDS);
  // Array values (e.g. oneOf) are already joined — no surrounding quotes needed.
  const wrapped = Array.isArray(c.value) ? valueLabel : `"${valueLabel}"`;
  return `${fieldLabel} ${c.op} ${wrapped}`;
}

function summariseAction(a: ConditionOrAction, maps: EntityMaps): string {
  if (a.op === "delete-transaction") return "delete transaction";

  if (a.op === "prepend-notes" || a.op === "append-notes") {
    const opLabel = ACTION_OPS[a.op]?.label ?? a.op;
    return `${opLabel} → "${valueToString(a.value)}"`;
  }

  const field = a.field ?? "";

  if (a.op === "link-schedule") {
    const scheduleId = valueToString(a.value);
    const scheduleName = maps.schedules?.[scheduleId]?.entity.name ?? scheduleId;
    return `linked to schedule → "${scheduleName}"`;
  }

  const fieldLabel = ACTION_FIELDS[field]?.label ?? field;

  if (a.options !== undefined && "template" in a.options) {
    return `set ${fieldLabel} → template: ${a.options.template}`;
  }

  const valueLabel = resolveValue(field, a.value, maps, ACTION_FIELDS);
  const wrapped = Array.isArray(a.value) ? valueLabel : `"${valueLabel}"`;
  return `set ${fieldLabel} → ${wrapped}`;
}

export function rulePreview(rule: Rule, maps: EntityMaps): string {
  const condParts = rule.conditions.map((c) => summariseCondition(c, maps));
  const actParts = rule.actions.map((a) => summariseAction(a, maps));

  const condText =
    condParts.length === 0 ? "(no conditions)" : condParts.join(` ${rule.conditionsOp} `);
  const actText = actParts.length === 0 ? "(no actions)" : actParts.join(", ");

  return `If ${condText} → ${actText}`;
}

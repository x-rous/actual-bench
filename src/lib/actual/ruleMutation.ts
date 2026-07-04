import { CONDITION_FIELDS, ACTION_FIELDS } from "@/features/rules/utils/ruleFields";
import type { AmountRange, ConditionOrAction, Rule } from "@/types/entities";

/** Fields whose values are entity IDs that may need client-to-server substitution. */
const ENTITY_REF_FIELDS = new Set([
  "payee",
  "account",
  "category",
  "category_group",
  "categoryGroup",
]);

export function applyRuleEntityIdMap(
  parts: ConditionOrAction[],
  idMap: Record<string, string>
): ConditionOrAction[] {
  if (Object.keys(idMap).length === 0) return parts;
  return parts.map((part) => {
    if (!part.field || !ENTITY_REF_FIELDS.has(part.field)) return part;
    const value = part.value;
    if (typeof value === "string" && idMap[value]) {
      return { ...part, value: idMap[value] };
    }
    if (Array.isArray(value)) {
      return {
        ...part,
        value: value.map((item) =>
          typeof item === "string" && idMap[item] ? idMap[item] : item
        ),
      };
    }
    return part;
  });
}

function amountToInternal(value: ConditionOrAction["value"]): ConditionOrAction["value"] {
  if (typeof value === "number") return Math.round(value * 100);
  if (typeof value === "object" && value !== null && "num1" in value) {
    const range = value as AmountRange;
    return {
      num1: Math.round(range.num1 * 100),
      num2: Math.round(range.num2 * 100),
    };
  }
  return value;
}

function prepareRuleParts(parts: ConditionOrAction[]): ConditionOrAction[] {
  return parts.map((part) => {
    const definition = CONDITION_FIELDS[part.field ?? ""] ?? ACTION_FIELDS[part.field ?? ""];
    if (definition?.type !== "number") return part;

    let value: ConditionOrAction["value"] = part.value;
    if (typeof value === "string" && value !== "") value = Number(value);

    return { ...part, value: amountToInternal(value) };
  });
}

export function prepareRuleForTransport(rule: Omit<Rule, "id">): Omit<Rule, "id">;
export function prepareRuleForTransport(rule: Rule): Rule;
export function prepareRuleForTransport(rule: Rule | Omit<Rule, "id">): Rule | Omit<Rule, "id"> {
  return {
    ...rule,
    conditions: prepareRuleParts(rule.conditions),
    actions: prepareRuleParts(rule.actions),
  };
}

export function prepareRulePatchForTransport(
  patch: Partial<Omit<Rule, "id">>
): Partial<Omit<Rule, "id">> {
  return {
    ...patch,
    ...(patch.conditions ? { conditions: prepareRuleParts(patch.conditions) } : {}),
    ...(patch.actions ? { actions: prepareRuleParts(patch.actions) } : {}),
  };
}

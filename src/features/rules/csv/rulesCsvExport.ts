import { csvField } from "@/lib/csv";
import { valueToString } from "../utils/rulePreview";
import type { Rule, ConditionOrAction, Payee, Category, Account } from "@/types/entities";
import type { StagedMap } from "@/types/staged";

type EntityMaps = {
  payees: StagedMap<Payee>;
  categories: StagedMap<Category>;
  accounts: StagedMap<Account>;
};

function resolveIdToName(id: string, maps: EntityMaps): string {
  return (
    maps.payees[id]?.entity.name ??
    maps.categories[id]?.entity.name ??
    maps.accounts[id]?.entity.name ??
    id
  );
}

function exportDisplayValue(
  coa: { value: ConditionOrAction["value"]; type?: string },
  maps: EntityMaps
): string {
  const { value, type } = coa;
  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((v) => (type === "id" ? resolveIdToName(String(v), maps) : String(v ?? "")))
      .join("|");
  }
  const scalar = valueToString(value);
  return type === "id" && scalar ? resolveIdToName(scalar, maps) : scalar;
}

/**
 * Serialize staged rules to long-format CSV string (without BOM).
 *
 * One row per condition or action; rows belonging to the same rule share the
 * same rule_id. Format: rule_id, stage, conditions_op, row_type, field, op, value
 */
export function exportRulesToCsv(stagedRules: StagedMap<Rule>, maps: EntityMaps): string {
  const lines: string[] = ["rule_id,stage,conditions_op,row_type,field,op,value"];

  for (const s of Object.values(stagedRules)) {
    if (s.isDeleted) continue;
    const rule = s.entity;
    let isFirstRow = true;

    for (const cond of rule.conditions) {
      lines.push([
        csvField(rule.id),
        isFirstRow ? csvField(rule.stage) : "",
        isFirstRow ? csvField(rule.conditionsOp) : "",
        "condition",
        csvField(cond.field),
        csvField(cond.op),
        csvField(exportDisplayValue(cond, maps)),
      ].join(","));
      isFirstRow = false;
    }

    for (const act of rule.actions) {
      const isTemplate = act.options !== undefined && "template" in act.options;
      lines.push([
        csvField(rule.id),
        isFirstRow ? csvField(rule.stage) : "",
        isFirstRow ? csvField(rule.conditionsOp) : "",
        "action",
        csvField(act.field),
        isTemplate ? "set-template" : csvField(act.op),
        isTemplate ? csvField(act.options!.template ?? "") : csvField(exportDisplayValue(act, maps)),
      ].join(","));
      isFirstRow = false;
    }

    // Empty rules: emit a header-only row so they survive round-trips
    if (rule.conditions.length === 0 && rule.actions.length === 0) {
      lines.push([
        csvField(rule.id),
        csvField(rule.stage),
        csvField(rule.conditionsOp),
        "", "", "", "",
      ].join(","));
    }
  }

  return lines.join("\n");
}

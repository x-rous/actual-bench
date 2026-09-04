import { csvField } from "@/lib/csv";
import { valueToString } from "../utils/rulePreview";
import { splitIndexOf } from "../lib/splitActions";
import type { EntityMaps } from "../utils/rulePreview";
import type { Rule, ConditionOrAction } from "@/types/entities";
import type { StagedMap } from "@/types/staged";

function resolveIdToName(id: string, maps: EntityMaps): string {
  return (
    maps.payees[id]?.entity.name ??
    maps.categories[id]?.entity.name ??
    maps.accounts[id]?.entity.name ??
    maps.categoryGroups[id]?.entity.name ??
    id
  );
}

function exportDisplayValue(
  coa: { value: ConditionOrAction["value"]; type?: string },
  maps: EntityMaps
): string {
  const { value, type } = coa;
  if (typeof value === "boolean") return value ? "true" : "false";
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
 * Encode the `options` keys that have no column of their own.
 *
 * `splitIndex` gets its own column because it is structural and worth reading at a glance;
 * `template`/`formula` are already encoded in the `op` column as `set-template`/`set-formula`.
 * What is left is `method` (on an allocation) and `inflow`/`outflow` (on an amount condition),
 * written as `k=v;k=v` rather than JSON so the cell stays readable and quote-free.
 */
export function encodeOptions(options: ConditionOrAction["options"]): string {
  if (!options) return "";
  const parts: string[] = [];
  if (options.method !== undefined) parts.push(`method=${options.method}`);
  if (options.inflow === true) parts.push("inflow=true");
  if (options.outflow === true) parts.push("outflow=true");
  return parts.join(";");
}

/**
 * Serialize staged rules to long-format CSV string (without BOM).
 *
 * One row per condition or action; rows belonging to the same rule share the same rule_id.
 * Format: rule_id, stage, conditions_op, row_type, field, op, value, split_index, options
 *
 * `split_index` and `options` were appended rather than inserted, and the importer resolves
 * columns by name, so a file exported before they existed still imports.
 */
export function exportRulesToCsv(stagedRules: StagedMap<Rule>, maps: EntityMaps): string {
  const lines: string[] = [
    "rule_id,stage,conditions_op,row_type,field,op,value,split_index,options",
  ];

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
        csvField(cond.field ?? ""),
        csvField(cond.op),
        csvField(exportDisplayValue(cond, maps)),
        "",
        csvField(encodeOptions(cond.options)),
      ].join(","));
      isFirstRow = false;
    }

    for (const act of rule.actions) {
      // Template and formula mode are encoded in the `op` column, but only for a `set` action —
      // an allocation with `method: "formula"` is still a `set-split-amount`, and rewriting its
      // op would lose the split.
      const isSet = act.op === "set";
      const isTemplate = isSet && act.options?.template !== undefined;
      const isFormula = isSet && act.options?.formula !== undefined;
      const isDeleteTxn = act.op === "delete-transaction";
      const isSplitFormula = act.op === "set-split-amount" && act.options?.method === "formula";

      // Prefix formulas starting with "=" with a single quote so spreadsheet apps
      // treat the cell as text rather than evaluating it as a formula.
      const rawFormula = act.options?.formula ?? "";
      const formulaExportValue = rawFormula.startsWith("=") ? "'" + rawFormula : rawFormula;

      const splitIndex = splitIndexOf(act);

      const opCell = isTemplate ? "set-template" : isFormula ? "set-formula" : csvField(act.op);
      const valueCell = isTemplate
        ? csvField(act.options?.template ?? "")
        : isFormula || isSplitFormula
        ? csvField(formulaExportValue)
        : isDeleteTxn
        ? ""
        : csvField(exportDisplayValue(act, maps));

      lines.push([
        csvField(rule.id),
        isFirstRow ? csvField(rule.stage) : "",
        isFirstRow ? csvField(rule.conditionsOp) : "",
        "action",
        csvField(act.field ?? ""),
        opCell,
        valueCell,
        splitIndex > 0 ? String(splitIndex) : "",
        csvField(encodeOptions(act.options)),
      ].join(","));
      isFirstRow = false;
    }

    // Empty rules: emit a header-only row so they survive round-trips
    if (rule.conditions.length === 0 && rule.actions.length === 0) {
      lines.push([
        csvField(rule.id),
        csvField(rule.stage),
        csvField(rule.conditionsOp),
        "", "", "", "", "", "",
      ].join(","));
    }
  }

  return lines.join("\n");
}

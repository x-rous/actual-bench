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
 * Characters that make a spreadsheet treat a cell as a formula rather than as text. A rule's
 * notes, template or payee name are free text a user controls, so an exported file could carry
 * `=HYPERLINK(...)` into whatever opens it next (CWE-1236).
 *
 * Prefixing with `'` is the standard neutralisation and is reversed on import, so the round-trip
 * is unaffected. Applied to text only — a numeric cell like `-50` is a number, not a formula, and
 * guarding it would make the file harder to read for no gain.
 */
// A leading apostrophe is part of the encoding, so a value that already starts with one has to
// be escaped too — otherwise `'=1+1` exports unchanged and the importer strips the user's own
// apostrophe, silently rewriting the rule.
const NEEDS_GUARD = /^['=+\-@\t\r]/;

export function guardCsvText(value: string): string {
  return NEEDS_GUARD.test(value) ? `'${value}` : value;
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
 * The display value with the formula guard applied, unless the part holds a plain number — an
 * amount is a number in the spreadsheet and should stay one.
 */
function exportTextValue(
  coa: { value: ConditionOrAction["value"]; type?: string },
  maps: EntityMaps
): string {
  const rendered = exportDisplayValue(coa, maps);
  return typeof coa.value === "number" ? rendered : guardCsvText(rendered);
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
        csvField(exportTextValue(cond, maps)),
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

      const splitIndex = splitIndexOf(act);

      const opCell = isTemplate ? "set-template" : isFormula ? "set-formula" : csvField(act.op);
      const valueCell = isTemplate
        ? csvField(guardCsvText(act.options?.template ?? ""))
        : isFormula || isSplitFormula
        ? csvField(guardCsvText(act.options?.formula ?? ""))
        : isDeleteTxn
        ? ""
        : csvField(exportTextValue(act, maps));

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

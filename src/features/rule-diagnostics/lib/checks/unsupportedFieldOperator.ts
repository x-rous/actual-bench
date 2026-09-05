import {
  ACTION_FIELDS,
  ACTION_OPS,
  CONDITION_FIELDS,
  PARENT_ONLY_ACTION_FIELDS,
  conditionDisplayField,
  isValidOp,
} from "@/features/rules/utils/ruleFields";
import { splitIndexOf } from "@/features/rules/lib/splitActions";
import type { CheckFn, Finding, FindingCode, RuleRef } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

export const unsupportedFieldOperator: CheckFn = (ws, ctx) => {
  const findings: Finding[] = [];

  for (const rule of ws.rules) {
    if (ctx.scheduleLinkedRuleIds.has(rule.id)) continue;
    const ruleRef: RuleRef = {
      id: rule.id,
      summary: findingRuleSummary(rule, ws.entityMaps),
    };

    for (const part of rule.conditions) {
      const field = part.field ?? "";
      // Validate against the field as stored. An `amount` condition carrying inflow/outflow
      // options is a real, valid condition — only the picker calls it `amount-inflow`.
      const fieldDef = CONDITION_FIELDS[conditionDisplayField(field, part.options)];
      if (!fieldDef) {
        findings.push(
          emit("RULE_UNSUPPORTED_CONDITION_FIELD", ruleRef, { field })
        );
        continue;
      }
      // `isValidOp`, not the picker's list: the engine also accepts internal operators such as
      // `and` on category, which Actual writes but never offers.
      if (!isValidOp(field, part.op)) {
        findings.push(
          emit("RULE_UNSUPPORTED_CONDITION_OP", ruleRef, { field, op: part.op })
        );
      }
    }

    for (const part of rule.actions) {
      // Skip schedule-managed actions.
      if (part.op === "link-schedule") continue;

      if (!ACTION_OPS[part.op]) {
        findings.push(
          emit("RULE_UNSUPPORTED_ACTION_OP", ruleRef, { op: part.op })
        );
        continue;
      }

      // delete-transaction and set-split-amount have no field.
      if (part.op === "delete-transaction") continue;
      if (part.op === "set-split-amount") continue;

      // notes-mutation ops have an implicit field.
      if (part.op === "prepend-notes" || part.op === "append-notes") {
        if (part.options?.template !== undefined) {
          findings.push(
            emit("RULE_TEMPLATE_ON_UNSUPPORTED_FIELD", ruleRef, { field: "notes" })
          );
        }
        continue;
      }

      const field = part.field ?? "";
      const fieldDef = ACTION_FIELDS[field];
      if (part.op === "set" && !fieldDef) {
        findings.push(
          emit("RULE_UNSUPPORTED_ACTION_FIELD", ruleRef, { field })
        );
        continue;
      }

      // Amount, cleared, account and date belong to the whole transaction; the engine has no
      // way to apply them to a split child.
      if (part.op === "set" && splitIndexOf(part) > 0 && PARENT_ONLY_ACTION_FIELDS.has(field)) {
        findings.push(
          emit("RULE_UNSUPPORTED_ACTION_FIELD", ruleRef, { field })
        );
        continue;
      }

      if (
        part.options?.template !== undefined &&
        fieldDef?.supportsTemplate !== true
      ) {
        findings.push(
          emit("RULE_TEMPLATE_ON_UNSUPPORTED_FIELD", ruleRef, { field })
        );
      }
    }
  }

  findings.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const aId = a.affected[0]?.id ?? "";
    const bId = b.affected[0]?.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return findings;
};

function emit(
  code: FindingCode,
  rule: RuleRef,
  args: Record<string, unknown>
): Finding {
  return buildFinding(code, [rule], args);
}

registerCheck(unsupportedFieldOperator);

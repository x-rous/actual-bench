import {
  ACTION_FIELDS,
  ACTION_OPS,
  CONDITION_FIELDS,
  getConditionOps,
} from "@/features/rules/utils/ruleFields";
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
      const fieldDef = CONDITION_FIELDS[field];
      if (!fieldDef) {
        findings.push(
          emit("RULE_UNSUPPORTED_CONDITION_FIELD", ruleRef, { field })
        );
        continue;
      }
      const ops = getConditionOps(field);
      if (!ops[part.op]) {
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

      // delete-transaction has no field.
      if (part.op === "delete-transaction") continue;

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

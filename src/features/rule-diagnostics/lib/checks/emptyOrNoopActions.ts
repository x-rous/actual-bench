import type { ConditionOrAction } from "@/types/entities";
import type { CheckFn, Finding, RuleRef } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

function isNoopAction(action: ConditionOrAction): boolean {
  if (action.op === "set") {
    return !action.field || action.field.length === 0;
  }
  if (action.op === "prepend-notes" || action.op === "append-notes") {
    if (typeof action.value !== "string") return action.value == null;
    return action.value.trim().length === 0;
  }
  return false;
}

export const emptyOrNoopActions: CheckFn = (ws, ctx) => {
  const findings: Finding[] = [];

  for (const rule of ws.rules) {
    if (ctx.scheduleLinkedRuleIds.has(rule.id)) continue;

    const ruleRef: RuleRef = {
      id: rule.id,
      summary: findingRuleSummary(rule, ws.entityMaps),
    };

    if (rule.actions.length === 0) {
      findings.push(buildFinding("RULE_EMPTY_ACTIONS", [ruleRef]));
      continue;
    }

    const allNoop = rule.actions.every(isNoopAction);
    if (allNoop) {
      findings.push(
        buildFinding("RULE_NOOP_ACTIONS", [ruleRef], {
          noopActions: rule.actions.map((a) => `${a.op}${a.field ? " " + a.field : ""}`),
        })
      );
    }
  }

  findings.sort((a, b) => {
    const aId = a.affected[0]?.id ?? "";
    const bId = b.affected[0]?.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return findings;
};

registerCheck(emptyOrNoopActions);

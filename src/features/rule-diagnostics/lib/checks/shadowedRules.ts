import type { CheckFn, Finding, RuleRef } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findShadowedPairs } from "../shadowDetection";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

export const shadowedRules: CheckFn = (ws, ctx) => {
  const findings: Finding[] = [];

  // Evaluate per stage; shadow detection ignores conditionsOp partitioning
  // (the algorithm itself only accepts `and` rules on both sides) so we flat-
  // concat all rules within each stage.
  const byStage = new Map<string, typeof ws.rules>();
  for (const rule of ws.rules) {
    const bucket = byStage.get(rule.stage);
    if (bucket) bucket.push(rule);
    else byStage.set(rule.stage, [rule]);
  }

  for (const rules of byStage.values()) {
    const pairs = findShadowedPairs(rules);
    for (const { shadowed, shadowing } of pairs) {
      if (ctx.scheduleLinkedRuleIds.has(shadowed.id)) continue;
      const shadowedRef: RuleRef = {
        id: shadowed.id,
        summary: findingRuleSummary(shadowed, ws.entityMaps),
      };
      const shadowingRef: RuleRef = {
        id: shadowing.id,
        summary: findingRuleSummary(shadowing, ws.entityMaps),
      };
      findings.push(buildFinding("RULE_SHADOWED", [shadowedRef], {}, shadowingRef));
    }
  }

  findings.sort((a, b) => {
    const aId = a.affected[0]?.id ?? "";
    const bId = b.affected[0]?.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return findings;
};

registerCheck(shadowedRules);

import type { CheckFn, Finding, RuleRef } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

/** Threshold below (or equal to) which a `contains`/`matches` value is suspect. */
export const BROAD_MATCH_MIN_LENGTH = 3;

const BROAD_OPS = new Set(["contains", "doesNotContain", "matches"]);

export const broadMatchCriteria: CheckFn = (ws, ctx) => {
  const findings: Finding[] = [];

  for (const rule of ws.rules) {
    if (ctx.scheduleLinkedRuleIds.has(rule.id)) continue;
    const ruleRef: RuleRef = {
      id: rule.id,
      summary: findingRuleSummary(rule, ws.entityMaps),
    };

    for (const part of rule.conditions) {
      if (!BROAD_OPS.has(part.op)) continue;
      if (typeof part.value !== "string") continue;
      const trimmed = part.value.trim();
      if (trimmed.length >= BROAD_MATCH_MIN_LENGTH) continue;
      findings.push(
        buildFinding("RULE_BROAD_MATCH", [ruleRef], {
          field: part.field ?? "(unknown field)",
          value: part.value,
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

registerCheck(broadMatchCriteria);

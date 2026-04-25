import type { CheckFn, Finding, RuleRef } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

export const duplicateRules: CheckFn = (ws, ctx) => {
  const findings: Finding[] = [];

  // Bucket rule IDs by full rule signature, skipping schedule-linked rules.
  const buckets = new Map<string, string[]>();
  for (const rule of ws.rules) {
    if (ctx.scheduleLinkedRuleIds.has(rule.id)) continue;
    const sig = ctx.ruleSignatures.get(rule.id);
    if (!sig) continue;
    const list = buckets.get(sig);
    if (list) list.push(rule.id);
    else buckets.set(sig, [rule.id]);
  }

  // Index rules by id once for cheap lookup.
  const rulesById = new Map<string, (typeof ws.rules)[number]>();
  for (const r of ws.rules) rulesById.set(r.id, r);

  for (const [, ids] of buckets) {
    if (ids.length < 2) continue;
    const sortedIds = [...ids].sort();
    const refs: RuleRef[] = sortedIds.map((id) => {
      const r = rulesById.get(id)!;
      return { id, summary: findingRuleSummary(r, ws.entityMaps) };
    });
    findings.push(buildFinding("RULE_DUPLICATE_GROUP", refs));
  }

  findings.sort((a, b) => {
    const aId = a.affected[0]?.id ?? "";
    const bId = b.affected[0]?.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return findings;
};

registerCheck(duplicateRules);

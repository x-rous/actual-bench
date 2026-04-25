import type { CheckFn, Finding } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

/** Skip near-duplicate evaluation when a partition has more than this many rules. */
export const NEAR_DUPLICATE_PARTITION_CAP = 300;

function symmetricDiffCount(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let count = 0;
  for (const v of setA) if (!setB.has(v)) count++;
  for (const v of setB) if (!setA.has(v)) count++;
  return count;
}

export const nearDuplicateRules: CheckFn = (ws, ctx) => {
  const findings: Finding[] = [];

  for (const [partitionKey, rules] of ctx.rulesByPartition) {
    // Filter out schedule-linked + full-duplicate rules.
    const eligible = rules.filter(
      (r) =>
        !ctx.scheduleLinkedRuleIds.has(r.id) &&
        !ctx.fullDuplicateRuleIds.has(r.id)
    );
    if (eligible.length < 2) continue;

    if (eligible.length > NEAR_DUPLICATE_PARTITION_CAP) {
      findings.push(
        buildFinding("RULE_ANALYZER_SKIPPED", [], {
          reason: `Skipped near-duplicate detection in stage \`${partitionKey}\` because it contains ${eligible.length} rules (cap is ${NEAR_DUPLICATE_PARTITION_CAP}).`,
          detail: [
            `partition: ${partitionKey}`,
            `rule count: ${eligible.length}`,
            `cap: ${NEAR_DUPLICATE_PARTITION_CAP}`,
          ],
        })
      );
      continue;
    }

    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i];
        const b = eligible[j];
        const sigA = ctx.partSignatures.get(a.id) ?? [];
        const sigB = ctx.partSignatures.get(b.id) ?? [];
        const diff = symmetricDiffCount(sigA, sigB);
        if (diff !== 1 && diff !== 2) continue;

        const lowerId = a.id < b.id ? a : b;
        const higherId = a.id < b.id ? b : a;

        findings.push(
          buildFinding(
            "RULE_NEAR_DUPLICATE_PAIR",
            [
              { id: lowerId.id, summary: findingRuleSummary(lowerId, ws.entityMaps) },
              { id: higherId.id, summary: findingRuleSummary(higherId, ws.entityMaps) },
            ],
            { diffCount: diff }
          )
        );
      }
    }
  }

  findings.sort((a, b) => {
    const aId = a.affected[0]?.id ?? "";
    const bId = b.affected[0]?.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return findings;
};

registerCheck(nearDuplicateRules);

import type { CheckFn, Finding } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

/**
 * Skip near-duplicate evaluation when a partition has more than this many
 * eligible rules. Detection is O(n²) in the partition size, but each pairwise
 * comparison is a cheap early-exiting merge (see `symmetricDiffCountCapped`),
 * so this only guards against pathological rule sets. At the cap that is
 * ~2M comparisons, comfortably under a frame's worth of work for realistic
 * data where most pairs bail out after the first few differing parts.
 */
export const NEAR_DUPLICATE_PARTITION_CAP = 2000;

/**
 * Count of part-signatures present in exactly one of the two arrays, given both
 * are sorted ascending and free of internal duplicates. Short-circuits as soon
 * as the count passes 2 — callers only care about the 1-or-2 "near-duplicate"
 * band, so once we know it's ≥ 3 the exact value is irrelevant. Returns a value
 * > 2 (not necessarily the true count) in that case.
 */
function symmetricDiffCountCapped(a: string[], b: string[]): number {
  let i = 0;
  let j = 0;
  let count = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (a[i] < b[j]) {
      count++;
      i++;
    } else {
      count++;
      j++;
    }
    if (count > 2) return count;
  }
  return count + (a.length - i) + (b.length - j);
}

/**
 * Return a sorted, duplicate-free copy of a rule's part signatures.
 * `rulePartSignatures` sorts conditions and actions separately and concatenates
 * them, so the combined array is not globally ordered — sort here to satisfy the
 * merge assumptions of `symmetricDiffCountCapped`.
 */
function sortedUniqueSignatures(sigs: readonly string[]): string[] {
  const sorted = [...sigs].sort();
  const out: string[] = [];
  for (const v of sorted) {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
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

    // Precompute each rule's sorted, de-duplicated part signatures once so the
    // O(n²) pair scan below only does an early-exiting merge per pair rather
    // than rebuilding sets for every comparison.
    const sigs = new Map<string, string[]>();
    for (const r of eligible) {
      sigs.set(r.id, sortedUniqueSignatures(ctx.partSignatures.get(r.id) ?? []));
    }

    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i];
        const b = eligible[j];
        const sigA = sigs.get(a.id) ?? [];
        const sigB = sigs.get(b.id) ?? [];
        const diff = symmetricDiffCountCapped(sigA, sigB);
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

import type { CheckFn, Finding, Rule } from "../../types";
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

/**
 * Union-find over rule ids, so near-duplicate *pairs* become near-duplicate
 * *families*.
 *
 * Connected components, not cliques. Cliques would be the stricter reading —
 * every member similar to every other — but finding them is exponential, and
 * the chained case is one users recognise: `A~B` and `B~C` with `A` and `C` two
 * parts apart is still one family of grocery rules. What it must not do is
 * *claim* every pair is similar, which is why the finding says these rules form
 * a family and lists them, rather than asserting a relationship between any two.
 */
class DisjointSet {
  private parent = new Map<string, string>();

  find(id: string): string {
    const seen = this.parent.get(id);
    if (seen === undefined) {
      this.parent.set(id, id);
      return id;
    }
    if (seen === id) return id;
    const root = this.find(seen);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // Lexicographic, so the component's representative does not depend on the
    // order the pairs happened to be discovered in. The report has to be
    // byte-identical across runs.
    if (rootA < rootB) this.parent.set(rootB, rootA);
    else this.parent.set(rootA, rootB);
  }
}

/**
 * The part signatures that are not shared by every member — what actually
 * varies across the family. Reported as a count rather than as the raw
 * signatures, which are JSON and unreadable; the members themselves carry the
 * detail, and the merge dialog shows all of it.
 */
function describeVariation(members: Rule[], sigs: Map<string, string[]>): number {
  const lists = members.map((m) => sigs.get(m.id) ?? []);
  const shared = new Set(lists[0]);
  for (const list of lists.slice(1)) {
    const present = new Set(list);
    for (const value of [...shared]) {
      if (!present.has(value)) shared.delete(value);
    }
  }
  const union = new Set<string>();
  for (const list of lists) for (const value of list) union.add(value);
  return union.size - shared.size;
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

    // Pairwise still, because the comparison is cheap and exact — but the pairs
    // are edges, not findings. A family of k similar rules has k(k-1)/2 pairs,
    // and emitting one finding each buried the report: seventeen of the demo's
    // twenty-three findings were pairs drawn from a handful of rules, every one
    // of them saying almost the same thing.
    const family = new DisjointSet();
    let edges = 0;
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i];
        const b = eligible[j];
        const sigA = sigs.get(a.id) ?? [];
        const sigB = sigs.get(b.id) ?? [];
        const diff = symmetricDiffCountCapped(sigA, sigB);
        if (diff !== 1 && diff !== 2) continue;
        family.union(a.id, b.id);
        edges++;
      }
    }
    if (edges === 0) continue;

    const byRoot = new Map<string, Rule[]>();
    for (const rule of eligible) {
      const root = family.find(rule.id);
      const bucket = byRoot.get(root);
      if (bucket) bucket.push(rule);
      else byRoot.set(root, [rule]);
    }

    for (const members of byRoot.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      findings.push(
        buildFinding(
          "RULE_NEAR_DUPLICATE_FAMILY",
          members.map((rule) => ({
            id: rule.id,
            summary: findingRuleSummary(rule, ws.entityMaps),
          })),
          {
            stage: members[0].stage,
            varying: describeVariation(members, sigs),
          }
        )
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

registerCheck(nearDuplicateRules);

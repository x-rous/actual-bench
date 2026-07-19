import type { Rule } from "@/types/entities";
import type { CheckContext, WorkingSet } from "../../types";
import { rulePartSignatures, ruleSignature } from "../ruleSignature";
import {
  NEAR_DUPLICATE_PARTITION_CAP,
  nearDuplicateRules,
} from "./nearDuplicateRules";

function rule(partial: Partial<Rule> & { id: string }): Rule {
  return {
    id: partial.id,
    stage: partial.stage ?? "default",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [],
    actions: partial.actions ?? [{ field: "category", op: "set", value: "c-1" }],
  };
}

function ws(rules: Rule[]): WorkingSet {
  return {
    rules,
    entityMaps: { payees: {}, categories: {}, accounts: {}, categoryGroups: {}, schedules: {} },
    entityExists: {
      payees: new Set(),
      categories: new Set(),
      accounts: new Set(),
      categoryGroups: new Set(),
    },
  };
}

function makeCtx(
  rules: Rule[],
  options: { scheduleLinked?: string[]; fullDuplicates?: string[] } = {}
): CheckContext {
  const partSignatures = new Map<string, string[]>();
  const ruleSignatures = new Map<string, string>();
  const rulesByPartition = new Map<string, Rule[]>();
  for (const r of rules) {
    partSignatures.set(r.id, rulePartSignatures(r));
    ruleSignatures.set(r.id, ruleSignature(r));
    const key = `${r.stage}|${r.conditionsOp}`;
    const bucket = rulesByPartition.get(key);
    if (bucket) bucket.push(r);
    else rulesByPartition.set(key, [r]);
  }
  return {
    partSignatures,
    ruleSignatures,
    rulesByPartition,
    scheduleLinkedRuleIds: new Set(options.scheduleLinked ?? []),
    fullDuplicateRuleIds: new Set(options.fullDuplicates ?? []),
  };
}

describe("nearDuplicateRules", () => {
  it("flags a pair differing by exactly one action", () => {
    const a = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Spotify" }],
      actions: [{ field: "payee", op: "set", value: "p-spotify" }],
    });
    const b = rule({
      id: "r2",
      conditions: [{ field: "imported_payee", op: "contains", value: "Spotify" }],
      actions: [
        { field: "payee", op: "set", value: "p-spotify" },
        { field: "category", op: "set", value: "c-music" },
      ],
    });
    const findings = nearDuplicateRules(ws([a, b]), makeCtx([a, b]));
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_NEAR_DUPLICATE_PAIR");
    expect(findings[0].affected.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("flags a pair where B is a strict superset of A by one extra condition and one extra action (diff=2)", () => {
    // Symmetric-diff count over the union of part signatures.
    // A's parts ⊂ B's parts; B has exactly two extra parts → diff = 2.
    const a = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Spotify" }],
      actions: [{ field: "payee", op: "set", value: "p-spotify" }],
    });
    const b = rule({
      id: "r2",
      conditions: [
        { field: "imported_payee", op: "contains", value: "Spotify" },
        { field: "amount", op: "gt", value: 5 }, // ← extra condition
      ],
      actions: [
        { field: "payee", op: "set", value: "p-spotify" },
        { field: "category", op: "set", value: "c-music" }, // ← extra action
      ],
    });
    const findings = nearDuplicateRules(ws([a, b]), makeCtx([a, b]));
    expect(findings).toHaveLength(1);
  });

  it("does NOT flag pairs differing by three or more parts", () => {
    const a = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Spotify" }],
      actions: [{ field: "payee", op: "set", value: "p-spotify" }],
    });
    const b = rule({
      id: "r2",
      conditions: [{ field: "imported_payee", op: "contains", value: "Different" }],
      actions: [
        { field: "payee", op: "set", value: "p-different" },
        { field: "category", op: "set", value: "c-other" },
      ],
    });
    const findings = nearDuplicateRules(ws([a, b]), makeCtx([a, b]));
    expect(findings).toHaveLength(0);
  });

  it("does NOT flag a pair already marked as full duplicates", () => {
    const a = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Spotify" }],
    });
    const b = { ...a, id: "r2" };
    const findings = nearDuplicateRules(ws([a, b]), makeCtx([a, b], { fullDuplicates: ["r1", "r2"] }));
    expect(findings).toHaveLength(0);
  });

  it("emits an analyzer-skipped notice when partition exceeds the cap", () => {
    // Build 305 rules with mostly-similar shape so they end up in one partition.
    const rules: Rule[] = [];
    for (let i = 0; i < NEAR_DUPLICATE_PARTITION_CAP + 5; i++) {
      rules.push(
        rule({
          id: `r${i}`,
          conditions: [{ field: "imported_payee", op: "contains", value: `value-${i}` }],
        })
      );
    }
    const findings = nearDuplicateRules(ws(rules), makeCtx(rules));
    const skipped = findings.find((f) => f.code === "RULE_ANALYZER_SKIPPED");
    expect(skipped).toBeDefined();
    expect(skipped?.affected).toHaveLength(0);
    expect(skipped?.severity).toBe("info");
  });

  it("still analyzes partitions larger than the old 300-rule cap (issue #165)", () => {
    // 400 distinct rules (above the previous cap of 300, below the new cap)
    // plus one planted near-duplicate of the first — detection must run and
    // flag the planted pair rather than skipping the whole partition.
    const rules: Rule[] = [];
    for (let i = 0; i < 400; i++) {
      rules.push(
        rule({
          id: `r${i}`,
          conditions: [{ field: "imported_payee", op: "contains", value: `value-${i}` }],
          actions: [{ field: "payee", op: "set", value: `p-${i}` }],
        })
      );
    }
    // Near-duplicate of r0: same condition, one extra action (diff = 1).
    rules.push(
      rule({
        id: "r-dup",
        conditions: [{ field: "imported_payee", op: "contains", value: "value-0" }],
        actions: [
          { field: "payee", op: "set", value: "p-0" },
          { field: "category", op: "set", value: "c-extra" },
        ],
      })
    );

    const findings = nearDuplicateRules(ws(rules), makeCtx(rules));
    expect(findings.some((f) => f.code === "RULE_ANALYZER_SKIPPED")).toBe(false);
    const pair = findings.find((f) => f.code === "RULE_NEAR_DUPLICATE_PAIR");
    expect(pair?.affected.map((r) => r.id).sort()).toEqual(["r-dup", "r0"]);
  });

  it("does not flag schedule-linked rules", () => {
    const a = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Spotify" }],
    });
    const b = rule({
      id: "r-sched",
      conditions: [{ field: "imported_payee", op: "contains", value: "Spotify-Premium" }],
      actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
    });
    const findings = nearDuplicateRules(ws([a, b]), makeCtx([a, b], { scheduleLinked: ["r-sched"] }));
    expect(findings).toHaveLength(0);
  });
});

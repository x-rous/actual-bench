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
    expect(findings[0].code).toBe("RULE_NEAR_DUPLICATE_FAMILY");
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

  it("flags a near-duplicate whose signatures interleave across the conditions/actions boundary", () => {
    // `rulePartSignatures` lists conditions before actions, each half sorted
    // separately, so the combined array is NOT globally sorted: here the
    // `category` action signature sorts before the `imported_payee`/`amount`
    // condition signatures. The pair differs only by the condition (a diff-2
    // swap) and must be flagged — a merge that assumed global ordering would
    // miscount and miss it.
    const a = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Netflix" }],
      actions: [{ field: "category", op: "set", value: "c-1" }],
    });
    const b = rule({
      id: "r2",
      conditions: [{ field: "amount", op: "gt", value: 5 }],
      actions: [{ field: "category", op: "set", value: "c-1" }],
    });
    const findings = nearDuplicateRules(ws([a, b]), makeCtx([a, b]));
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_NEAR_DUPLICATE_FAMILY");
    expect(findings[0].affected.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
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
    const family = findings.find((f) => f.code === "RULE_NEAR_DUPLICATE_FAMILY");
    expect(family?.affected.map((r) => r.id).sort()).toEqual(["r-dup", "r0"]);
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

describe("nearDuplicateRules — families", () => {
  function payeeRule(id: string, payee: string, stage: Rule["stage"] = "default"): Rule {
    return rule({
      id,
      stage,
      conditions: [{ field: "payee", op: "is", value: payee }],
      actions: [{ field: "category", op: "set", value: "c-groceries" }],
    });
  }

  it("collapses a family of six into one finding rather than fifteen pairs", () => {
    const rules = ["aldi", "lidl", "coles", "woolies", "iga", "spar"].map((name, i) =>
      payeeRule(`r${i}`, name)
    );
    const findings = nearDuplicateRules(ws(rules), makeCtx(rules));

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_NEAR_DUPLICATE_FAMILY");
    expect(findings[0].affected).toHaveLength(6);
    expect(findings[0].title).toBe("6 near-identical rules");
  });

  it("chains transitively: A~B and B~C are one family of three", () => {
    // Two parts apart at the ends, one apart in the middle — still one family.
    const a = rule({
      id: "r1",
      conditions: [{ field: "payee", op: "is", value: "p1" }],
      actions: [{ field: "category", op: "set", value: "c1" }],
    });
    const b = rule({
      id: "r2",
      conditions: [{ field: "payee", op: "is", value: "p2" }],
      actions: [{ field: "category", op: "set", value: "c1" }],
    });
    const c = rule({
      id: "r3",
      conditions: [{ field: "payee", op: "is", value: "p2" }],
      actions: [{ field: "category", op: "set", value: "c2" }],
    });
    const findings = nearDuplicateRules(ws([a, b, c]), makeCtx([a, b, c]));

    expect(findings).toHaveLength(1);
    expect(findings[0].affected.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("keeps two disjoint families in the same stage apart", () => {
    const groceries = ["aldi", "lidl"].map((n, i) => payeeRule(`g${i}`, n));
    const fuel = ["shell", "bp"].map((n, i) =>
      rule({
        id: `f${i}`,
        conditions: [{ field: "payee", op: "is", value: n }],
        actions: [{ field: "category", op: "set", value: "c-fuel" }],
      })
    );
    const all = [...groceries, ...fuel];
    const findings = nearDuplicateRules(ws(all), makeCtx(all));

    expect(findings).toHaveLength(2);
    for (const finding of findings) expect(finding.affected).toHaveLength(2);
  });

  it("does not group across stages", () => {
    const a = payeeRule("r1", "aldi", "pre");
    const b = payeeRule("r2", "lidl", "post");
    expect(nearDuplicateRules(ws([a, b]), makeCtx([a, b]))).toHaveLength(0);
  });

  it("never carries a counterpart, so no message can name one of its own rules", () => {
    const rules = ["aldi", "lidl"].map((n, i) => payeeRule(`r${i}`, n));
    const [finding] = nearDuplicateRules(ws(rules), makeCtx(rules));

    expect(finding.counterpart).toBeUndefined();
    for (const member of finding.affected) {
      expect(finding.message).not.toContain(member.summary);
    }
  });

  it("is deterministic regardless of the order rules arrive in", () => {
    const rules = ["aldi", "lidl", "coles"].map((n, i) => payeeRule(`r${i}`, n));
    const forward = nearDuplicateRules(ws(rules), makeCtx(rules));
    const reversed = [...rules].reverse();
    const backward = nearDuplicateRules(ws(reversed), makeCtx(reversed));

    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it("reports how many parts vary across the family", () => {
    const rules = ["aldi", "lidl"].map((n, i) => payeeRule(`r${i}`, n));
    const [finding] = nearDuplicateRules(ws(rules), makeCtx(rules));

    // Two distinct payee conditions, one shared action.
    expect(finding.details?.[0]).toContain("2 conditions or actions vary");
  });
});

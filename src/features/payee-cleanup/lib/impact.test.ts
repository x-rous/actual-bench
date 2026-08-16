import {
  buildClusterImpact,
  classifyRuleReferences,
  compareBehavior,
  impactSignals,
} from "./impact";
import { findOrphanPayees } from "./orphans";
import type { PayeeCluster } from "./clusterResolver";
import type { PayeeCleanupCandidate } from "../types";
import type { Rule, Schedule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";

function payee(
  id: string,
  overrides: Partial<PayeeCleanupCandidate["metadata"]> = {}
): PayeeCleanupCandidate {
  return {
    id,
    name: id.toUpperCase(),
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
      ...overrides,
    },
  };
}

function rule(id: string, payeeId: string, where: "condition" | "action"): Rule {
  const part = { field: "payee", op: "is", value: payeeId };
  return {
    id,
    stage: "default",
    conditionsOp: "and",
    conditions: where === "condition" ? [part] : [],
    actions: where === "action" ? [part] : [],
  };
}

function staged(rules: Rule[]): StagedMap<Rule> {
  const map: StagedMap<Rule> = {};
  for (const r of rules) {
    map[r.id] = {
      entity: r,
      original: r,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    };
  }
  return map;
}

function schedule(id: string, ruleId: string, completed: boolean): Schedule {
  return { id, ruleId, completed, postsTransaction: true };
}

function cluster(members: PayeeCleanupCandidate[]): PayeeCluster {
  return {
    id: members.map((m) => m.id).join("+"),
    members,
    stem: "STEM",
    evidence: [],
    fuzzyOnly: false,
  };
}

describe("classifyRuleReferences", () => {
  it("separates regular rules from schedule-linked ones", () => {
    // A schedule reaches its payee *through* a rule, so counting "3 rules and
    // 1 schedule" would report the same relationship twice.
    const rules = staged([
      rule("r1", "p1", "condition"),
      rule("r2", "p1", "condition"),
      rule("r3", "p1", "condition"),
    ]);
    const schedules = [schedule("s1", "r3", false)];

    expect(classifyRuleReferences(["p1"], rules, schedules)).toEqual({
      regular: 2,
      activeSchedule: 1,
      completedSchedule: 0,
    });
  });

  it("keeps completed schedules out of the active count", () => {
    // Matches Actual's own `getPayeeRuleCounts`, which skips them.
    const rules = staged([rule("r1", "p1", "condition"), rule("r2", "p1", "condition")]);
    const schedules = [schedule("s1", "r1", true), schedule("s2", "r2", false)];

    expect(classifyRuleReferences(["p1"], rules, schedules)).toEqual({
      regular: 0,
      activeSchedule: 1,
      completedSchedule: 1,
    });
  });

  it("counts a rule that references any member of the cluster", () => {
    const rules = staged([rule("r1", "p2", "condition")]);
    expect(classifyRuleReferences(["p1", "p2"], rules, []).regular).toBe(1);
  });

  it("counts a rule that only sets the payee in an action", () => {
    const rules = staged([rule("r1", "p1", "action")]);
    expect(classifyRuleReferences(["p1"], rules, []).regular).toBe(1);
  });

  it("ignores rules staged for deletion", () => {
    const rules = staged([rule("r1", "p1", "condition")]);
    rules["r1"].isDeleted = true;
    expect(classifyRuleReferences(["p1"], rules, []).regular).toBe(0);
  });

  it("counts a rule once even when it names the payee twice", () => {
    const r: Rule = {
      id: "r1",
      stage: "default",
      conditionsOp: "and",
      conditions: [{ field: "payee", op: "is", value: "p1" }],
      actions: [{ field: "payee", op: "set", value: "p1" }],
    };
    expect(classifyRuleReferences(["p1"], staged([r]), []).regular).toBe(1);
  });
});

describe("compareBehavior", () => {
  it("reports a favorite difference and which value survives", () => {
    const members = [payee("p1", { favorite: true }), payee("p2", { favorite: false })];
    const behavior = compareBehavior(members, "p2");

    expect(behavior.favoriteDiffers).toBe(true);
    // The target's own value survives — merge does not combine them.
    expect(behavior.survivingFavorite).toBe(false);
  });

  it("reports a category-learning difference", () => {
    const members = [
      payee("p1", { learnCategories: true }),
      payee("p2", { learnCategories: false }),
    ];
    expect(compareBehavior(members, "p1").learnCategoriesDiffers).toBe(true);
    expect(compareBehavior(members, "p1").survivingLearnCategories).toBe(true);
  });

  it("reports agreement when every member matches", () => {
    const members = [payee("p1", { favorite: true }), payee("p2", { favorite: true })];
    const behavior = compareBehavior(members, "p1");
    expect(behavior.favoriteDiffers).toBe(false);
    expect(behavior.survivingFavorite).toBe(true);
  });
});

describe("buildClusterImpact", () => {
  const members = [payee("p1"), payee("p2")];

  it("totals transactions across the cluster", () => {
    const impact = buildClusterImpact(cluster(members), "p1", {
      stagedRules: {},
      schedules: [],
      transactionCounts: new Map([
        ["p1", 47],
        ["p2", 23],
      ]),
      transactionsLoading: false,
    });

    expect(impact.transactionTotal).toBe(70);
    expect(impact.members.map((m) => m.transactionCount)).toEqual([47, 23]);
  });

  it("never reports a total while counts are still loading", () => {
    // Showing 0 during load would read as "this payee is unused", which is the
    // opposite of the truth and would drive a wrong decision.
    const impact = buildClusterImpact(cluster(members), "p1", {
      stagedRules: {},
      schedules: [],
      transactionCounts: undefined,
      transactionsLoading: true,
    });

    expect(impact.transactionTotal).toBeUndefined();
    expect(impact.transactionsLoading).toBe(true);
  });

  it("treats a loaded map with no entry as a real zero", () => {
    const impact = buildClusterImpact(cluster(members), "p1", {
      stagedRules: {},
      schedules: [],
      transactionCounts: new Map(),
      transactionsLoading: false,
    });
    expect(impact.transactionTotal).toBe(0);
  });
});

describe("impactSignals", () => {
  const base = {
    stagedRules: {},
    schedules: [],
    transactionCounts: new Map<string, number>(),
    transactionsLoading: false,
  };

  it("flags a behaviour conflict", () => {
    const impact = buildClusterImpact(
      cluster([payee("p1", { favorite: true }), payee("p2")]),
      "p1",
      base
    );
    expect(impactSignals(impact).behaviorConflict).toBe(true);
  });

  it("flags a rule conflict when more than one member carries rules", () => {
    const impact = buildClusterImpact(cluster([payee("p1"), payee("p2")]), "p1", {
      ...base,
      stagedRules: staged([rule("r1", "p1", "condition"), rule("r2", "p2", "condition")]),
    });
    expect(impactSignals(impact).ruleConflict).toBe(true);
  });

  it("does not flag a conflict when only the target carries rules", () => {
    const impact = buildClusterImpact(cluster([payee("p1"), payee("p2")]), "p1", {
      ...base,
      stagedRules: staged([rule("r1", "p1", "condition")]),
    });
    expect(impactSignals(impact).ruleConflict).toBe(false);
  });
});

describe("findOrphanPayees", () => {
  const candidates = [payee("p1"), payee("p2"), payee("p3")];

  it("finds payees with no transactions and no rules", () => {
    const orphans = findOrphanPayees({
      candidates,
      stagedRules: {},
      transactionCounts: new Map([["p1", 5]]),
    });
    expect(orphans.map((o) => o.payee.id)).toEqual(["p2", "p3"]);
  });

  it("excludes a payee referenced by a rule condition", () => {
    const orphans = findOrphanPayees({
      candidates,
      stagedRules: staged([rule("r1", "p2", "condition")]),
      transactionCounts: new Map(),
    });
    expect(orphans.map((o) => o.payee.id)).not.toContain("p2");
  });

  it("excludes a payee that only a rule ACTION targets", () => {
    // Actual's native query checks conditions only. Bench also checks actions,
    // because deleting a payee a rule writes to would break that rule — the
    // deliberate divergence documented in the module.
    const orphans = findOrphanPayees({
      candidates,
      stagedRules: staged([rule("r1", "p3", "action")]),
      transactionCounts: new Map(),
    });
    expect(orphans.map((o) => o.payee.id)).not.toContain("p3");
  });

  it("excludes transfer and tombstoned payees", () => {
    const orphans = findOrphanPayees({
      candidates: [
        payee("x", { transferAccountId: "acct-1" }),
        payee("y", { tombstone: true }),
      ],
      stagedRules: {},
      transactionCounts: new Map(),
    });
    expect(orphans).toEqual([]);
  });

  it("returns nothing while transaction counts are unknown", () => {
    // Fail closed: without counts, every payee would look unused and the list
    // would offer to delete the entire budget's payees.
    expect(
      findOrphanPayees({ candidates, stagedRules: {}, transactionCounts: undefined })
    ).toEqual([]);
  });

  it("sorts by name so the list is stable", () => {
    const orphans = findOrphanPayees({
      candidates,
      stagedRules: {},
      transactionCounts: new Map(),
    });
    expect(orphans.map((o) => o.payee.name)).toEqual(["P1", "P2", "P3"]);
  });
});

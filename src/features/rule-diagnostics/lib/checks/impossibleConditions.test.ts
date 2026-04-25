import type { Rule } from "@/types/entities";
import type { CheckContext, WorkingSet } from "../../types";
import { impossibleConditions } from "./impossibleConditions";

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

const ctx: CheckContext = {
  partSignatures: new Map(),
  ruleSignatures: new Map(),
  rulesByPartition: new Map(),
  scheduleLinkedRuleIds: new Set(),
  fullDuplicateRuleIds: new Set(),
};

describe("impossibleConditions", () => {
  it("flags two `amount is X` with different X on an `and` rule", () => {
    const r = rule({
      id: "r1",
      conditions: [
        { field: "amount", op: "is", value: 10 },
        { field: "amount", op: "is", value: 20 },
      ],
    });
    const findings = impossibleConditions(ws([r]), ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_IMPOSSIBLE_CONDITIONS");
  });

  it("flags `amount gt 10` + `amount lt 5`", () => {
    const r = rule({
      id: "r1",
      conditions: [
        { field: "amount", op: "gt", value: 10 },
        { field: "amount", op: "lt", value: 5 },
      ],
    });
    expect(impossibleConditions(ws([r]), ctx)).toHaveLength(1);
  });

  it("flags `gt 5` + `gt 100` + `lt 50` (effective lower bound is the max)", () => {
    // Effective: x > 100 AND x < 50 → empty. The earlier code returned the
    // first matching gt (gt 5) and missed the contradiction.
    const r = rule({
      id: "r1",
      conditions: [
        { field: "amount", op: "gt", value: 5 },
        { field: "amount", op: "gt", value: 100 },
        { field: "amount", op: "lt", value: 50 },
      ],
    });
    expect(impossibleConditions(ws([r]), ctx)).toHaveLength(1);
  });

  it("flags `gt 5` + `gte 5` + `lte 5` (tighter `gt` wins the tie-break)", () => {
    // Effective: x > 5 AND x ≤ 5 → empty. The picked-first code would have
    // chosen `gte 5` and `lte 5`, leaving the singleton {5} and missing the
    // contradiction introduced by the additional `gt 5`.
    const r = rule({
      id: "r1",
      conditions: [
        { field: "amount", op: "gt", value: 5 },
        { field: "amount", op: "gte", value: 5 },
        { field: "amount", op: "lte", value: 5 },
      ],
    });
    expect(impossibleConditions(ws([r]), ctx)).toHaveLength(1);
  });

  it("flags `is \"X\"` + `isNot \"X\"`", () => {
    const r = rule({
      id: "r1",
      conditions: [
        { field: "imported_payee", op: "is", value: "X" },
        { field: "imported_payee", op: "isNot", value: "X" },
      ],
    });
    expect(impossibleConditions(ws([r]), ctx)).toHaveLength(1);
  });

  it("flags `onBudget` + `offBudget` on the account field", () => {
    const r = rule({
      id: "r1",
      conditions: [
        { field: "account", op: "onBudget", value: null },
        { field: "account", op: "offBudget", value: null },
      ],
    });
    expect(impossibleConditions(ws([r]), ctx)).toHaveLength(1);
  });

  it("does NOT flag `or`-combined rules with same patterns", () => {
    const r = rule({
      id: "r1",
      conditionsOp: "or",
      conditions: [
        { field: "amount", op: "is", value: 10 },
        { field: "amount", op: "is", value: 20 },
      ],
    });
    expect(impossibleConditions(ws([r]), ctx)).toHaveLength(0);
  });

  it("does NOT flag a rule with only one condition", () => {
    const r = rule({
      id: "r1",
      conditions: [{ field: "amount", op: "is", value: 10 }],
    });
    expect(impossibleConditions(ws([r]), ctx)).toHaveLength(0);
  });

  it("flags `is N` with `isbetween` that excludes N", () => {
    const r = rule({
      id: "r1",
      conditions: [
        { field: "amount", op: "is", value: 5 },
        { field: "amount", op: "isbetween", value: { num1: 10, num2: 20 } },
      ],
    });
    expect(impossibleConditions(ws([r]), ctx)).toHaveLength(1);
  });

  it("does not flag schedule-linked rules", () => {
    const r = rule({
      id: "r-sched",
      conditions: [
        { field: "amount", op: "is", value: 10 },
        { field: "amount", op: "is", value: 20 },
      ],
      actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
    });
    const c = { ...ctx, scheduleLinkedRuleIds: new Set(["r-sched"]) };
    expect(impossibleConditions(ws([r]), c)).toHaveLength(0);
  });
});

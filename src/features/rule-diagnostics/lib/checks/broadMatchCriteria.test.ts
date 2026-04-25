import type { Rule } from "@/types/entities";
import type { CheckContext, WorkingSet } from "../../types";
import { BROAD_MATCH_MIN_LENGTH, broadMatchCriteria } from "./broadMatchCriteria";

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

describe("broadMatchCriteria", () => {
  it("BROAD_MATCH_MIN_LENGTH is 3", () => {
    expect(BROAD_MATCH_MIN_LENGTH).toBe(3);
  });

  it("flags `contains \"a\"` (single-character)", () => {
    const r = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "a" }],
    });
    const findings = broadMatchCriteria(ws([r]), ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_BROAD_MATCH");
  });

  it("does NOT flag `contains \"Netflix\"` (well above threshold)", () => {
    const r = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Netflix" }],
    });
    expect(broadMatchCriteria(ws([r]), ctx)).toHaveLength(0);
  });

  it("flags a short regex `matches \".\"`", () => {
    const r = rule({
      id: "r1",
      conditions: [{ field: "notes", op: "matches", value: "." }],
    });
    expect(broadMatchCriteria(ws([r]), ctx)).toHaveLength(1);
  });

  it("flags whitespace-only contains values (treated as empty after trim)", () => {
    const r = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "   " }],
    });
    expect(broadMatchCriteria(ws([r]), ctx)).toHaveLength(1);
  });

  it("flags empty doesNotContain value", () => {
    const r = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "doesNotContain", value: "" }],
    });
    expect(broadMatchCriteria(ws([r]), ctx)).toHaveLength(1);
  });

  it("does not flag schedule-linked rules", () => {
    const r = rule({
      id: "r-sched",
      conditions: [{ field: "imported_payee", op: "contains", value: "a" }],
      actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
    });
    const c = { ...ctx, scheduleLinkedRuleIds: new Set(["r-sched"]) };
    expect(broadMatchCriteria(ws([r]), c)).toHaveLength(0);
  });
});

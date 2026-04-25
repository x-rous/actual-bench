import type { Rule } from "@/types/entities";
import type { CheckContext, WorkingSet } from "../../types";
import { shadowedRules } from "./shadowedRules";

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

const emptyCtx: CheckContext = {
  partSignatures: new Map(),
  ruleSignatures: new Map(),
  rulesByPartition: new Map(),
  scheduleLinkedRuleIds: new Set(),
  fullDuplicateRuleIds: new Set(),
};

describe("shadowedRules check", () => {
  it("emits one finding per shadowed rule with the correct counterpart", () => {
    const earlier = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "payee", op: "set", value: "p-amazon" }],
    });
    const later = rule({
      id: "r2",
      conditions: [
        { field: "imported_payee", op: "contains", value: "Amazon" },
        { field: "amount", op: "gt", value: 100 },
      ],
      actions: [{ field: "payee", op: "set", value: "p-amazon-big" }],
    });
    const findings = shadowedRules(ws([earlier, later]), emptyCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_SHADOWED");
    expect(findings[0].affected[0].id).toBe("r2");
    expect(findings[0].counterpart?.id).toBe("r1");
  });

  it("does not cross stage boundaries", () => {
    const earlier = rule({
      id: "r1",
      stage: "pre",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "payee", op: "set", value: "p-amazon" }],
    });
    const later = rule({
      id: "r2",
      stage: "post",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "payee", op: "set", value: "p-other" }],
    });
    const findings = shadowedRules(ws([earlier, later]), emptyCtx);
    expect(findings).toHaveLength(0);
  });
});

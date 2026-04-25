import type { Rule } from "@/types/entities";
import type { CheckContext, WorkingSet } from "../../types";
import { unsupportedFieldOperator } from "./unsupportedFieldOperator";

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

describe("unsupportedFieldOperator", () => {
  it("flags amount with a string op (`contains`) as unsupported condition op", () => {
    const r = rule({
      id: "r1",
      conditions: [{ field: "amount", op: "contains", value: "100" }],
    });
    const findings = unsupportedFieldOperator(ws([r]), ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_UNSUPPORTED_CONDITION_OP");
  });

  it("flags an unrecognized condition field", () => {
    const r = rule({
      id: "r1",
      conditions: [{ field: "made_up_field", op: "is", value: "x" }],
    });
    const findings = unsupportedFieldOperator(ws([r]), ctx);
    expect(findings.some((f) => f.code === "RULE_UNSUPPORTED_CONDITION_FIELD")).toBe(true);
  });

  it("flags a `set` action with a missing field as unsupported action field", () => {
    const r = rule({
      id: "r1",
      actions: [{ op: "set", value: "x" }],
    });
    const findings = unsupportedFieldOperator(ws([r]), ctx);
    expect(findings.some((f) => f.code === "RULE_UNSUPPORTED_ACTION_FIELD")).toBe(true);
  });

  it("flags template mode on a non-template field (category)", () => {
    const r = rule({
      id: "r1",
      actions: [
        { field: "category", op: "set", value: "c-1", options: { template: "{{x}}" } },
      ],
    });
    const findings = unsupportedFieldOperator(ws([r]), ctx);
    expect(findings.some((f) => f.code === "RULE_TEMPLATE_ON_UNSUPPORTED_FIELD")).toBe(true);
  });

  it("does NOT flag a `link-schedule` action (excluded)", () => {
    const r = rule({
      id: "r1",
      actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
    });
    const findings = unsupportedFieldOperator(ws([r]), ctx);
    // The default action also has `category set` which is valid.
    expect(findings).toHaveLength(0);
  });

  it("does not flag schedule-linked rules", () => {
    const r = rule({
      id: "r-sched",
      conditions: [{ field: "amount", op: "contains", value: "x" }],
      actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
    });
    const c = { ...ctx, scheduleLinkedRuleIds: new Set(["r-sched"]) };
    expect(unsupportedFieldOperator(ws([r]), c)).toHaveLength(0);
  });

  it("does NOT flag a valid template on a supported field (notes)", () => {
    const r = rule({
      id: "r1",
      actions: [
        { field: "notes", op: "set", value: "", options: { template: "{{x}}" } },
      ],
    });
    expect(unsupportedFieldOperator(ws([r]), ctx)).toHaveLength(0);
  });
});

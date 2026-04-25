import type { Rule } from "@/types/entities";
import type { CheckContext, WorkingSet } from "../../types";
import { emptyOrNoopActions } from "./emptyOrNoopActions";

function makeRule(partial: Partial<Rule>): Rule {
  return {
    id: partial.id ?? "r1",
    stage: partial.stage ?? "default",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [],
    actions: partial.actions ?? [],
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

function ctx(scheduleLinkedRuleIds: string[] = []): CheckContext {
  return {
    partSignatures: new Map(),
    ruleSignatures: new Map(),
    rulesByPartition: new Map(),
    scheduleLinkedRuleIds: new Set(scheduleLinkedRuleIds),
    fullDuplicateRuleIds: new Set(),
  };
}

describe("emptyOrNoopActions", () => {
  it("flags a rule with an empty actions array", () => {
    const rule = makeRule({ id: "r-empty", actions: [] });
    const findings = emptyOrNoopActions(ws([rule]), ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_EMPTY_ACTIONS");
    expect(findings[0].affected[0].id).toBe("r-empty");
  });

  it("does NOT flag a rule whose only action is link-schedule (schedule-linked exclusion)", () => {
    const rule = makeRule({
      id: "r-sched",
      actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
    });
    const findings = emptyOrNoopActions(ws([rule]), ctx(["r-sched"]));
    expect(findings).toHaveLength(0);
  });

  it("does NOT flag a rule with valid non-empty actions", () => {
    const rule = makeRule({
      id: "r-ok",
      actions: [{ field: "category", op: "set", value: "c-1" }],
    });
    const findings = emptyOrNoopActions(ws([rule]), ctx());
    expect(findings).toHaveLength(0);
  });

  it("flags a rule whose every action is a no-op set with missing field", () => {
    const rule = makeRule({
      id: "r-noop-set",
      actions: [{ op: "set", value: "" }],
    });
    const findings = emptyOrNoopActions(ws([rule]), ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_NOOP_ACTIONS");
  });

  it("flags a rule whose every action is a notes append/prepend with empty value", () => {
    const rule = makeRule({
      id: "r-noop-notes",
      actions: [
        { op: "prepend-notes", value: "  " },
        { op: "append-notes", value: "" },
      ],
    });
    const findings = emptyOrNoopActions(ws([rule]), ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_NOOP_ACTIONS");
  });

  it("does NOT flag when only some actions are no-ops", () => {
    const rule = makeRule({
      id: "r-mixed",
      actions: [
        { op: "set", value: "" },
        { field: "category", op: "set", value: "c-1" },
      ],
    });
    const findings = emptyOrNoopActions(ws([rule]), ctx());
    expect(findings).toHaveLength(0);
  });
});

import type { Rule } from "@/types/entities";
import type { CheckContext, WorkingSet } from "../../types";
import { ruleSignature } from "../ruleSignature";
import { duplicateRules } from "./duplicateRules";

function rule(partial: Partial<Rule> & { id: string }): Rule {
  return {
    id: partial.id,
    stage: partial.stage ?? "default",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [],
    actions: partial.actions ?? [{ field: "category", op: "set", value: "c-1" }],
  };
}

function makeCtx(rules: Rule[], scheduleLinked: string[] = []): CheckContext {
  const ruleSignatures = new Map<string, string>();
  for (const r of rules) ruleSignatures.set(r.id, ruleSignature(r));
  return {
    partSignatures: new Map(),
    ruleSignatures,
    rulesByPartition: new Map(),
    scheduleLinkedRuleIds: new Set(scheduleLinked),
    fullDuplicateRuleIds: new Set(),
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

describe("duplicateRules", () => {
  it("flags two identical rules as one group with both members", () => {
    const a = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Netflix" }],
      actions: [{ field: "payee", op: "set", value: "p-netflix" }],
    });
    const b = { ...a, id: "r2" };
    const findings = duplicateRules(ws([a, b]), makeCtx([a, b]));
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_DUPLICATE_GROUP");
    expect(findings[0].affected.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("emits one group finding with three members for three identical rules", () => {
    const base = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Netflix" }],
    });
    const rules = [base, { ...base, id: "r2" }, { ...base, id: "r3" }];
    const findings = duplicateRules(ws(rules), makeCtx(rules));
    expect(findings).toHaveLength(1);
    expect(findings[0].affected).toHaveLength(3);
  });

  it("does NOT group rules with different conditionsOp", () => {
    const a = rule({
      id: "r1",
      conditionsOp: "and",
      conditions: [{ field: "imported_payee", op: "contains", value: "Netflix" }],
    });
    const b = rule({
      id: "r2",
      conditionsOp: "or",
      conditions: [{ field: "imported_payee", op: "contains", value: "Netflix" }],
    });
    const findings = duplicateRules(ws([a, b]), makeCtx([a, b]));
    expect(findings).toHaveLength(0);
  });

  it("groups rules whose oneOf values differ only in order", () => {
    const a = rule({
      id: "r1",
      conditions: [{ field: "payee", op: "oneOf", value: ["a", "b", "c"] }],
    });
    const b = rule({
      id: "r2",
      conditions: [{ field: "payee", op: "oneOf", value: ["c", "a", "b"] }],
    });
    const findings = duplicateRules(ws([a, b]), makeCtx([a, b]));
    expect(findings).toHaveLength(1);
  });

  it("excludes schedule-linked rules from duplicate detection", () => {
    const a = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Netflix" }],
    });
    const b = { ...a, id: "r-sched" };
    const findings = duplicateRules(ws([a, b]), makeCtx([a, b], ["r-sched"]));
    expect(findings).toHaveLength(0);
  });
});

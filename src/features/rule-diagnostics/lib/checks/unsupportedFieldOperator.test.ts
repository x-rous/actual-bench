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

// ─── Parity with the engine (F-115) ───────────────────────────────────────────
//
// The check used to validate against Bench's own tables, so it flagged rules Actual accepts and
// stayed quiet about the ones it rejects. These cases pin down both directions.

describe("unsupportedFieldOperator — parity with Actual's engine", () => {
  it("stays quiet on every operator Actual accepts", () => {
    const valid = [
      { field: "date", op: "gt", value: "2026-01-01" },
      { field: "date", op: "gte", value: "2026-01-01" },
      { field: "date", op: "lt", value: "2026-01-01" },
      { field: "date", op: "lte", value: "2026-01-01" },
      { field: "notes", op: "hasTags", value: "#food" },
      { field: "notes", op: "hasAnyTag", value: "#food #travel" },
      { field: "payee", op: "contains", value: "abc" },
      { field: "payee", op: "matches", value: "^abc" },
      { field: "category", op: "doesNotContain", value: "abc" },
      { field: "account", op: "onBudget", value: "" },
      { field: "cleared", op: "is", value: true },
    ];
    for (const condition of valid) {
      const findings = unsupportedFieldOperator(ws([rule({ id: "r1", conditions: [condition] })]), ctx);
      expect({ condition, findings }).toEqual({ condition, findings: [] });
    }
  });

  it("flags the three date operators Bench used to produce", () => {
    for (const op of ["isNot", "isAfter", "isBefore"]) {
      const findings = unsupportedFieldOperator(
        ws([rule({ id: "r1", conditions: [{ field: "date", op, value: "2026-01-01" }] })]),
        ctx
      );
      expect(findings.map((f) => f.code)).toEqual(["RULE_UNSUPPORTED_CONDITION_OP"]);
    }
  });

  it("flags oneOf on notes, which Actual disallows for that field", () => {
    const findings = unsupportedFieldOperator(
      ws([rule({ id: "r1", conditions: [{ field: "notes", op: "oneOf", value: ["a", "b"] }] })]),
      ctx
    );
    expect(findings.map((f) => f.code)).toEqual(["RULE_UNSUPPORTED_CONDITION_OP"]);
  });

  it("flags budget operators on a field that is not account", () => {
    const findings = unsupportedFieldOperator(
      ws([rule({ id: "r1", conditions: [{ field: "payee", op: "onBudget", value: "" }] })]),
      ctx
    );
    expect(findings.map((f) => f.code)).toEqual(["RULE_UNSUPPORTED_CONDITION_OP"]);
  });

  it("accepts an amount condition carrying inflow/outflow options", () => {
    const findings = unsupportedFieldOperator(
      ws([
        rule({
          id: "r1",
          conditions: [{ field: "amount", op: "gt", value: 10, options: { inflow: true } }],
        }),
      ]),
      ctx
    );
    expect(findings).toEqual([]);
  });

  it("accepts the internal `and` operator Actual writes on category conditions", () => {
    const findings = unsupportedFieldOperator(
      ws([rule({ id: "r1", conditions: [{ field: "category", op: "and", value: ["c1", "c2"] }] })]),
      ctx
    );
    expect(findings).toEqual([]);
  });
});

describe("unsupportedFieldOperator — split rules", () => {
  const splitRule = () =>
    rule({
      id: "r1",
      conditions: [{ field: "payee", op: "is", value: "p1" }],
      actions: [
        { field: "payee", op: "set", value: "p1" },
        {
          op: "set-split-amount",
          value: 25,
          options: { method: "fixed-percent" as const, splitIndex: 1 },
        },
        { field: "category", op: "set", value: "c1", options: { splitIndex: 1 } },
      ],
    });

  it("raises nothing for a valid split rule", () => {
    expect(unsupportedFieldOperator(ws([splitRule()]), ctx)).toEqual([]);
  });

  it("flags a parent-only field set inside a split", () => {
    const r = rule({
      id: "r1",
      actions: [
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 1 } },
        { field: "amount", op: "set", value: 10, options: { splitIndex: 1 } },
      ],
    });
    const findings = unsupportedFieldOperator(ws([r]), ctx);
    expect(findings.map((f) => f.code)).toEqual(["RULE_UNSUPPORTED_ACTION_FIELD"]);
  });

  it("leaves the same field alone on the parent", () => {
    const r = rule({ id: "r1", actions: [{ field: "amount", op: "set", value: 10 }] });
    expect(unsupportedFieldOperator(ws([r]), ctx)).toEqual([]);
  });
});

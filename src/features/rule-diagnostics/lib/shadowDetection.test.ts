import type { Rule } from "@/types/entities";
import { findShadowedPairs } from "./shadowDetection";

function rule(partial: Partial<Rule> & { id: string }): Rule {
  return {
    id: partial.id,
    stage: partial.stage ?? "default",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [],
    actions: partial.actions ?? [{ field: "category", op: "set", value: "c-1" }],
  };
}

describe("findShadowedPairs", () => {
  it("flags a strictly shadowed pair in the same stage", () => {
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
    const pairs = findShadowedPairs([earlier, later]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].shadowed.id).toBe("r2");
    expect(pairs[0].shadowing.id).toBe("r1");
  });

  it("does NOT flag when later writes a different field than earlier", () => {
    const earlier = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "payee", op: "set", value: "p-amazon" }],
    });
    const later = rule({
      id: "r2",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "category", op: "set", value: "c-shopping" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(0);
  });

  it("does NOT flag when conditionsOp differs", () => {
    const earlier = rule({
      id: "r1",
      conditionsOp: "or",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
    });
    const later = rule({
      id: "r2",
      conditionsOp: "and",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(0);
  });

  it("does NOT flag or-combined rules at all in v1", () => {
    const earlier = rule({
      id: "r1",
      conditionsOp: "or",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
    });
    const later = rule({
      id: "r2",
      conditionsOp: "or",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(0);
  });

  it("an unconditional delete-transaction shadows every later rule", () => {
    const earlier = rule({
      id: "r1",
      conditions: [],
      actions: [{ op: "delete-transaction", value: null }],
    });
    const later = rule({
      id: "r2",
      conditions: [{ field: "imported_payee", op: "contains", value: "X" }],
      actions: [{ field: "category", op: "set", value: "c-x" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(1);
  });

  it("excludes schedule-linked rules from both sides", () => {
    const earlier = rule({
      id: "r-sched",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
    });
    const later = rule({
      id: "r2",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "payee", op: "set", value: "p-x" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(0);
  });

  it("recognises oneOf containing the later is value as a covering match", () => {
    const earlier = rule({
      id: "r1",
      conditions: [{ field: "payee", op: "oneOf", value: ["a", "b", "c"] }],
      actions: [{ field: "category", op: "set", value: "c-1" }],
    });
    const later = rule({
      id: "r2",
      conditions: [{ field: "payee", op: "is", value: "b" }],
      actions: [{ field: "category", op: "set", value: "c-2" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(1);
  });
});

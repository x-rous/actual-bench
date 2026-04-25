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
      actions: [{ field: "payee", op: "set", value: "p-amazon" }],
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

  it("does NOT flag doesNotContain when earlier's value is a substring of later's", () => {
    // A = doesNotContain "foo" matches strings without "foo".
    // B = doesNotContain "foobar" matches strings without "foobar" (a SUPERSET — e.g. "foo bar" matches B but not A).
    // So A does not cover B and B must not be flagged as shadowed.
    const earlier = rule({
      id: "r1",
      conditions: [{ field: "notes", op: "doesNotContain", value: "foo" }],
      actions: [{ field: "category", op: "set", value: "c-1" }],
    });
    const later = rule({
      id: "r2",
      conditions: [{ field: "notes", op: "doesNotContain", value: "foobar" }],
      actions: [{ field: "category", op: "set", value: "c-2" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(0);
  });

  it("flags doesNotContain when later's value is a substring of earlier's", () => {
    // A = doesNotContain "foobar" matches strings without "foobar".
    // B = doesNotContain "foo"    matches strings without "foo" (a SUBSET of A's matches).
    // Every string matching B also matches A → A covers B → B is shadowed.
    const earlier = rule({
      id: "r1",
      conditions: [{ field: "notes", op: "doesNotContain", value: "foobar" }],
      actions: [{ field: "category", op: "set", value: "c-1" }],
    });
    const later = rule({
      id: "r2",
      conditions: [{ field: "notes", op: "doesNotContain", value: "foo" }],
      actions: [{ field: "category", op: "set", value: "c-1" }],
    });
    const pairs = findShadowedPairs([earlier, later]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].shadowed.id).toBe("r2");
    expect(pairs[0].shadowing.id).toBe("r1");
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
      actions: [{ field: "category", op: "set", value: "c-1" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(1);
  });

  it("does NOT flag when later uses a different op on the same field (set vs prepend-notes)", () => {
    // Earlier `set notes="X"` and later `prepend-notes "Y"` are distinct
    // operations: the later one still has an effect (prepending Y), so it
    // is not redundant.
    const earlier = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "notes", op: "set", value: "X" }],
    });
    const later = rule({
      id: "r2",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "notes", op: "prepend-notes", value: "Y" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(0);
  });

  it("does NOT flag when later sets a different value than earlier on the same field", () => {
    // Earlier `set category="A"` and later `set category="B"` write different
    // values; the later rule overrides the earlier and is therefore not
    // redundant — it must not be flagged as shadowed.
    const earlier = rule({
      id: "r1",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "category", op: "set", value: "A" }],
    });
    const later = rule({
      id: "r2",
      conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }],
      actions: [{ field: "category", op: "set", value: "B" }],
    });
    expect(findShadowedPairs([earlier, later])).toHaveLength(0);
  });
});

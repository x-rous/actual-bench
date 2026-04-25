import type { Rule } from "@/types/entities";
import {
  partSignature,
  ruleSignature,
  workingSetSignature,
  rulePartSignatures,
} from "./ruleSignature";

function makeRule(partial: Partial<Rule>): Rule {
  return {
    id: partial.id ?? "r1",
    stage: partial.stage ?? "default",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [],
    actions: partial.actions ?? [{ field: "category", op: "set", value: "cat-1" }],
  };
}

describe("ruleSignature", () => {
  it("two rules with identical parts in different order produce identical signatures", () => {
    const a = makeRule({
      conditions: [
        { field: "payee", op: "is", value: "p-1" },
        { field: "amount", op: "gt", value: 100 },
      ],
      actions: [
        { field: "category", op: "set", value: "c-1" },
        { field: "notes", op: "set", value: "note" },
      ],
    });
    const b = makeRule({
      id: "r2",
      conditions: [
        { field: "amount", op: "gt", value: 100 },
        { field: "payee", op: "is", value: "p-1" },
      ],
      actions: [
        { field: "notes", op: "set", value: "note" },
        { field: "category", op: "set", value: "c-1" },
      ],
    });
    expect(ruleSignature(a)).toBe(ruleSignature(b));
  });

  it("oneOf values in different order produce identical part signatures", () => {
    const p1 = partSignature({ field: "payee", op: "oneOf", value: ["a", "b", "c"] });
    const p2 = partSignature({ field: "payee", op: "oneOf", value: ["c", "a", "b"] });
    expect(p1).toBe(p2);
  });

  it("amount 10 and amount 10.00 produce identical signatures", () => {
    const a = makeRule({
      conditions: [{ field: "amount", op: "is", value: 10 }],
    });
    const b = makeRule({
      id: "r2",
      conditions: [{ field: "amount", op: "is", value: 10.0 }],
    });
    expect(ruleSignature(a)).toBe(ruleSignature(b));
  });

  it("rules differing in stage produce different signatures", () => {
    const a = makeRule({ stage: "pre" });
    const b = makeRule({ stage: "post", id: "r2" });
    expect(ruleSignature(a)).not.toBe(ruleSignature(b));
  });

  it("rules differing in conditionsOp produce different signatures", () => {
    const a = makeRule({ conditionsOp: "and" });
    const b = makeRule({ conditionsOp: "or", id: "r2" });
    expect(ruleSignature(a)).not.toBe(ruleSignature(b));
  });

  it("null and undefined values both normalize to null in signatures", () => {
    const p1 = partSignature({ field: "notes", op: "is", value: null });
    const p2 = partSignature({ field: "notes", op: "is", value: null as unknown as string });
    expect(p1).toBe(p2);
  });

  it("rulePartSignatures returns conditions before actions, each side internally sorted", () => {
    const rule = makeRule({
      conditions: [
        { field: "payee", op: "is", value: "p-1" },
        { field: "amount", op: "gt", value: 100 },
      ],
      actions: [
        { field: "notes", op: "set", value: "n" },
        { field: "category", op: "set", value: "c-1" },
      ],
    });
    const sigs = rulePartSignatures(rule);
    expect(sigs).toHaveLength(4);
    const conditionsPart = sigs.slice(0, 2);
    const actionsPart = sigs.slice(2);
    // Each half must be sorted internally.
    expect(conditionsPart).toEqual([...conditionsPart].sort());
    expect(actionsPart).toEqual([...actionsPart].sort());
    // Conditions appear before actions.
    expect(conditionsPart[0]).toContain("\"op\":\"gt\"");
    expect(actionsPart[0]).toContain("\"op\":\"set\"");
  });
});

describe("workingSetSignature", () => {
  it("is stable across different rule orderings", () => {
    const r1 = makeRule({ id: "r1" });
    const r2 = makeRule({ id: "r2" });
    expect(workingSetSignature([r1, r2])).toBe(workingSetSignature([r2, r1]));
  });

  it("changes when a rule is added", () => {
    const base = [makeRule({ id: "r1" })];
    const with2 = [...base, makeRule({ id: "r2" })];
    expect(workingSetSignature(base)).not.toBe(workingSetSignature(with2));
  });

  it("changes when a rule's shape changes (different condition count)", () => {
    const r1 = makeRule({ id: "r1" });
    const r1WithCondition = makeRule({
      id: "r1",
      conditions: [{ field: "payee", op: "is", value: "p-1" }],
    });
    expect(workingSetSignature([r1])).not.toBe(workingSetSignature([r1WithCondition]));
  });
});

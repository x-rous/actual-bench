import { buildRuleReferenceMap } from "./referenceCheck";
import type { StagedMap } from "@/types/staged";
import type { Rule } from "@/types/entities";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(id: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    stage: "default",
    conditionsOp: "and",
    conditions: [],
    actions: [],
    ...overrides,
  };
}

function staged(rules: Rule[]): StagedMap<Rule> {
  const map: StagedMap<Rule> = {};
  for (const r of rules) {
    map[r.id] = {
      entity: r,
      original: r,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    };
  }
  return map;
}

function stagedDeleted(rule: Rule): StagedMap<Rule> {
  return {
    [rule.id]: {
      entity: rule,
      original: rule,
      isNew: false,
      isUpdated: false,
      isDeleted: true,
      validationErrors: {},
    },
  };
}

// ─── buildRuleReferenceMap ────────────────────────────────────────────────────

describe("buildRuleReferenceMap", () => {
  it("returns empty map when there are no rules", () => {
    const result = buildRuleReferenceMap({}, ["payee"]);
    expect(result.size).toBe(0);
  });

  it("counts a condition that references an entity", () => {
    const rules = staged([
      makeRule("r1", {
        conditions: [{ field: "payee", op: "is", value: "p1", type: "id" }],
      }),
    ]);
    const result = buildRuleReferenceMap(rules, ["payee"]);
    expect(result.get("p1")).toBe(1);
  });

  it("counts an action that references an entity", () => {
    const rules = staged([
      makeRule("r1", {
        actions: [{ field: "category", op: "set", value: "cat1", type: "id" }],
      }),
    ]);
    const result = buildRuleReferenceMap(rules, ["category"]);
    expect(result.get("cat1")).toBe(1);
  });

  it("accumulates counts when multiple rules reference the same entity", () => {
    const rules = staged([
      makeRule("r1", { conditions: [{ field: "payee", op: "is", value: "p1", type: "id" }] }),
      makeRule("r2", { conditions: [{ field: "payee", op: "is", value: "p1", type: "id" }] }),
      makeRule("r3", { conditions: [{ field: "payee", op: "is", value: "p1", type: "id" }] }),
    ]);
    const result = buildRuleReferenceMap(rules, ["payee"]);
    expect(result.get("p1")).toBe(3);
  });

  it("counts each ID independently when entities differ", () => {
    const rules = staged([
      makeRule("r1", { conditions: [{ field: "payee", op: "is", value: "p1", type: "id" }] }),
      makeRule("r2", { conditions: [{ field: "payee", op: "is", value: "p2", type: "id" }] }),
    ]);
    const result = buildRuleReferenceMap(rules, ["payee"]);
    expect(result.get("p1")).toBe(1);
    expect(result.get("p2")).toBe(1);
  });

  it("handles array values — each element in the array counts as one reference", () => {
    const rules = staged([
      makeRule("r1", {
        conditions: [{ field: "payee", op: "oneof", value: ["p1", "p2", "p3"], type: "id" }],
      }),
    ]);
    const result = buildRuleReferenceMap(rules, ["payee"]);
    expect(result.get("p1")).toBe(1);
    expect(result.get("p2")).toBe(1);
    expect(result.get("p3")).toBe(1);
  });

  it("skips deleted rules", () => {
    const rule = makeRule("r1", {
      conditions: [{ field: "payee", op: "is", value: "p1", type: "id" }],
    });
    const result = buildRuleReferenceMap(stagedDeleted(rule), ["payee"]);
    expect(result.size).toBe(0);
  });

  it("does not count fields outside the provided set", () => {
    const rules = staged([
      makeRule("r1", {
        conditions: [
          { field: "payee", op: "is", value: "p1", type: "id" },
          { field: "category", op: "is", value: "cat1", type: "id" },
        ],
      }),
    ]);
    const payeeResult = buildRuleReferenceMap(rules, ["payee"]);
    expect(payeeResult.get("p1")).toBe(1);
    expect(payeeResult.get("cat1")).toBeUndefined();
  });

  it("matches multiple field names — payee and imported_payee both count", () => {
    const rules = staged([
      makeRule("r1", {
        conditions: [
          { field: "payee", op: "is", value: "p1", type: "id" },
          { field: "imported_payee", op: "is", value: "p1", type: "id" },
        ],
      }),
    ]);
    const result = buildRuleReferenceMap(rules, ["payee", "imported_payee"]);
    expect(result.get("p1")).toBe(2);
  });

  it("ignores parts that have no field property", () => {
    const rules = staged([
      makeRule("r1", {
        // delete-transaction action has no field — cast via unknown to satisfy ConditionOrAction
        actions: [{ op: "delete-transaction", value: true, type: "boolean" } as unknown as import("@/types/entities").ConditionOrAction],
      }),
    ]);
    const result = buildRuleReferenceMap(rules, ["payee"]);
    expect(result.size).toBe(0);
  });

  it("ignores non-string values (numbers, booleans)", () => {
    const rules = staged([
      makeRule("r1", {
        conditions: [{ field: "payee", op: "is", value: 42, type: "number" }],
      }),
    ]);
    const result = buildRuleReferenceMap(rules, ["payee"]);
    expect(result.size).toBe(0);
  });

  it("ignores empty-string values", () => {
    const rules = staged([
      makeRule("r1", {
        conditions: [{ field: "payee", op: "is", value: "", type: "id" }],
      }),
    ]);
    const result = buildRuleReferenceMap(rules, ["payee"]);
    expect(result.size).toBe(0);
  });

  it("counts both conditions and actions together for the same entity", () => {
    const rules = staged([
      makeRule("r1", {
        conditions: [{ field: "category", op: "is", value: "cat1", type: "id" }],
        actions:    [{ field: "category", op: "set", value: "cat1", type: "id" }],
      }),
    ]);
    const result = buildRuleReferenceMap(rules, ["category"]);
    expect(result.get("cat1")).toBe(2);
  });
});

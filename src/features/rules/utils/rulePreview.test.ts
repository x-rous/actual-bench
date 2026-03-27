import { rulePreview, valueToString } from "./rulePreview";
import type { Rule } from "@/types/entities";

const emptyMaps = { payees: {}, categories: {}, accounts: {} };

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    stage: "default",
    conditionsOp: "and",
    conditions: [],
    actions: [],
    ...overrides,
  };
}

// ─── valueToString ─────────────────────────────────────────────────────────────

describe("valueToString", () => {
  it("returns empty string for null/undefined", () => {
    expect(valueToString(null)).toBe("");
    expect(valueToString(undefined)).toBe("");
  });

  it("converts numbers to string", () => {
    expect(valueToString(42)).toBe("42");
  });

  it("joins arrays with comma-space", () => {
    expect(valueToString(["a", "b", "c"])).toBe("a, b, c");
  });

  it("formats AmountRange as 'num1 – num2'", () => {
    expect(valueToString({ num1: 10, num2: 50 })).toBe("10 – 50");
  });

  it("converts plain string as-is", () => {
    expect(valueToString("grocery")).toBe("grocery");
  });
});

// ─── rulePreview ──────────────────────────────────────────────────────────────

describe("rulePreview", () => {
  it("shows placeholder text for rules with no conditions and no actions", () => {
    const result = rulePreview(makeRule(), emptyMaps);
    expect(result).toBe("If (no conditions) → (no actions)");
  });

  it("formats a simple condition", () => {
    const rule = makeRule({
      conditions: [{ field: "notes", op: "contains", value: "grocery", type: "string" }],
    });
    const result = rulePreview(rule, emptyMaps);
    expect(result).toContain('Notes contains "grocery"');
  });

  it("formats a simple action", () => {
    const rule = makeRule({
      actions: [{ field: "cleared", op: "set", value: "true", type: "string" }],
    });
    const result = rulePreview(rule, emptyMaps);
    expect(result).toContain('set Cleared');
  });

  it("joins multiple conditions with the conditionsOp", () => {
    const rule = makeRule({
      conditionsOp: "or",
      conditions: [
        { field: "notes", op: "contains", value: "a", type: "string" },
        { field: "notes", op: "contains", value: "b", type: "string" },
      ],
    });
    const result = rulePreview(rule, emptyMaps);
    expect(result).toContain(" or ");
  });

  it("resolves payee ID to name", () => {
    const maps = {
      payees: {
        "payee-1": {
          entity: { id: "payee-1", name: "Amazon" },
          original: null, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {},
        },
      },
      categories: {},
      accounts: {},
    };
    const rule = makeRule({
      conditions: [{ field: "payee", op: "is", value: "payee-1", type: "id" }],
    });
    const result = rulePreview(rule, maps);
    expect(result).toContain("Amazon");
    expect(result).not.toContain("payee-1");
  });

  it("falls back to raw ID when entity not found", () => {
    const rule = makeRule({
      conditions: [{ field: "payee", op: "is", value: "unknown-id", type: "id" }],
    });
    const result = rulePreview(rule, emptyMaps);
    expect(result).toContain("unknown-id");
  });

  it("formats the full If…→ structure", () => {
    const rule = makeRule({
      conditionsOp: "and",
      conditions: [{ field: "notes", op: "contains", value: "food", type: "string" }],
      actions: [{ field: "cleared", op: "set", value: "true", type: "string" }],
    });
    const result = rulePreview(rule, emptyMaps);
    expect(result).toMatch(/^If .+ → .+/);
  });
});

import { ruleSchema } from "./rule.schema";

const baseRule = {
  id: "rule-1",
  stage: "default" as const,
  conditionsOp: "and" as const,
  conditions: [],
  actions: [],
};

describe("ruleSchema options mutual exclusivity", () => {
  it("accepts options with only template", () => {
    const result = ruleSchema.safeParse({
      ...baseRule,
      actions: [{ op: "set", field: "notes", value: "", type: "string", options: { template: "{{x}}" } }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts options with only formula", () => {
    const result = ruleSchema.safeParse({
      ...baseRule,
      actions: [{ op: "set", field: "notes", value: "", type: "string", options: { formula: "=IF(1,x,y)" } }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects options with both template and formula", () => {
    const result = ruleSchema.safeParse({
      ...baseRule,
      actions: [
        {
          op: "set",
          field: "notes",
          value: "",
          type: "string",
          options: { template: "{{x}}", formula: "=IF(1,x,y)" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("ruleSchema split and amount options", () => {
  it("round-trips a split rule without dropping splitIndex or method (F-118, F-119)", () => {
    const rule = {
      ...baseRule,
      actions: [
        { op: "set", field: "payee", value: "p1", type: "id" },
        {
          op: "set-split-amount",
          value: null,
          options: { method: "fixed-percent" as const, splitIndex: 1 },
        },
        {
          op: "set",
          field: "category",
          value: "c1",
          type: "id",
          options: { splitIndex: 1 },
        },
      ],
    };
    const result = ruleSchema.safeParse(rule);
    expect(result.success).toBe(true);
    expect(result.success && result.data.actions[1].options).toEqual({
      method: "fixed-percent",
      splitIndex: 1,
    });
    expect(result.success && result.data.actions[2].options).toEqual({ splitIndex: 1 });
  });

  it("rejects a negative or fractional splitIndex", () => {
    for (const splitIndex of [-1, 1.5]) {
      const result = ruleSchema.safeParse({
        ...baseRule,
        actions: [{ op: "set", field: "notes", value: "x", options: { splitIndex } }],
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects a method on anything but set-split-amount", () => {
    const result = ruleSchema.safeParse({
      ...baseRule,
      actions: [
        { op: "set", field: "notes", value: "x", options: { method: "remainder" as const } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a set-split-amount missing its method or index", () => {
    for (const options of [{ splitIndex: 1 }, { method: "remainder" as const }]) {
      const result = ruleSchema.safeParse({
        ...baseRule,
        actions: [{ op: "set-split-amount", value: null, options }],
      });
      expect(result.success).toBe(false);
    }
  });

  it("accepts inflow or outflow on an amount condition", () => {
    for (const options of [{ inflow: true }, { outflow: true }]) {
      const result = ruleSchema.safeParse({
        ...baseRule,
        conditions: [{ field: "amount", op: "gt", value: 10, type: "number", options }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects inflow and outflow together, and either on a non-amount field", () => {
    expect(
      ruleSchema.safeParse({
        ...baseRule,
        conditions: [
          { field: "amount", op: "gt", value: 10, options: { inflow: true, outflow: true } },
        ],
      }).success
    ).toBe(false);

    expect(
      ruleSchema.safeParse({
        ...baseRule,
        conditions: [{ field: "notes", op: "contains", value: "x", options: { inflow: true } }],
      }).success
    ).toBe(false);
  });
});

describe("ruleSchema direction flags", () => {
  it("rejects inflow/outflow on an action, even when its field is amount", () => {
    const result = ruleSchema.safeParse({
      ...baseRule,
      actions: [
        { op: "set", field: "amount", value: 10, type: "number", options: { inflow: true } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("still accepts them on an amount condition", () => {
    const result = ruleSchema.safeParse({
      ...baseRule,
      conditions: [
        { field: "amount", op: "gt", value: 10, type: "number", options: { outflow: true } },
      ],
      actions: [{ op: "set", field: "notes", value: "x", type: "string" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a remainder allocation that still carries a stale value", () => {
    // Actual's own editor sets `options.method` without clearing `value`, so switching a
    // fixed-amount split to remainder leaves the old figure behind. The engine ignores it.
    // Rejecting it here would refuse rules Actual itself writes.
    const result = ruleSchema.safeParse({
      ...baseRule,
      actions: [
        { op: "set-split-amount", value: 1250, options: { method: "remainder", splitIndex: 1 } },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("ruleSchema allocation placement", () => {
  it("rejects an allocation in the conditions array", () => {
    const result = ruleSchema.safeParse({
      ...baseRule,
      conditions: [
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 1 } },
      ],
      actions: [{ op: "set", field: "notes", value: "x", type: "string" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an allocation aimed at the parent transaction", () => {
    for (const splitIndex of [0, undefined]) {
      const result = ruleSchema.safeParse({
        ...baseRule,
        actions: [
          {
            op: "set-split-amount",
            value: null,
            options: { method: "remainder", ...(splitIndex === undefined ? {} : { splitIndex }) },
          },
        ],
      });
      expect(result.success).toBe(false);
    }
  });

  it("accepts an allocation aimed at a child", () => {
    const result = ruleSchema.safeParse({
      ...baseRule,
      actions: [
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 1 } },
        { op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 1 } },
      ],
    });
    expect(result.success).toBe(true);
  });
});

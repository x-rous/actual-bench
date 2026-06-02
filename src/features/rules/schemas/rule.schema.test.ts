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

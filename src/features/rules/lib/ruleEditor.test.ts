import {
  createEditorParts,
  serializeRule,
  serializeRuleDraft,
  validateRuleDraft,
  type RuleDraft,
} from "./ruleEditor";
import type { ConditionOrAction, Rule } from "@/types/entities";

function buildDraft(overrides?: Partial<RuleDraft>): RuleDraft {
  return {
    stage: "default",
    conditionsOp: "and",
    conditions: [],
    actions: [
      {
        clientId: "action-1",
        part: { field: "category", op: "set", value: "cat-1", type: "id" },
      },
    ],
    ...overrides,
  };
}

describe("validateRuleDraft", () => {
  it("accepts schedule-managed recurring date conditions", () => {
    const result = validateRuleDraft(
      buildDraft({
        conditions: [
          {
            clientId: "cond-1",
            part: {
              field: "date",
              op: "isapprox",
              type: "date",
              value: {
                frequency: "weekly",
                interval: 2,
                start: "2026-05-01",
                endMode: "on_date",
                endDate: "2027-05-01",
              },
            },
          },
        ],
      })
    );

    expect(result.conditionErrors).toEqual([[]]);
    expect(result.formErrors).toEqual([]);
  });

  it("rejects incomplete numeric ranges", () => {
    const result = validateRuleDraft(
      buildDraft({
        conditions: [
          {
            clientId: "cond-1",
            part: {
              field: "amount",
              op: "isbetween",
              type: "number",
              value: { num1: 100, num2: Number.NaN },
            },
          },
        ],
      })
    );

    expect(result.conditionErrors[0]).toContain("Condition 1: enter a valid value.");
  });

  it("accepts a valid formula starting with =", () => {
    const result = validateRuleDraft(
      buildDraft({
        actions: [
          {
            clientId: "action-1",
            part: {
              field: "notes",
              op: "set",
              value: "",
              type: "string",
              options: { formula: '=IF(ISBLANK(notes), imported_payee, notes)' },
            },
          },
        ],
      })
    );

    expect(result.actionErrors[0]).toEqual([]);
  });

  it("rejects an empty formula", () => {
    const result = validateRuleDraft(
      buildDraft({
        actions: [
          {
            clientId: "action-1",
            part: { field: "notes", op: "set", value: "", type: "string", options: { formula: "" } },
          },
        ],
      })
    );

    expect(result.actionErrors[0]).toContain("Action 1: enter a valid value.");
  });

  it("rejects a formula not starting with =", () => {
    const result = validateRuleDraft(
      buildDraft({
        actions: [
          {
            clientId: "action-1",
            part: { field: "notes", op: "set", value: "", type: "string", options: { formula: "IF(ISBLANK(notes), x, notes)" } },
          },
        ],
      })
    );

    expect(result.actionErrors[0]).toContain("Action 1: formula must start with =");
  });

  it("rejects formula mode on ID fields (e.g. category)", () => {
    const result = validateRuleDraft(
      buildDraft({
        actions: [
          {
            clientId: "action-1",
            part: {
              field: "category",
              op: "set",
              value: "",
              type: "id",
              options: { formula: "=IF(TRUE, x, y)" },
            },
          },
        ],
      })
    );

    // supportsFormula is false for category, so treated as invalid value
    expect(result.actionErrors[0]).toContain("Action 1: enter a valid value.");
  });

  it("rejects template values for fields that do not support templates", () => {
    const result = validateRuleDraft(
      buildDraft({
        actions: [
          {
            clientId: "action-1",
            part: {
              field: "category",
              op: "set",
              value: "",
              type: "id",
              options: { template: "{{payee}}" },
            },
          },
        ],
      })
    );

    expect(result.actionErrors[0]).toContain("Action 1: enter a valid value.");
  });
});

// ─── Split rules (F-119) ──────────────────────────────────────────────────────

describe("validateRuleDraft — split rules", () => {
  function draft(actions: ConditionOrAction[]): RuleDraft {
    return {
      stage: "default",
      conditionsOp: "and",
      conditions: createEditorParts([
        { field: "payee", op: "is", value: "p1", type: "id" },
      ]),
      actions: createEditorParts(actions),
    };
  }

  const validSplit: ConditionOrAction[] = [
    { op: "set", field: "payee", value: "p1", type: "id" },
    {
      op: "set-split-amount",
      value: 25,
      type: "number",
      options: { method: "fixed-percent", splitIndex: 1 },
    },
    { op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 1 } },
    {
      op: "set-split-amount",
      value: null,
      type: "number",
      options: { method: "remainder", splitIndex: 2 },
    },
    { op: "set", field: "category", value: "c2", type: "id", options: { splitIndex: 2 } },
  ];

  it("accepts a well-formed split rule", () => {
    const result = validateRuleDraft(draft(validSplit));
    expect(result.formErrors).toEqual([]);
    expect(result.actionErrors.flat()).toEqual([]);
  });

  it.each([
    ["fixed-amount", 1250, []],
    ["fixed-amount", null, ["enter an amount"]],
    ["fixed-percent", 25, []],
    ["fixed-percent", 150, ["between 0 and 100"]],
    ["fixed-percent", -1, ["between 0 and 100"]],
    ["remainder", null, []],
  ])("validates the %s method with value %p", (method, value, expected) => {
    const result = validateRuleDraft(
      draft([
        {
          op: "set-split-amount",
          value: value as ConditionOrAction["value"],
          options: { method: method as "fixed-amount", splitIndex: 1 },
        },
        { op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 1 } },
      ])
    );
    const errors = result.actionErrors.flat();
    if (expected.length === 0) {
      expect(errors).toEqual([]);
    } else {
      expect(errors.join(" ")).toContain(expected[0]);
    }
  });

  it("requires a formula that starts with = for the formula method", () => {
    const withoutEquals = validateRuleDraft(
      draft([
        {
          op: "set-split-amount",
          value: null,
          options: { method: "formula", formula: "amount / 2", splitIndex: 1 },
        },
      ])
    );
    expect(withoutEquals.actionErrors.flat().join(" ")).toContain("must start with =");

    const missing = validateRuleDraft(
      draft([{ op: "set-split-amount", value: null, options: { method: "formula", splitIndex: 1 } }])
    );
    expect(missing.actionErrors.flat().join(" ")).toContain("enter a formula");
  });

  it("requires a method", () => {
    const result = validateRuleDraft(
      draft([{ op: "set-split-amount", value: null, options: { splitIndex: 1 } }])
    );
    expect(result.actionErrors.flat().join(" ")).toContain("how this split's amount is calculated");
  });

  it("requires every split to have exactly one amount", () => {
    const noAmount = validateRuleDraft(
      draft([{ op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 1 } }])
    );
    expect(noAmount.formErrors.join(" ")).toContain("Split 1 needs an amount");

    const twoAmounts = validateRuleDraft(
      draft([
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 1 } },
        { op: "set-split-amount", value: 10, options: { method: "fixed-amount", splitIndex: 1 } },
      ])
    );
    expect(twoAmounts.formErrors.join(" ")).toContain("Split 1 has 2 amounts");
  });

  it("rejects an allocation that is not inside a split", () => {
    const result = validateRuleDraft(
      draft([{ op: "set-split-amount", value: null, options: { method: "remainder" } }])
    );
    expect(result.formErrors.join(" ")).toContain("must belong to a split");
  });

  it("flags a gap left by malformed stored indices", () => {
    const result = validateRuleDraft(
      draft([
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 2 } },
        { op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 2 } },
      ])
    );
    expect(result.formErrors.join(" ")).toContain("Split 1 is empty");
  });

  it("rejects a parent-only field inside a split", () => {
    const result = validateRuleDraft(
      draft([
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 1 } },
        { op: "set", field: "amount", value: 10, type: "number", options: { splitIndex: 1 } },
      ])
    );
    expect(result.actionErrors.flat().join(" ")).toContain("can only be set on the whole transaction");
  });

  it("leaves a non-split rule's structure unchecked", () => {
    const result = validateRuleDraft(
      draft([{ op: "set", field: "category", value: "c1", type: "id" }])
    );
    expect(result.formErrors).toEqual([]);
  });
});

// ─── Warnings (F-124) ─────────────────────────────────────────────────────────

describe("validateRuleDraft — empty conditions", () => {
  it("warns that a rule with no conditions never runs", () => {
    const result = validateRuleDraft({
      stage: "default",
      conditionsOp: "and",
      conditions: [],
      actions: createEditorParts([{ op: "delete-transaction", value: "" }]),
    });
    expect(result.warnings.join(" ")).toContain("never match");
    expect(result.warnings.join(" ")).not.toContain("every transaction");
  });

  it("does not warn once a condition exists", () => {
    const result = validateRuleDraft({
      stage: "default",
      conditionsOp: "and",
      conditions: createEditorParts([{ field: "payee", op: "is", value: "p1", type: "id" }]),
      actions: createEditorParts([{ op: "delete-transaction", value: "" }]),
    });
    expect(result.warnings).toEqual([]);
  });
});

// ─── Conditions: inflow/outflow (F-117) ───────────────────────────────────────

describe("validateRuleDraft — amount inflow/outflow", () => {
  function conditionDraft(condition: ConditionOrAction): RuleDraft {
    return {
      stage: "default",
      conditionsOp: "and",
      conditions: createEditorParts([condition]),
      actions: createEditorParts([{ op: "set", field: "category", value: "c1", type: "id" }]),
    };
  }

  it("accepts inflow on an amount condition", () => {
    const result = validateRuleDraft(
      conditionDraft({ field: "amount", op: "gt", value: 10, type: "number", options: { inflow: true } })
    );
    expect(result.conditionErrors.flat()).toEqual([]);
  });

  it("rejects both at once, and either on another field", () => {
    expect(
      validateRuleDraft(
        conditionDraft({
          field: "amount",
          op: "gt",
          value: 10,
          type: "number",
          options: { inflow: true, outflow: true },
        })
      ).conditionErrors.flat().join(" ")
    ).toContain("not both");

    expect(
      validateRuleDraft(
        conditionDraft({ field: "notes", op: "contains", value: "x", options: { inflow: true } })
      ).conditionErrors.flat().join(" ")
    ).toContain("only apply to an amount condition");
  });

  it("rejects a pseudo-field written to the wire", () => {
    const result = validateRuleDraft(
      conditionDraft({ field: "amount-inflow", op: "gt", value: 10, type: "number" })
    );
    expect(result.conditionErrors.flat().join(" ")).toContain("select a valid field");
  });
});

// ─── Opening and saving an existing split rule (F-119) ────────────────────────
//
// The acute bug: `validateActionPart` rejected `set-split-amount`, and the drawer blocks Save on
// any action error — so a split rule could be opened and never saved back, even untouched. The
// drawer's own path is createEditorParts → (edit) → stripEditorParts → serializeRule, so pinning
// that round-trip here covers it without mounting the component.

describe("an existing split rule survives the editor untouched", () => {
  const stored: Rule = {
    id: "r1",
    stage: "pre",
    conditionsOp: "and",
    conditions: [
      { field: "payee", op: "is", value: "p1", type: "id" },
      { field: "amount", op: "gt", value: 10, type: "number", options: { outflow: true } },
    ],
    actions: [
      { op: "set", field: "notes", value: "warehouse", type: "string" },
      {
        op: "set-split-amount",
        value: 60,
        type: "number",
        options: { method: "fixed-percent", splitIndex: 1 },
      },
      { op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 1 } },
      {
        op: "set-split-amount",
        value: null,
        type: "number",
        options: { method: "remainder", splitIndex: 2 },
      },
      { op: "set", field: "category", value: "c2", type: "id", options: { splitIndex: 2 } },
    ],
  };

  const draft: RuleDraft = {
    stage: stored.stage,
    conditionsOp: stored.conditionsOp,
    conditions: createEditorParts(stored.conditions),
    actions: createEditorParts(stored.actions),
  };

  it("saves back byte-for-byte identical", () => {
    expect(serializeRuleDraft(draft)).toBe(serializeRule(stored));
  });

  it("raises nothing that would block Save", () => {
    const validation = validateRuleDraft(draft);
    expect(validation.formErrors).toEqual([]);
    expect(validation.conditionErrors.flat()).toEqual([]);
    expect(validation.actionErrors.flat()).toEqual([]);
  });
});

describe("validateRuleDraft — non-dense split indices", () => {
  it("names the gap rather than silently accepting it", () => {
    const result = validateRuleDraft({
      stage: "default",
      conditionsOp: "and",
      conditions: createEditorParts([{ field: "payee", op: "is", value: "p1", type: "id" }]),
      actions: createEditorParts([
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 1 } },
        { op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 1 } },
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 5 } },
        { op: "set", field: "category", value: "c2", type: "id", options: { splitIndex: 5 } },
      ]),
    });
    expect(result.formErrors.join(" ")).toContain("numbered 1, 2, 3");
  });

  it("stays quiet on a well-formed split rule", () => {
    const result = validateRuleDraft({
      stage: "default",
      conditionsOp: "and",
      conditions: createEditorParts([{ field: "payee", op: "is", value: "p1", type: "id" }]),
      actions: createEditorParts([
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 1 } },
        { op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 1 } },
        { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 2 } },
        { op: "set", field: "category", value: "c2", type: "id", options: { splitIndex: 2 } },
      ]),
    });
    expect(result.formErrors).toEqual([]);
  });
});

describe("validateRuleDraft — an inherited name is not an operator", () => {
  it.each(["toString", "constructor", "valueOf"])("rejects op %p", (op) => {
    const result = validateRuleDraft({
      stage: "default",
      conditionsOp: "and",
      conditions: createEditorParts([{ field: "amount", op, value: "x" }]),
      actions: createEditorParts([{ op: "set", field: "notes", value: "y", type: "string" }]),
    });
    expect(result.conditionErrors.flat().join(" ")).toContain("select a valid operator");
  });

  it.each(["toString", "constructor"])("rejects action op %p", (op) => {
    const result = validateRuleDraft({
      stage: "default",
      conditionsOp: "and",
      conditions: createEditorParts([{ field: "payee", op: "is", value: "p1", type: "id" }]),
      actions: createEditorParts([{ op, field: "notes", value: "y", type: "string" }]),
    });
    expect(result.actionErrors.flat().join(" ")).toContain("select a valid action");
  });
});

/**
 * Amount units at the rules boundary.
 *
 * Actual stores money as integer minor units; the app works in decimal whole units. The
 * conversion happens here and in `lib/actual/ruleMutation.ts`, and the two must be exact
 * inverses. A `set-split-amount` action is the awkward case: it has no `field`, so the
 * field-type lookup cannot classify it, and only one of its four methods carries money.
 */

import { normalizeRule } from "./rules";
import { prepareRuleForTransport } from "@/lib/actual/ruleMutation";
import type { ApiRule } from "@/types/api";
import type { ConditionOrAction, Rule } from "@/types/entities";

function apiRule(parts: Partial<ApiRule>): ApiRule {
  return {
    id: "r1",
    stage: "default",
    conditionsOp: "and",
    conditions: [],
    actions: [],
    ...parts,
  };
}

function appRule(parts: Partial<Rule>): Rule {
  return {
    id: "r1",
    stage: "default",
    conditionsOp: "and",
    conditions: [],
    actions: [],
    ...parts,
  };
}

describe("normalizeRule — amounts on read", () => {
  it("converts an amount condition from minor units", () => {
    const rule = normalizeRule(
      apiRule({ conditions: [{ field: "amount", op: "gt", value: 5000, type: "number" }] })
    );
    expect(rule.conditions[0].value).toBe(50);
  });

  it("converts both ends of an amount range", () => {
    const rule = normalizeRule(
      apiRule({
        conditions: [{ field: "amount", op: "isbetween", value: { num1: 1000, num2: 2500 } }],
      })
    );
    expect(rule.conditions[0].value).toEqual({ num1: 10, num2: 25 });
  });

  it("converts a fixed-amount split, which has no field to key off", () => {
    const rule = normalizeRule(
      apiRule({
        actions: [
          {
            op: "set-split-amount",
            value: 1250,
            options: { method: "fixed-amount", splitIndex: 1 },
          },
        ],
      })
    );
    expect(rule.actions[0].value).toBe(12.5);
  });

  it("leaves a fixed-percent split alone — 25 percent is not 25 cents", () => {
    const rule = normalizeRule(
      apiRule({
        actions: [
          {
            op: "set-split-amount",
            value: 25,
            options: { method: "fixed-percent", splitIndex: 1 },
          },
        ],
      })
    );
    expect(rule.actions[0].value).toBe(25);
  });

  it("leaves remainder and formula splits alone", () => {
    const rule = normalizeRule(
      apiRule({
        actions: [
          { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 1 } },
          {
            op: "set-split-amount",
            value: null,
            options: { method: "formula", formula: "=amount/2", splitIndex: 2 },
          },
        ],
      })
    );
    expect(rule.actions.map((a) => a.value)).toEqual([null, null]);
  });

  it("preserves the whole options bag, not just the keys it understands", () => {
    const rule = normalizeRule(
      apiRule({
        actions: [
          { field: "category", op: "set", value: "c1", type: "id", options: { splitIndex: 2 } },
        ],
      })
    );
    expect(rule.actions[0].options).toEqual({ splitIndex: 2 });
  });
});

describe("prepareRuleForTransport — amounts on write", () => {
  it("converts an amount condition to minor units", () => {
    const rule = prepareRuleForTransport(
      appRule({ conditions: [{ field: "amount", op: "gt", value: 50, type: "number" }] })
    );
    expect(rule.conditions[0].value).toBe(5000);
  });

  it("converts a fixed-amount split to minor units", () => {
    const rule = prepareRuleForTransport(
      appRule({
        actions: [
          {
            op: "set-split-amount",
            value: 12.5,
            options: { method: "fixed-amount", splitIndex: 1 },
          },
        ],
      })
    );
    expect(rule.actions[0].value).toBe(1250);
  });

  it("leaves a fixed-percent split alone", () => {
    const rule = prepareRuleForTransport(
      appRule({
        actions: [
          { op: "set-split-amount", value: 25, options: { method: "fixed-percent", splitIndex: 1 } },
        ],
      })
    );
    expect(rule.actions[0].value).toBe(25);
  });
});

describe("rules boundary round-trip", () => {
  // One rule exercising every amount-bearing shape at once.
  const wireActions: ConditionOrAction[] = [
    { field: "amount", op: "set", value: 9900, type: "number" },
    { op: "set-split-amount", value: 1250, options: { method: "fixed-amount", splitIndex: 1 } },
    { field: "category", op: "set", value: "c1", type: "id", options: { splitIndex: 1 } },
    { op: "set-split-amount", value: 25, options: { method: "fixed-percent", splitIndex: 2 } },
    { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 3 } },
  ];

  it("returns to exactly the stored values after a read then a write", () => {
    const read = normalizeRule(
      apiRule({
        conditions: [{ field: "amount", op: "isbetween", value: { num1: 500, num2: 7500 } }],
        actions: wireActions,
      })
    );
    const written = prepareRuleForTransport(read);

    expect(written.conditions[0].value).toEqual({ num1: 500, num2: 7500 });
    expect(written.actions.map((a) => a.value)).toEqual([9900, 1250, "c1", 25, null]);
    expect(written.actions.map((a) => a.options)).toEqual(wireActions.map((a) => a.options));
  });
});

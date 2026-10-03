import {
  enabledRuleSafetyIssues,
  matchRuleStrength,
  MatchDslValidationError,
  parseMatchActionsV1,
  parseMatchConditionsV1,
  parseStoredMatchRule,
} from "./dsl";

const safety = [
  { kind: "bench-marker", value: "exclude" },
  { kind: "posting-link", value: "exclude" },
] as const;

describe("matching DSL v1", () => {
  it("round-trips the versioned conditions and actions envelopes", () => {
    const conditions = parseMatchConditionsV1({
      format: "rd084.debt-match-conditions",
      version: 1,
      operator: "all",
      items: [
        { kind: "source-account", accountId: "cash" },
        { kind: "amount", operator: "approximate", amountMinor: 100_000, direction: "outflow", tolerance: { kind: "basis-points", bps: 100 } },
        ...safety,
      ],
    });
    const actions = parseMatchActionsV1({
      format: "rd084.debt-match-actions",
      version: 1,
      items: [
        { kind: "link-repayment" },
        { kind: "categorize-full-payment", categoryId: "loan" },
        { kind: "split-components", components: [{ componentKey: "principal", amountMinor: 90_000 }] },
        { kind: "set-interest-category", categoryId: "interest" },
        { kind: "set-fee-category", categoryId: "fees" },
        { kind: "set-principal-transfer-target", accountId: "liability" },
        { kind: "mark-extra-repayment" },
      ],
    });
    expect(parseStoredMatchRule({ ruleFormatVersion: 1, conditionsJson: JSON.stringify(conditions), actionsJson: JSON.stringify(actions) })).toEqual({ conditions, actions });
    expect(matchRuleStrength(conditions)).toEqual({ strength: "strong", reasons: [] });
    expect(enabledRuleSafetyIssues(conditions)).toEqual([]);
  });

  it("rejects future formats, unknown fields, invalid ranges and unsafe action combinations", () => {
    const base = { format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "amount", operator: "between", minMinor: 2, maxMinor: 1, direction: "outflow" }] };
    expect(() => parseMatchConditionsV1(base)).toThrow(/maxMinor/);
    expect(() => parseMatchConditionsV1({ ...base, version: 2 })).toThrow(MatchDslValidationError);
    expect(() => parseMatchConditionsV1({ ...base, items: [{ kind: "source-account", accountId: "a", surprise: true }] })).toThrow();
    expect(() => parseMatchConditionsV1({ ...base, items: [{ kind: "amount", operator: "approximate", amountMinor: 0, direction: "either", tolerance: { kind: "basis-points", bps: 10 } }] })).toThrow(/cannot be zero/);
    expect(() => parseMatchActionsV1({ format: "rd084.debt-match-actions", version: 1, items: [{ kind: "ignore" }, { kind: "link-repayment" }] })).toThrow(/only action/);
    expect(() => parseStoredMatchRule({ ruleFormatVersion: 2, conditionsJson: "{}", actionsJson: "{}" })).toThrow(/unsupported/);
  });

  it("marks generic/ANY rules weak and requires both safety guards before enablement", () => {
    const weak = parseMatchConditionsV1({
      format: "rd084.debt-match-conditions",
      version: 1,
      operator: "any",
      items: [{ kind: "notes", operator: "contains", value: "PAYMENT" }],
    });
    expect(matchRuleStrength(weak)).toMatchObject({ strength: "weak" });
    expect(enabledRuleSafetyIssues(weak)).toEqual([
      "An enabled rule must exclude Bench-marked transactions.",
      "An enabled rule must exclude transactions already linked to a posting.",
    ]);
  });
});

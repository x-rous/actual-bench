import { validateRuleDraft, type RuleDraft } from "./ruleEditor";

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
});

import { exportRulesToCsv } from "./rulesCsvExport";
import { importRulesFromCsv } from "./rulesCsvImport";
import type { Rule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";

function staged(rule: Rule, overrides: { isDeleted?: boolean } = {}): StagedMap<Rule> {
  return {
    [rule.id]: {
      entity: rule,
      original: null,
      isNew: true,
      isUpdated: false,
      isDeleted: overrides.isDeleted ?? false,
      validationErrors: {},
    },
  };
}

const emptyMaps = { payees: {}, categories: {}, accounts: {} };

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

describe("exportRulesToCsv", () => {
  it("outputs a header row even for an empty staged map", () => {
    const result = exportRulesToCsv({}, emptyMaps);
    expect(result).toBe("rule_id,stage,conditions_op,row_type,field,op,value");
  });

  it("skips deleted rules", () => {
    const rule = makeRule("r1", {
      conditions: [{ field: "notes", op: "contains", value: "grocery", type: "string" }],
      actions: [],
    });
    const result = exportRulesToCsv(staged(rule, { isDeleted: true }), emptyMaps);
    const lines = result.split("\n");
    expect(lines).toHaveLength(1); // header only
  });

  it("emits one row per condition and action", () => {
    const rule = makeRule("r1", {
      stage: "default",
      conditionsOp: "and",
      conditions: [{ field: "notes", op: "contains", value: "grocery", type: "string" }],
      actions: [{ field: "category", op: "set", value: "cat-id", type: "id" }],
    });
    const result = exportRulesToCsv(staged(rule), emptyMaps);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3); // header + condition + action
  });

  it("puts stage and conditions_op only on the first row of a rule", () => {
    const rule = makeRule("r1", {
      stage: "pre",
      conditionsOp: "or",
      conditions: [
        { field: "notes", op: "contains", value: "a", type: "string" },
        { field: "notes", op: "contains", value: "b", type: "string" },
      ],
      actions: [],
    });
    const result = exportRulesToCsv(staged(rule), emptyMaps);
    const lines = result.split("\n");
    // First data row: r1,pre,or,condition,...
    expect(lines[1]).toMatch(/^r1,pre,or,condition/);
    // Second data row: r1,,, (empty stage and conditionsOp)
    expect(lines[2]).toMatch(/^r1,,,condition/);
  });

  it("emits a stub row for rules with no conditions and no actions", () => {
    const rule = makeRule("r1", { stage: "default", conditionsOp: "and" });
    const result = exportRulesToCsv(staged(rule), emptyMaps);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^r1,default,and/);
  });

  it("resolves category IDs to names in the value column", () => {
    const cat = { id: "cat-1", name: "Food", groupId: "g1", isIncome: false, hidden: false };
    const maps = {
      payees: {},
      categories: { "cat-1": { entity: cat, original: null, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} } },
      accounts: {},
    };
    const rule = makeRule("r1", {
      actions: [{ field: "category", op: "set", value: "cat-1", type: "id" }],
    });
    const result = exportRulesToCsv(staged(rule), maps);
    expect(result).toContain("Food");
    expect(result).not.toContain("cat-1");
  });

  it("resolves oneOf array values with pipe separator", () => {
    const maps = {
      payees: {
        "p1": { entity: { id: "p1", name: "Amazon" }, original: null, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} },
        "p2": { entity: { id: "p2", name: "Netflix" }, original: null, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} },
      },
      categories: {},
      accounts: {},
    };
    const rule = makeRule("r1", {
      conditions: [{ field: "payee", op: "oneOf", value: ["p1", "p2"], type: "id" }],
    });
    const result = exportRulesToCsv(staged(rule), maps);
    expect(result).toContain("Amazon|Netflix");
  });

  it("exports template actions with op=set-template and value=template expression", () => {
    const rule = makeRule("r1", {
      actions: [{ field: "notes", op: "set", value: "", type: "string", options: { template: "{{regex imported_payee 'foo' 'bar'}}" } }],
    });
    const result = exportRulesToCsv(staged(rule), emptyMaps);
    expect(result).toContain("set-template");
    expect(result).toContain("{{regex imported_payee 'foo' 'bar'}}");
    expect(result).not.toContain(",set,");
  });

  it("exports empty-string template actions with op=set-template and blank value", () => {
    const rule = makeRule("r1", {
      actions: [{ field: "notes", op: "set", value: "", type: "string", options: { template: "" } }],
    });
    const result = exportRulesToCsv(staged(rule), emptyMaps);
    expect(result).toContain("set-template");
  });

  it("round-trips: exported CSV can be re-imported with the same structure", () => {
    const rule = makeRule("r1", {
      stage: "pre",
      conditionsOp: "or",
      conditions: [{ field: "notes", op: "contains", value: "grocery", type: "string" }],
      actions: [{ field: "cleared", op: "set", value: "true", type: "string" }],
    });
    const csv = exportRulesToCsv(staged(rule), emptyMaps);
    const imported = importRulesFromCsv(csv, emptyMaps);

    expect("error" in imported).toBe(false);
    if ("error" in imported) return;

    expect(imported.rules).toHaveLength(1);
    expect(imported.rules[0].stage).toBe("pre");
    expect(imported.rules[0].conditionsOp).toBe("or");
    expect(imported.rules[0].conditions[0]).toMatchObject({ field: "notes", op: "contains", value: "grocery" });
    expect(imported.rules[0].actions[0]).toMatchObject({ field: "cleared", op: "set" });
  });

  it("round-trips: template action survives export → import", () => {
    const rule = makeRule("r1", {
      actions: [{ field: "notes", op: "set", value: "", type: "string", options: { template: "{{regex imported_payee 'foo' 'bar'}}" } }],
    });
    const csv = exportRulesToCsv(staged(rule), emptyMaps);
    const imported = importRulesFromCsv(csv, emptyMaps);

    expect("error" in imported).toBe(false);
    if ("error" in imported) return;

    const action = imported.rules[0].actions[0];
    expect(action.op).toBe("set");
    expect(action.value).toBe("");
    expect(action.options).toEqual({ template: "{{regex imported_payee 'foo' 'bar'}}" });
  });
});

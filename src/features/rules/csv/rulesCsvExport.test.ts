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

const emptyMaps = { payees: {}, categories: {}, accounts: {}, categoryGroups: {} };

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
    expect(result).toBe("rule_id,stage,conditions_op,row_type,field,op,value,split_index,options");
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
      categoryGroups: {},
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
      categoryGroups: {},
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

  it("exports delete-transaction action with empty field and value", () => {
    const rule = makeRule("r1", {
      actions: [{ op: "delete-transaction", value: "" }],
    });
    const result = exportRulesToCsv(staged(rule), emptyMaps);
    expect(result).toContain("delete-transaction");
  });

  it("exports boolean cleared value as 'true' or 'false' string", () => {
    const rule = makeRule("r1", {
      actions: [{ field: "cleared", op: "set", value: true, type: "boolean" }],
    });
    const result = exportRulesToCsv(staged(rule), emptyMaps);
    expect(result).toContain("true");
  });

  it("exports formula actions with op=set-formula and prefixes '=' formulas with single-quote", () => {
    const rule = makeRule("r1", {
      actions: [{ field: "notes", op: "set", value: "", type: "string", options: { formula: "=IF(ISBLANK(notes), x, notes)" } }],
    });
    const result = exportRulesToCsv(staged(rule), emptyMaps);
    expect(result).toContain("set-formula");
    // The formula is prefixed with ' to prevent spreadsheet apps from evaluating it
    expect(result).toContain("'=IF(ISBLANK(notes)");
    expect(result).not.toContain(",set,");
  });

  it("round-trips: formula action survives export → import", () => {
    const formula = '=IF(ISBLANK(notes), "(" & imported_payee & ") |", notes & " (" & imported_payee & ") |")';
    const rule = makeRule("r1", {
      actions: [{ field: "notes", op: "set", value: "", type: "string", options: { formula } }],
    });
    const csv = exportRulesToCsv(staged(rule), emptyMaps);
    const imported = importRulesFromCsv(csv, emptyMaps);

    expect("error" in imported).toBe(false);
    if ("error" in imported) return;

    const action = imported.rules[0].actions[0];
    expect(action.op).toBe("set");
    expect(action.value).toBe("");
    expect(action.options).toEqual({ formula });
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

// ─── Lossless round-trip (F-123) ──────────────────────────────────────────────

describe("CSV round-trip", () => {
  const maps = {
    payees: { p1: { entity: { id: "p1", name: "Costco" }, isDeleted: false } },
    categories: {
      c1: { entity: { id: "c1", name: "Groceries" }, isDeleted: false },
      c2: { entity: { id: "c2", name: "Household" }, isDeleted: false },
      c3: { entity: { id: "c3", name: "Fuel" }, isDeleted: false },
    },
    accounts: {},
    categoryGroups: {},
  };

  // Every shape the exporter has to encode: an inflow condition, a template, a formula, and a
  // three-way split using three different allocation methods.
  const rule = makeRule("r1", {
    stage: "pre",
    conditions: [
      { field: "payee", op: "is", value: "p1", type: "id" },
      { field: "amount", op: "gt", value: 10, type: "number", options: { inflow: true } },
      { field: "notes", op: "hasTags", value: "#bulk", type: "string" },
    ],
    actions: [
      { field: "notes", op: "set", value: "", type: "string", options: { template: "{{payee}}" } },
      { field: "payee_name", op: "set", value: "", type: "string", options: { formula: "=UPPER(notes)" } },
      { op: "set-split-amount", value: 12.5, type: "number", options: { method: "fixed-amount", splitIndex: 1 } },
      { field: "category", op: "set", value: "c1", type: "id", options: { splitIndex: 1 } },
      { op: "set-split-amount", value: 25, type: "number", options: { method: "fixed-percent", splitIndex: 2 } },
      { field: "category", op: "set", value: "c2", type: "id", options: { splitIndex: 2 } },
      { op: "set-split-amount", value: null, type: "number", options: { method: "remainder", splitIndex: 3 } },
      { field: "category", op: "set", value: "c3", type: "id", options: { splitIndex: 3 } },
    ],
  });

  it("survives export → import with its splits and options intact", () => {
    const csv = exportRulesToCsv(staged(rule), maps);
    const result = importRulesFromCsv(csv, maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;

    expect(result.skipped).toBe(0);
    const imported = result.rules[0];
    expect(imported.stage).toBe("pre");

    // Conditions, including the inflow marker and the tag value.
    expect(imported.conditions).toEqual([
      { field: "payee", op: "is", value: "p1", type: "id" },
      { field: "amount", op: "gt", value: "10", type: "number", options: { inflow: true } },
      { field: "notes", op: "hasTags", value: "#bulk", type: "string" },
    ]);

    // Every split kept its index, its method and its value.
    expect(imported.actions.map((a) => [a.op, a.value, a.options])).toEqual([
      ["set", "", { template: "{{payee}}" }],
      ["set", "", { formula: "=UPPER(notes)" }],
      ["set-split-amount", 12.5, { method: "fixed-amount", splitIndex: 1 }],
      ["set", "c1", { splitIndex: 1 }],
      ["set-split-amount", 25, { method: "fixed-percent", splitIndex: 2 }],
      ["set", "c2", { splitIndex: 2 }],
      ["set-split-amount", null, { method: "remainder", splitIndex: 3 }],
      ["set", "c3", { splitIndex: 3 }],
    ]);
  });

  it("round-trips a split whose amount comes from a formula", () => {
    const formulaSplit = makeRule("r2", {
      conditions: [{ field: "payee", op: "is", value: "p1", type: "id" }],
      actions: [
        {
          op: "set-split-amount",
          value: null,
          type: "number",
          options: { method: "formula", formula: "=amount * 0.2", splitIndex: 1 },
        },
        { field: "category", op: "set", value: "c1", type: "id", options: { splitIndex: 1 } },
      ],
    });
    const result = importRulesFromCsv(exportRulesToCsv(staged(formulaSplit), maps), maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules[0].actions[0].options).toEqual({
      method: "formula",
      formula: "=amount * 0.2",
      splitIndex: 1,
    });
  });

  it("still imports a file exported before the split_index and options columns existed", () => {
    const legacy = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,notes,contains,grocery",
      "r1,,,action,category,set,Groceries",
    ].join("\n");
    const result = importRulesFromCsv(legacy, maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.skipped).toBe(0);
    expect(result.rules[0].conditions[0]).toMatchObject({ field: "notes", op: "contains" });
    expect(result.rules[0].actions[0]).toMatchObject({ field: "category", op: "set", value: "c1" });
    expect(result.rules[0].actions[0].options).toBeUndefined();
  });

  it("skips a rule with an action op it does not understand, rather than rewriting it as a set", () => {
    const bogus = [
      "rule_id,stage,conditions_op,row_type,field,op,value,split_index,options",
      "r1,default,and,condition,notes,contains,grocery,,",
      "r1,,,action,category,frobnicate,Groceries,,",
    ].join("\n");
    const result = importRulesFromCsv(bogus, maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.skipReasons[0].reason).toContain('unsupported action "frobnicate"');
  });
});

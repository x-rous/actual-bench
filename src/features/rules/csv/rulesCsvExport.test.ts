import { exportRulesToCsv } from "./rulesCsvExport";
import { importRulesFromCsv } from "./rulesCsvImport";
import type { Rule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import type { EntityMaps } from "../utils/rulePreview";

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
  // Both sides of the round-trip only ever read `id`/`name` off these, so a minimal staged
  // entity is enough; the cast keeps the fixture readable.
  function named(entities: { id: string; name: string }[]): EntityMaps["payees"] {
    return Object.fromEntries(
      entities.map((entity) => [
        entity.id,
        { entity, original: null, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} },
      ])
    ) as EntityMaps["payees"];
  }

  const maps = {
    payees: named([{ id: "p1", name: "Costco" }]),
    categories: named([
      { id: "c1", name: "Groceries" },
      { id: "c2", name: "Household" },
      { id: "c3", name: "Fuel" },
    ]),
    accounts: named([]),
    categoryGroups: named([]),
  } as unknown as EntityMaps;

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

// ─── Spreadsheet formula neutralisation (CWE-1236) ────────────────────────────

describe("CSV formula injection", () => {
  const maps = {
    payees: {},
    categories: {},
    accounts: {},
    categoryGroups: {},
  } as unknown as EntityMaps;

  it.each(["=", "+", "-", "@"])("guards a template beginning with %p", (lead) => {
    const template = `${lead}HYPERLINK("http://evil","click")`;
    const rule = makeRule("r1", {
      conditions: [{ field: "notes", op: "contains", value: "x", type: "string" }],
      actions: [{ field: "notes", op: "set", value: "", type: "string", options: { template } }],
    });

    const csv = exportRulesToCsv(staged(rule), maps);
    // The cell must not begin with a character a spreadsheet reads as a formula.
    const templateRow = csv.split("\n").find((l) => l.includes("set-template"));
    expect(templateRow).toBeDefined();
    expect(templateRow).toContain(`'${lead}`);

    // …and the guard comes off again, so the round-trip is unaffected.
    const result = importRulesFromCsv(csv, maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules[0].actions[0].options?.template).toBe(template);
  });

  it("guards a free-text value and restores it", () => {
    const rule = makeRule("r1", {
      conditions: [{ field: "notes", op: "contains", value: "=1+1", type: "string" }],
      actions: [{ field: "notes", op: "set", value: "@SUM(A1)", type: "string" }],
    });
    const csv = exportRulesToCsv(staged(rule), maps);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@SUM(A1)");

    const result = importRulesFromCsv(csv, maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules[0].conditions[0].value).toBe("=1+1");
    expect(result.rules[0].actions[0].value).toBe("@SUM(A1)");
  });

  it("leaves a negative amount as a plain number", () => {
    const rule = makeRule("r1", {
      conditions: [{ field: "amount", op: "lt", value: -50, type: "number" }],
      actions: [{ field: "notes", op: "set", value: "x", type: "string" }],
    });
    const csv = exportRulesToCsv(staged(rule), maps);
    expect(csv).toContain(",-50,");
    expect(csv).not.toContain("'-50");
  });

  // The apostrophe is part of the encoding, so a value that already starts with one has to be
  // escaped as well — otherwise the importer eats the user's own character.
  it.each(["'tis", "'=1+1", "''double", "'@x"])(
    "round-trips %p without eating the leading apostrophe",
    (value) => {
      const rule = makeRule("r1", {
        conditions: [{ field: "notes", op: "contains", value, type: "string" }],
        actions: [{ field: "notes", op: "set", value: "x", type: "string" }],
      });
      const result = importRulesFromCsv(exportRulesToCsv(staged(rule), maps), maps);
      expect("rules" in result).toBe(true);
      if (!("rules" in result)) return;
      expect(result.rules[0].conditions[0].value).toBe(value);
    }
  );

  it("still imports a formula guarded by the pre-existing single-quote convention", () => {
    // Files exported before this PR wrote `'=…` for formulas. The new un-guard has to keep
    // reading them, since the guard character and the pattern are the same.
    const legacy = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,notes,contains,grocery",
      "r1,,,action,notes,set-formula,'=UPPER(notes)",
    ].join("\n");
    const result = importRulesFromCsv(legacy, maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules[0].actions[0].options?.formula).toBe("=UPPER(notes)");
  });

  it("rejects an options cell setting both inflow and outflow", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value,split_index,options",
      "r1,default,and,condition,amount,gt,10,,inflow=true;outflow=true",
      "r1,,,action,notes,set,x,,",
    ].join("\n");
    const result = importRulesFromCsv(csv, maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.skipReasons[0].reason).toContain("both inflow and outflow");
  });

  it("still accepts either direction on its own", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value,split_index,options",
      "r1,default,and,condition,amount,gt,10,,outflow=true",
      "r1,,,action,notes,set,x,,",
    ].join("\n");
    const result = importRulesFromCsv(csv, maps);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules[0].conditions[0].options).toEqual({ outflow: true });
  });
});

describe("CSV import rejects malformed splits", () => {
  const maps = { payees: {}, categories: {}, accounts: {}, categoryGroups: {} } as unknown as EntityMaps;

  function importRows(rows: string[]) {
    return importRulesFromCsv(
      ["rule_id,stage,conditions_op,row_type,field,op,value,split_index,options", ...rows].join("\n"),
      maps
    );
  }

  it("skips a rule whose splits start at 2", () => {
    // The importer stages directly, so the drawer's dense-index check would never see this.
    const result = importRows([
      "r1,default,and,condition,notes,contains,x,,",
      "r1,,,action,,set-split-amount,,2,method=remainder",
      "r1,,,action,notes,set,y,2,",
    ]);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules).toHaveLength(0);
    expect(result.skipReasons[0].reason).toContain("1, 2, 3");
  });

  it("skips a rule with a gap between splits", () => {
    const result = importRows([
      "r1,default,and,condition,notes,contains,x,,",
      "r1,,,action,,set-split-amount,,1,method=remainder",
      "r1,,,action,notes,set,a,1,",
      "r1,,,action,,set-split-amount,,3,method=remainder",
      "r1,,,action,notes,set,b,3,",
    ]);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules).toHaveLength(0);
    expect(result.skipReasons[0].reason).toContain("1, 2, 3");
  });

  it("accepts a well-formed two-way split", () => {
    const result = importRows([
      "r1,default,and,condition,notes,contains,x,,",
      "r1,,,action,,set-split-amount,,1,method=remainder",
      "r1,,,action,notes,set,a,1,",
      "r1,,,action,,set-split-amount,,2,method=remainder",
      "r1,,,action,notes,set,b,2,",
    ]);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });
});

describe("CSV import rejects an allocation with no split target", () => {
  const maps = { payees: {}, categories: {}, accounts: {}, categoryGroups: {} } as unknown as EntityMaps;

  function importRows(rows: string[]) {
    return importRulesFromCsv(
      ["rule_id,stage,conditions_op,row_type,field,op,value,split_index,options", ...rows].join("\n"),
      maps
    );
  }

  it.each([["blank", ""], ["nonnumeric", "abc"], ["zero", "0"]])(
    "skips the rule when split_index is %s",
    (_label, splitIndex) => {
      // hasDenseSplitIndices filters index 0 before checking, so a lone index-0 allocation
      // looks dense — the group has to be rejected here instead.
      const result = importRows([
        "r1,default,and,condition,notes,contains,x,,",
        `r1,,,action,,set-split-amount,,${splitIndex},method=remainder`,
        "r1,,,action,notes,set,y,,",
      ]);
      expect("rules" in result).toBe(true);
      if (!("rules" in result)) return;
      expect(result.rules).toHaveLength(0);
      expect(result.skipReasons[0].reason).toContain("allocation without a split_index");
    }
  );

  it("still accepts an allocation that names its split", () => {
    const result = importRows([
      "r1,default,and,condition,notes,contains,x,,",
      "r1,,,action,,set-split-amount,,1,method=remainder",
      "r1,,,action,notes,set,y,1,",
    ]);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].actions[0].options).toEqual({ method: "remainder", splitIndex: 1 });
  });
});

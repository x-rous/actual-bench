import { importRulesFromCsv } from "./rulesCsvImport";
import type { LookupMaps } from "./rulesCsvImport";

const emptyMaps: LookupMaps = { payees: {}, categories: {}, accounts: {}, categoryGroups: {} };

function makeMaps(
  payees: { id: string; name: string }[] = [],
  categories: { id: string; name: string }[] = [],
  accounts: { id: string; name: string }[] = [],
  categoryGroups: { id: string; name: string }[] = []
): LookupMaps {
  return {
    payees: Object.fromEntries(
      payees.map((p) => [p.id, { entity: p, isDeleted: false }])
    ),
    categories: Object.fromEntries(
      categories.map((c) => [c.id, { entity: c, isDeleted: false }])
    ),
    accounts: Object.fromEntries(
      accounts.map((a) => [a.id, { entity: a, isDeleted: false }])
    ),
    categoryGroups: Object.fromEntries(
      categoryGroups.map((g) => [g.id, { entity: g, isDeleted: false }])
    ),
  };
}


describe("importRulesFromCsv", () => {
  it("returns an error for text shorter than CSV_MAX_BYTES check (no rows)", () => {
    const result = importRulesFromCsv("rule_id,row_type,field", emptyMaps);
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/no data rows/i);
  });

  it("returns an error when required columns are missing", () => {
    const csv = "stage,conditions_op,row_type\ndefault,and,condition";
    const result = importRulesFromCsv(csv, emptyMaps);
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/rule_id/i);
  });

  it("imports a rule with one condition and one action", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,notes,contains,grocery",
      "r1,,,action,category,set,Food",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.rules).toHaveLength(1);
    const rule = result.rules[0];
    expect(rule.stage).toBe("default");
    expect(rule.conditionsOp).toBe("and");
    expect(rule.conditions).toHaveLength(1);
    expect(rule.conditions[0]).toMatchObject({ field: "notes", op: "contains", value: "grocery" });
    expect(rule.actions).toHaveLength(1);
    expect(rule.actions[0]).toMatchObject({ field: "category", op: "set" });
    expect(result.skipped).toBe(0);
  });

  it("groups multiple rows with the same rule_id into a single rule", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,notes,contains,a",
      "r1,,,condition,notes,contains,b",
      "r1,,,action,category,set,Food",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].conditions).toHaveLength(2);
    expect(result.rules[0].actions).toHaveLength(1);
  });

  it("resolves payee names to IDs", () => {
    const maps = makeMaps([{ id: "payee-1", name: "Amazon" }]);
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,payee,is,Amazon",
    ].join("\n");

    const result = importRulesFromCsv(csv, maps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules[0].conditions[0].value).toBe("payee-1");
  });

  it("auto-creates payees that do not exist in the maps", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,payee,is,NewPayee",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.newPayees).toHaveLength(1);
    expect(result.newPayees[0].name).toBe("NewPayee");
    // The condition value should be the new payee's ID
    const newId = result.newPayees[0].id;
    expect(result.rules[0].conditions[0].value).toBe(newId);
  });

  it("deduplicates auto-created payees across multiple conditions referencing the same name", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,payee,is,NewPayee",
      "r2,default,and,condition,payee,is,NewPayee",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.newPayees).toHaveLength(1);
    // Both rules should reference the same auto-created payee ID
    expect(result.rules[0].conditions[0].value).toBe(result.rules[1].conditions[0].value);
  });

  it("defaults stage to 'default' for unknown/missing stage values", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,nonsense,and,action,category,set,Food",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules[0].stage).toBe("default");
  });

  it("accepts pre and post as valid stages", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,pre,and,action,category,set,Food",
      "r2,post,and,action,category,set,Food",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules[0].stage).toBe("pre");
    expect(result.rules[1].stage).toBe("post");
  });

  it("skips rules with no conditions and no actions", () => {
    // A rule group with only rows that have no field will produce nothing
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,,,,",  // no row_type and no field
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules).toHaveLength(0);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("handles oneOf pipe-separated values", () => {
    const maps = makeMaps([
      { id: "p1", name: "Amazon" },
      { id: "p2", name: "Netflix" },
    ]);
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,payee,oneOf,Amazon|Netflix",
    ].join("\n");

    const result = importRulesFromCsv(csv, maps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(Array.isArray(result.rules[0].conditions[0].value)).toBe(true);
    expect(result.rules[0].conditions[0].value).toEqual(["p1", "p2"]);
  });

  it("imports a template action (op=set-template) with options.template set", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,action,notes,set-template,{{regex imported_payee 'foo' 'bar'}}",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const action = result.rules[0].actions[0];
    expect(action.op).toBe("set");
    expect(action.value).toBe("");
    expect(action.options).toEqual({ template: "{{regex imported_payee 'foo' 'bar'}}" });
  });

  it("imports an empty-string template action (op=set-template, blank value)", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,action,notes,set-template,",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const action = result.rules[0].actions[0];
    expect(action.op).toBe("set");
    expect(action.options).toEqual({ template: "" });
  });

  it("assigns fresh IDs to imported rules (not the original rule_id)", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "original-id,default,and,action,category,set,Food",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules[0].id).not.toBe("original-id");
    expect(result.rules[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("imports a delete-transaction action (no field)", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,notes,contains,junk",
      "r1,,,action,,delete-transaction,",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules[0].actions).toHaveLength(1);
    expect(result.rules[0].actions[0].op).toBe("delete-transaction");
    expect(result.rules[0].actions[0].field).toBeUndefined();
  });

  it("imports prepend-notes and append-notes actions", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,action,notes,prepend-notes,prefix:",
      "r1,,,action,notes,append-notes,:suffix",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules[0].actions).toHaveLength(2);
    expect(result.rules[0].actions[0]).toMatchObject({ op: "prepend-notes", value: "prefix:" });
    expect(result.rules[0].actions[1]).toMatchObject({ op: "append-notes", value: ":suffix" });
  });

  it("coerces cleared field value to boolean on import", () => {
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,action,cleared,set,true",
      "r2,default,and,action,cleared,set,false",
    ].join("\n");

    const result = importRulesFromCsv(csv, emptyMaps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules[0].actions[0].value).toBe(true);
    expect(result.rules[1].actions[0].value).toBe(false);
  });

  it("resolves category_group names to IDs", () => {
    const maps = makeMaps([], [], [], [{ id: "grp-1", name: "Food & Dining" }]);
    const csv = [
      "rule_id,stage,conditions_op,row_type,field,op,value",
      "r1,default,and,condition,category_group,is,Food & Dining",
    ].join("\n");

    const result = importRulesFromCsv(csv, maps);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rules[0].conditions[0].value).toBe("grp-1");
  });
});

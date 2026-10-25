import { conditionMatches, describeRule, linkRuleInputSchema, ruleMatches, ruleWhere, type RuleCondition, type RuleRow } from "./linkRules";

const row = (extra: Partial<RuleRow> = {}): RuleRow => ({ accountId: "bank", payeeId: "tenant", payeeName: "Tenant Ltd", categoryId: "inc", categoryName: "Rent", notes: "Unit 4 rent #unit-4", amountMinor: 150000, ...extra });
const c = (field: RuleCondition["field"], operator: RuleCondition["operator"], value: string, value2?: string): RuleCondition => ({ field, operator, value, ...(value2 ? { value2 } : {}) });

it("evaluates every field with its operations, case-insensitively and by whole tag", () => {
  expect(conditionMatches(c("payee", "equals", "tenant"), row())).toBe(true); // a chosen payee record, by id
  expect(conditionMatches(c("payee", "contains", "tenant ltd"), row())).toBe(true);
  expect(conditionMatches(c("payee", "notContains", "bank"), row())).toBe(true);
  expect(conditionMatches(c("category", "startsWith", "ren"), row())).toBe(true);
  expect(conditionMatches(c("account", "notEquals", "bank"), row())).toBe(false);
  expect(conditionMatches(c("notes", "hasTag", "#UNIT-4"), row())).toBe(true);
  expect(conditionMatches(c("notes", "hasTag", "#unit"), row())).toBe(false); // a tag is a whole token
  expect(conditionMatches(c("notes", "doesNotHaveTag", "unit-9"), row())).toBe(true);
  expect(conditionMatches(c("amount", "greaterThan", "1000"), row())).toBe(true);
  expect(conditionMatches(c("amount", "between", "-500", "-100"), row({ amountMinor: -35000 }))).toBe(true);
  expect(conditionMatches(c("amount", "lessThan", "0"), row())).toBe(false);
});
it("joins conditions with all or any", () => {
  const conditions = [c("payee", "equals", "tenant"), c("notes", "hasTag", "#other")];
  expect(ruleMatches({ match: "all", conditions }, row())).toBe(false);
  expect(ruleMatches({ match: "any", conditions }, row())).toBe(true);
});
it("builds a superset ActualQL clause, leaving negations to the exact check", () => {
  expect(ruleWhere({ match: "all", conditions: [c("payee", "equals", "tenant"), c("notes", "doesNotHaveTag", "x"), c("amount", "greaterThan", "10")] })).toEqual({ $and: [{ payee: "tenant" }, { amount: { $gt: 1000 } }] });
  expect(ruleWhere({ match: "any", conditions: [c("payee", "contains", "fuel"), c("category", "equals", "fuel-cat")] })).toEqual({ $or: [{ "payee.name": { $like: "%fuel%" } }, { category: "fuel-cat" }] });
  expect(ruleWhere({ match: "any", conditions: [c("payee", "contains", "a"), c("notes", "notContains", "b")] })).toBeUndefined(); // one condition cannot be pushed down
});
it("rejects combinations that can never match and unreadable values", () => {
  const parse = (conditions: unknown[]) => linkRuleInputSchema.safeParse({ name: "r", match: "all", conditions, classification: null });
  expect(parse([c("account", "contains", "x")]).success).toBe(false);
  expect(parse([c("amount", "equals", "abc")]).success).toBe(false);
  expect(parse([c("notes", "hasTag", "has space")]).success).toBe(false);
  expect(parse([c("amount", "between", "1", "2")]).success).toBe(true);
});
it("describes a rule in words", () => {
  const names = { payee: () => "Tenant", category: () => "Rent", account: () => "Bank" };
  expect(describeRule({ match: "all", conditions: [c("payee", "equals", "tenant"), c("amount", "between", "10", "20")] }, names)).toBe("payee is Tenant and amount is between 10 and 20");
});

import { z } from "zod";
import { parseMajorToMinor } from "@/features/assets-debt/lib/money";

/**
 * Transaction conditions written like a reconciliation transform: field → operation → value, joined by "all" or "any".
 * Shared by saved rules (for example an asset's link rules) and the transaction picker's Advanced filter. A condition only
 * describes which transactions match; nothing here writes anywhere.
 */
export type RuleField = "payee" | "category" | "account" | "notes" | "amount";
export type RuleOperator = "equals" | "notEquals" | "contains" | "notContains" | "startsWith" | "endsWith" | "hasTag" | "doesNotHaveTag" | "greaterThan" | "lessThan" | "between";
const TEXT_OPS: RuleOperator[] = ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"];
export const RULE_FIELDS: { id: RuleField; label: string }[] = [
  { id: "payee", label: "Payee" }, { id: "category", label: "Category" }, { id: "account", label: "Account" }, { id: "notes", label: "Notes" }, { id: "amount", label: "Amount" },
];
export const OPERATORS_BY_FIELD: Record<RuleField, RuleOperator[]> = {
  payee: TEXT_OPS, category: TEXT_OPS, account: ["equals", "notEquals"],
  notes: ["hasTag", "doesNotHaveTag", ...TEXT_OPS], amount: ["equals", "notEquals", "greaterThan", "lessThan", "between"],
};
export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: "is", notEquals: "is not", contains: "contains", notContains: "does not contain", startsWith: "starts with", endsWith: "ends with",
  hasTag: "has tag", doesNotHaveTag: "does not have tag", greaterThan: "is more than", lessThan: "is less than", between: "is between",
};
/** Payee, category and account "is / is not" compare a chosen record (its id); every other comparison reads text. */
export const comparesRecord = (c: Pick<RuleCondition, "field" | "operator">) => (c.field === "payee" || c.field === "category" || c.field === "account") && (c.operator === "equals" || c.operator === "notEquals");

export const ruleConditionSchema = z.object({
  field: z.enum(["payee", "category", "account", "notes", "amount"]),
  operator: z.enum(["equals", "notEquals", "contains", "notContains", "startsWith", "endsWith", "hasTag", "doesNotHaveTag", "greaterThan", "lessThan", "between"]),
  value: z.string().trim().max(300), value2: z.string().trim().max(300).optional(),
}).strict().superRefine((c, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!OPERATORS_BY_FIELD[c.field].includes(c.operator)) return issue(`“${RULE_FIELDS.find((f) => f.id === c.field)!.label}” cannot be compared with “${OPERATOR_LABELS[c.operator]}”`);
  if (!c.value) return issue("Enter a value for every condition");
  if (c.field === "amount") {
    const a = parseAmount(c.value); const b = c.operator === "between" ? parseAmount(c.value2 ?? "") : null;
    if (a === null || (c.operator === "between" && b === null)) return issue("Enter amounts such as 1500.00 (negative for money out)");
    if (b !== null && a > b) return issue("The first amount must not exceed the second");
  }
  if (c.field === "notes" && (c.operator === "hasTag" || c.operator === "doesNotHaveTag") && !/^#?[\p{L}\p{N}_-]+$/u.test(c.value)) issue("A tag is letters, digits, _ or -, such as #unit-4");
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
/** Conditions joined by "all" or "any". */
export type ConditionSet = { match: "all" | "any"; conditions: RuleCondition[] };
/** Signed minor units from text such as "-350.00"; null when it is not an amount. */
export function parseAmount(text: string): number | null {
  const negative = text.trim().startsWith("-"); const parsed = parseMajorToMinor(text.trim().replace(/^[+-]/, ""), 2);
  return parsed.ok && parsed.value !== null ? (negative ? -parsed.value : parsed.value) : null;
}
/** The fields of a transaction a rule can read. */
export type RuleRow = { accountId: string; payeeId: string | null; payeeName: string | null; categoryId: string | null; categoryName: string | null; notes: string | null; amountMinor: number };
const lower = (v: string | null | undefined) => (v ?? "").toLocaleLowerCase();
/** The complete `#tag` tokens in Notes, lower case, so `#unit` never matches `#unit-4`. */
export const tagsOf = (notes: string | null | undefined): string[] => [...new Set((notes ?? "").toLocaleLowerCase().match(/(?<![\p{L}\p{N}_#])#[\p{L}\p{N}_-]+/gu) ?? [])];
function textMatches(operator: RuleOperator, haystack: string, needle: string): boolean {
  const h = lower(haystack); const n = lower(needle);
  switch (operator) {
    case "contains": return h.includes(n); case "notContains": return !h.includes(n); case "equals": return h === n; case "notEquals": return h !== n;
    case "startsWith": return h.startsWith(n); case "endsWith": return h.endsWith(n); default: return false;
  }
}
export function conditionMatches(c: RuleCondition, row: RuleRow): boolean {
  if (comparesRecord(c)) {
    const id = c.field === "payee" ? row.payeeId : c.field === "category" ? row.categoryId : row.accountId;
    return c.operator === "equals" ? id === c.value : id !== c.value;
  }
  if (c.field === "amount") {
    const a = parseAmount(c.value); const b = parseAmount(c.value2 ?? "");
    if (a === null) return false;
    switch (c.operator) {
      case "equals": return row.amountMinor === a; case "notEquals": return row.amountMinor !== a;
      case "greaterThan": return row.amountMinor > a; case "lessThan": return row.amountMinor < a;
      case "between": return b !== null && row.amountMinor >= a && row.amountMinor <= b; default: return false;
    }
  }
  if (c.field === "notes" && (c.operator === "hasTag" || c.operator === "doesNotHaveTag")) {
    const tag = `#${c.value.replace(/^#/, "")}`.toLocaleLowerCase(); const has = tagsOf(row.notes).includes(tag);
    return c.operator === "hasTag" ? has : !has;
  }
  const text = c.field === "payee" ? row.payeeName : c.field === "category" ? row.categoryName : row.notes;
  return textMatches(c.operator, text ?? "", c.value);
}
/** Exact evaluation of a rule against one transaction. */
export const ruleMatches = (rule: ConditionSet, row: RuleRow): boolean =>
  rule.match === "all" ? rule.conditions.every((c) => conditionMatches(c, row)) : rule.conditions.some((c) => conditionMatches(c, row));

/** A superset ActualQL clause for one condition, so the query stays small; null when it can only be judged client-side. */
function clauseOf(c: RuleCondition): object | null {
  const like = (field: string, pattern: string) => ({ [field]: { $like: pattern } });
  if (c.field === "amount") {
    const a = parseAmount(c.value); const b = parseAmount(c.value2 ?? "");
    if (a === null) return null;
    switch (c.operator) {
      case "equals": return { amount: a }; case "notEquals": return { amount: { $ne: a } }; case "greaterThan": return { amount: { $gt: a } }; case "lessThan": return { amount: { $lt: a } };
      case "between": return b === null ? null : { $and: [{ amount: { $gte: a } }, { amount: { $lte: b } }] }; default: return null;
    }
  }
  // "is not" is judged on the rows that come back: a row with no payee or category satisfies it, but SQL "!=" would drop it.
  if (comparesRecord(c)) return c.operator === "equals" ? { [c.field]: c.value } : null;
  const field = c.field === "payee" ? "payee.name" : c.field === "category" ? "category.name" : "notes";
  if (c.field === "notes" && c.operator === "hasTag") return like("notes", `%#${c.value.replace(/^#/, "")}%`);
  switch (c.operator) {
    case "contains": return like(field, `%${c.value}%`); case "equals": return like(field, c.value);
    case "startsWith": return like(field, `${c.value}%`); case "endsWith": return like(field, `%${c.value}`);
    default: return null; // negations are checked on the rows that come back
  }
}
export function ruleWhere(rule: ConditionSet): object | undefined {
  const clauses = rule.conditions.map(clauseOf);
  if (rule.match === "any") return clauses.every(Boolean) ? { $or: clauses as object[] } : undefined;
  const known = clauses.filter((c): c is object => !!c);
  return known.length ? { $and: known } : undefined;
}
export function describeRule(rule: ConditionSet, names: { payee: (id: string) => string; category: (id: string) => string; account: (id: string) => string }): string {
  const words = rule.conditions.map((c) => {
    const field = RULE_FIELDS.find((f) => f.id === c.field)!.label.toLocaleLowerCase();
    const value = comparesRecord(c) ? names[c.field as "payee" | "category" | "account"](c.value) : c.field === "notes" && c.operator.endsWith("Tag") ? `#${c.value.replace(/^#/, "")}` : c.operator === "between" ? `${c.value} and ${c.value2}` : c.field === "amount" ? c.value : `“${c.value}”`;
    return `${field} ${OPERATOR_LABELS[c.operator]} ${value}`;
  });
  return words.join(rule.match === "all" ? " and " : " or ");
}

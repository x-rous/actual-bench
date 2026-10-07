import { z } from "zod";

/** Bench-owned repayment matching DSL v1. It is never serialized as an Actual rule. */

const safeMinor = z.number().int().nonnegative().refine(Number.isSafeInteger, "must be a safe integer");
const positiveMinor = safeMinor.refine((value) => value > 0, "must be greater than zero");
const id = z.string().min(1).max(500);
const text = z.string().min(1).max(2_000);

const sourceAccount = z.strictObject({ kind: z.literal("source-account"), accountId: id });
const payee = z.discriminatedUnion("operator", [
  z.strictObject({ kind: z.literal("payee"), operator: z.literal("exact"), payeeId: id }),
  z.strictObject({ kind: z.literal("payee"), operator: z.literal("one-of"), payeeIds: z.array(id).min(1).max(500) }),
]);
const importedPayee = z.discriminatedUnion("operator", [
  z.strictObject({ kind: z.literal("imported-payee"), operator: z.enum(["exact", "contains"]), value: text }),
  z.strictObject({ kind: z.literal("imported-payee"), operator: z.literal("one-of"), values: z.array(text).min(1).max(500) }),
]);
const notes = z.strictObject({ kind: z.literal("notes"), operator: z.enum(["exact", "contains"]), value: text });
const amount = z.discriminatedUnion("operator", [
  z.strictObject({ kind: z.literal("amount"), operator: z.literal("exact"), amountMinor: safeMinor, direction: z.enum(["outflow", "inflow", "either"]) }),
  z.strictObject({
    kind: z.literal("amount"),
    operator: z.literal("approximate"),
    amountMinor: safeMinor,
    direction: z.enum(["outflow", "inflow", "either"]),
    tolerance: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("absolute"), amountMinor: safeMinor }),
      z.strictObject({ kind: z.literal("basis-points"), bps: z.number().int().min(0).max(10_000) }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("amount"),
    operator: z.literal("between"),
    minMinor: safeMinor,
    maxMinor: safeMinor,
    direction: z.enum(["outflow", "inflow", "either"]),
  }),
]);
const expectedDate = z.strictObject({ kind: z.literal("expected-date"), daysBefore: z.number().int().min(0).max(3660), daysAfter: z.number().int().min(0).max(3660) });
const dayOfMonth = z.strictObject({ kind: z.literal("day-of-month"), day: z.number().int().min(1).max(31) });
const clearedState = z.strictObject({ kind: z.literal("cleared-state"), value: z.enum(["any", "cleared", "uncleared"]) });
const reconciledState = z.strictObject({ kind: z.literal("reconciled-state"), value: z.enum(["any", "reconciled", "unreconciled"]) });
const category = z.discriminatedUnion("operator", [
  z.strictObject({ kind: z.literal("category"), operator: z.literal("empty") }),
  z.strictObject({ kind: z.literal("category"), operator: z.literal("exact"), categoryId: id }),
  z.strictObject({ kind: z.literal("category"), operator: z.literal("one-of"), categoryIds: z.array(id).min(1).max(500) }),
]);
const transferState = z.strictObject({ kind: z.literal("transfer-state"), value: z.enum(["none", "present"]) });
const splitState = z.strictObject({ kind: z.literal("split-state"), value: z.enum(["single", "parent", "child"]) });
const benchMarker = z.strictObject({ kind: z.literal("bench-marker"), value: z.literal("exclude") });
const postingLink = z.strictObject({ kind: z.literal("posting-link"), value: z.literal("exclude") });

export const matchConditionV1Schema = z.union([
  sourceAccount,
  payee,
  importedPayee,
  notes,
  amount,
  expectedDate,
  dayOfMonth,
  clearedState,
  reconciledState,
  category,
  transferState,
  splitState,
  benchMarker,
  postingLink,
]);

export const matchConditionsV1Schema = z.strictObject({
  format: z.literal("rd084.debt-match-conditions"),
  version: z.literal(1),
  operator: z.enum(["all", "any"]),
  items: z.array(matchConditionV1Schema).min(1).max(100),
}).superRefine((value, ctx) => {
  for (const [index, item] of value.items.entries()) {
    if (item.kind === "amount" && item.operator === "between" && item.minMinor > item.maxMinor) {
      ctx.addIssue({ code: "custom", path: ["items", index, "maxMinor"], message: "must be at least minMinor" });
    }
    if (item.kind === "amount" && item.operator === "approximate" && item.tolerance.kind === "basis-points" && item.amountMinor === 0) {
      ctx.addIssue({ code: "custom", path: ["items", index, "amountMinor"], message: "cannot be zero with a basis-points tolerance" });
    }
  }
});

const actionSchema = z.union([
  z.strictObject({ kind: z.literal("link-repayment") }),
  z.strictObject({ kind: z.literal("categorize-full-payment"), categoryId: id }),
  z.strictObject({ kind: z.literal("split-components"), components: z.array(z.strictObject({ componentKey: id, amountMinor: positiveMinor })).min(1).max(50) }),
  z.strictObject({ kind: z.literal("set-interest-category"), categoryId: id }),
  z.strictObject({ kind: z.literal("set-fee-category"), categoryId: id }),
  z.strictObject({ kind: z.literal("set-principal-transfer-target"), accountId: id }),
  z.strictObject({ kind: z.literal("mark-extra-repayment") }),
  z.strictObject({ kind: z.literal("ignore") }),
]);

export const matchActionsV1Schema = z.strictObject({
  format: z.literal("rd084.debt-match-actions"),
  version: z.literal(1),
  items: z.array(actionSchema).min(1).max(100),
}).superRefine((value, ctx) => {
  if (value.items.some((item) => item.kind === "ignore") && value.items.length !== 1) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "ignore must be the only action" });
  }
});

export type MatchConditionV1 = z.infer<typeof matchConditionV1Schema>;
export type MatchConditionsV1 = z.infer<typeof matchConditionsV1Schema>;
export type MatchActionV1 = z.infer<typeof actionSchema>;
export type MatchActionsV1 = z.infer<typeof matchActionsV1Schema>;

export class MatchDslValidationError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "MatchDslValidationError";
    this.issues = issues;
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new MatchDslValidationError(result.error.issues.map((issue) => ({
      path: issue.path.map(String).join(".") || "(document)",
      message: issue.message,
    })));
  }
  return result.data;
}

function json(input: string, field: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new MatchDslValidationError([{ path: field, message: "must be valid JSON" }]);
  }
}

export const parseMatchConditionsV1 = (input: unknown): MatchConditionsV1 => parse(matchConditionsV1Schema, input);
export const parseMatchActionsV1 = (input: unknown): MatchActionsV1 => parse(matchActionsV1Schema, input);

export function parseStoredMatchRule(input: { ruleFormatVersion: number; conditionsJson: string; actionsJson: string }): {
  conditions: MatchConditionsV1;
  actions: MatchActionsV1;
} {
  if (input.ruleFormatVersion !== 1) {
    throw new MatchDslValidationError([{ path: "ruleFormatVersion", message: `unsupported matching rule version ${input.ruleFormatVersion}` }]);
  }
  return {
    conditions: parseMatchConditionsV1(json(input.conditionsJson, "conditionsJson")),
    actions: parseMatchActionsV1(json(input.actionsJson, "actionsJson")),
  };
}

export function enabledRuleSafetyIssues(conditions: MatchConditionsV1): string[] {
  const kinds = new Set(conditions.items.map((item) => item.kind));
  return [
    ...(!kinds.has("bench-marker") ? ["An enabled rule must exclude Bench-marked transactions."] : []),
    ...(!kinds.has("posting-link") ? ["An enabled rule must exclude transactions already linked to a posting."] : []),
  ];
}

export type MatchRuleStrength = "strong" | "weak";

export function matchRuleStrength(conditions: MatchConditionsV1): { strength: MatchRuleStrength; reasons: string[] } {
  const evidence = new Set(conditions.items.map((item) => item.kind).filter((kind) => !["bench-marker", "posting-link", "cleared-state", "reconciled-state"].includes(kind)));
  const hasAmountOrDate = evidence.has("amount") || evidence.has("expected-date") || evidence.has("day-of-month");
  const hasEntity = evidence.has("source-account") || evidence.has("payee") || evidence.has("category") || evidence.has("transfer-state") || evidence.has("split-state");
  const reasons = [
    ...(conditions.operator === "any" ? ["ANY rules are broad because one condition can match by itself."] : []),
    ...(!hasAmountOrDate ? ["Add amount or date evidence."] : []),
    ...(!hasEntity ? ["Add account, payee, category, transfer or split evidence."] : []),
  ];
  return { strength: reasons.length ? "weak" : "strong", reasons };
}

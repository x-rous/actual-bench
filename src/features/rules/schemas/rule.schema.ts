import { z } from "zod";

const amountRangeSchema = z.object({
  num1: z.number(),
  num2: z.number(),
});

const recurConfigSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).optional(),
  patterns: z.array(z.object({ value: z.number(), type: z.string() })).optional(),
  skipWeekend: z.boolean().optional(),
  start: z.string(),
  endMode: z.enum(["never", "after_n_occurrences", "on_date"]),
  endOccurrences: z.number().int().min(1).optional(),
  endDate: z.string().optional(),
  weekendSolveMode: z.enum(["before", "after"]).optional(),
});

/**
 * The `options` bag. Every key Actual can store must be representable here — Zod strips unknown
 * keys, so a narrower schema silently rewrites the user's rule when it is used to parse one
 * (F-118). Cross-field rules that need the surrounding part live on `conditionOrActionSchema`.
 */
const optionsSchema = z
  .object({
    template: z.string().optional(),
    formula: z.string().optional(),
    splitIndex: z.number().int().min(0).optional(),
    method: z.enum(["fixed-amount", "fixed-percent", "formula", "remainder"]).optional(),
    inflow: z.boolean().optional(),
    outflow: z.boolean().optional(),
  })
  .refine((o) => !(o.template !== undefined && o.formula !== undefined), {
    message: "template and formula are mutually exclusive",
  })
  .refine((o) => !(o.inflow === true && o.outflow === true), {
    message: "inflow and outflow are mutually exclusive",
  });

const conditionOrActionSchema = z
  .object({
    field: z.string().min(1).optional(),
    op: z.string().min(1),
    value: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.string()),
      amountRangeSchema,
      recurConfigSchema,
    ]),
    type: z.string().optional(),
    options: optionsSchema.optional(),
  })
  .refine((part) => part.options?.method === undefined || part.op === "set-split-amount", {
    message: "options.method is only valid on a set-split-amount action",
    path: ["options", "method"],
  })
  .refine(
    (part) =>
      (part.options?.inflow === undefined && part.options?.outflow === undefined) ||
      part.field === "amount",
    {
      message: "options.inflow/outflow are only valid on an amount condition",
      path: ["options"],
    }
  )
  .refine(
    (part) =>
      part.op !== "set-split-amount" ||
      (part.options?.method !== undefined && part.options.splitIndex !== undefined),
    {
      message: "a set-split-amount action needs both options.method and options.splitIndex",
      path: ["options"],
    }
  );

export const ruleSchema = z.object({
  id: z.string().min(1),
  stage: z.enum(["pre", "default", "post"]),
  conditionsOp: z.enum(["and", "or"]),
  conditions: z.array(conditionOrActionSchema),
  actions: z.array(conditionOrActionSchema),
});

export type RuleFormValues = z.infer<typeof ruleSchema>;

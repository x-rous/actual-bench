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

const basePartSchema = z
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
  });

const hasDirectionFlag = (part: z.infer<typeof basePartSchema>): boolean =>
  part.options?.inflow !== undefined || part.options?.outflow !== undefined;

/**
 * `inflow`/`outflow` narrow which side of a transaction an *amount condition* matches. There is
 * no such thing on an action — `set amount` writes a value, it does not match one — so the check
 * has to know which array the part came from, not just what its field is.
 */
const conditionSchema = basePartSchema
  .refine((part) => !hasDirectionFlag(part) || part.field === "amount", {
    message: "options.inflow/outflow are only valid on an amount condition",
    path: ["options"],
  })
  // An allocation says how much of a transaction a split child takes. There is no such thing to
  // *match* on, so it is an action and only an action.
  .refine((part) => part.op !== "set-split-amount", {
    message: "set-split-amount is an action, not a condition",
    path: ["op"],
  });

const actionSchema = basePartSchema
  .refine((part) => !hasDirectionFlag(part), {
    message: "options.inflow/outflow are not valid on an action",
    path: ["options"],
  })
  // `splitIndex` must name a child: 0 (or absent) is the parent transaction, which has no
  // allocation of its own. `validateSplitStructure` reports the same thing as an orphan.
  .refine(
    (part) =>
      part.op !== "set-split-amount" ||
      (part.options?.method !== undefined &&
        part.options.splitIndex !== undefined &&
        part.options.splitIndex > 0),
    {
      message:
        "a set-split-amount action needs options.method and an options.splitIndex above 0",
      path: ["options"],
    }
  );

export const ruleSchema = z.object({
  id: z.string().min(1),
  stage: z.enum(["pre", "default", "post"]),
  conditionsOp: z.enum(["and", "or"]),
  conditions: z.array(conditionSchema),
  actions: z.array(actionSchema),
});

export type RuleFormValues = z.infer<typeof ruleSchema>;

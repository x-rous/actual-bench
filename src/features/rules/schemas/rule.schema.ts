import { z } from "zod";

const amountRangeSchema = z.object({
  num1: z.number(),
  num2: z.number(),
});

const recurConfigSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().optional(),
  patterns: z.array(z.object({ value: z.number(), type: z.string() })).optional(),
  skipWeekend: z.boolean().optional(),
  start: z.string(),
  endMode: z.enum(["never", "after_n_occurrences", "on_date"]),
  endOccurrences: z.number().optional(),
  endDate: z.string().optional(),
  weekendSolveMode: z.enum(["before", "after"]).optional(),
});

const conditionOrActionSchema = z.object({
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
  options: z.object({ template: z.string().optional() }).optional(),
});

export const ruleSchema = z.object({
  id: z.string().min(1),
  stage: z.enum(["pre", "default", "post"]),
  conditionsOp: z.enum(["and", "or"]),
  conditions: z.array(conditionOrActionSchema),
  actions: z.array(conditionOrActionSchema),
});

export type RuleFormValues = z.infer<typeof ruleSchema>;

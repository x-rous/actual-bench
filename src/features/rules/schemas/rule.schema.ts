import { z } from "zod";

const conditionOrActionSchema = z.object({
  field: z.string().min(1).optional(),
  op: z.string().min(1),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.string()),
    z.object({ num1: z.number(), num2: z.number() }),
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

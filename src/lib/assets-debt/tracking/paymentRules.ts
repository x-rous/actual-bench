import { z } from "zod";
import { ruleConditionSchema } from "@/lib/transactions/conditions";

/**
 * A loan's payment rule, as the user enters it: it finds repayments that are not transfers into the loan account.
 * Client-safe, so the rules dialog validates with the same schema the server saves with.
 */
export const paymentRuleInputSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1, "Name the rule").max(100),
  match: z.enum(["all", "any"]),
  conditions: z.array(ruleConditionSchema).min(1, "Add at least one condition").max(20),
}).strict();
export type PaymentRuleInput = z.infer<typeof paymentRuleInputSchema>;

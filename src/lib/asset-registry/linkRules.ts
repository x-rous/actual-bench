import { z } from "zod";
import { idSchema } from "./models";
import { ruleConditionSchema } from "@/lib/transactions/conditions";

/** Everything about conditions (fields, operations, matching, ActualQL) lives in the shared module; link rules just save them. */
export * from "@/lib/transactions/conditions";
/**
 * A saved rule for linking Actual income and expense rows to an asset: conditions joined by "all" or "any". A rule only
 * describes which transactions to propose; nothing links until the owner reviews the matches and confirms.
 */
export const linkRuleInputSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1, "Name the rule").max(100),
  match: z.enum(["all", "any"]),
  conditions: z.array(ruleConditionSchema).min(1, "Add at least one condition").max(20),
}).strict();
export type LinkRuleInput = z.infer<typeof linkRuleInputSchema>;
export type LinkRule = Omit<LinkRuleInput, "id"> & { id: string; assetId: string; updatedAt: string };


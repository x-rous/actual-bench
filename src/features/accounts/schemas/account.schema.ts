import { z } from "zod";

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Name is required").max(100, "Name cannot exceed 100 characters"),
  offBudget: z.boolean(),
  closed: z.boolean(),
  initialBalance: z.number().optional(),
});

/** Used for the create/edit form — id is not included */
export const accountFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name cannot exceed 100 characters"),
  offBudget: z.boolean(),
  initialBalance: z.number().optional(),
});

export type AccountFormValues = z.infer<typeof accountFormSchema>;

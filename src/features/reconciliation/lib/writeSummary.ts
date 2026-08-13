import {
  classifyPlan,
  type ApplyPlan,
} from "@/lib/reconciliation/apply/operations";

export type WriteSummary = ReturnType<typeof classifyPlan>;

function counted(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * Name the two kinds of work without hiding either one.
 *
 * An enrichment is a write, but it does not change the user's curated payee,
 * notes or category. Calling both kinds "changes" is what made a review full
 * of matched rows look destructive when it was only recording bank provenance.
 */
export function describeWrites({ userChanges, enrichments }: WriteSummary): string {
  const changes = counted(userChanges, "change", "changes");
  const bankDetails = counted(enrichments, "bank detail", "bank details");

  if (enrichments === 0) return changes;
  if (userChanges === 0) return bankDetails;
  return `${changes} · ${bankDetails}`;
}

export function writeActionLabel(
  verb: "Review" | "Apply",
  plan: ApplyPlan,
  options: { other?: boolean } = {}
): string {
  const prefix = options.other ? `${verb} the other` : verb;
  return `${prefix} ${describeWrites(classifyPlan(plan))}`;
}

/** The exact plan left after a drift check withholds named operations. */
export function withoutOperations(plan: ApplyPlan, operationIds: ReadonlySet<string>): ApplyPlan {
  if (operationIds.size === 0) return plan;
  return {
    ...plan,
    operations: plan.operations.filter((operation) => !operationIds.has(operation.id)),
  };
}

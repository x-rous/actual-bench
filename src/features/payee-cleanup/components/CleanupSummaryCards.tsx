import type { CleanupPlan } from "../lib/plan";

type Props = {
  plan: CleanupPlan;
};

/** One-line staged-work status for the Cleanup toolbar. */
export function PendingChangesSummary({ plan }: Props) {
  const parts = [
    plan.merges.length > 0
      ? plan.merges.length + " " + (plan.merges.length === 1 ? "merge" : "merges")
      : null,
    plan.renames.length > 0
      ? plan.renames.length + " " + (plan.renames.length === 1 ? "rename" : "renames")
      : null,
    plan.rules.length + plan.ruleExtensions.length > 0
      ? plan.rules.length + plan.ruleExtensions.length +
        " " +
        (plan.rules.length + plan.ruleExtensions.length === 1 ? "rule" : "rules")
      : null,
    plan.deletions.length > 0 ? plan.deletions.length + " deleted" : null,
  ].filter(Boolean);

  return (
    <span className="whitespace-nowrap text-xs text-muted-foreground">
      Changes: <span className="font-medium text-foreground">{parts.length > 0 ? parts.join(" · ") : "none"}</span>
    </span>
  );
}

import type { FeatureDefinition } from "./catalogue";

/** Choose the existing save pipeline, resolving entity drafts before budget drafts. */
export function getFeatureEntryState(
  feature: FeatureDefinition | undefined,
  hasEntityChanges: boolean,
  hasBudgetChanges: boolean,
) {
  const blocked = Boolean(feature?.requiresSavedData && (
    hasEntityChanges || (hasBudgetChanges && feature.pendingChangesPanel !== "budget")
  ));
  const usesBudgetActions = feature?.pendingChangesPanel === "budget"
    ? !hasEntityChanges
    : blocked && !hasEntityChanges && hasBudgetChanges;
  return {
    blocked,
    usesBudgetActions,
    showStagedActions: Boolean(feature?.usesStagedActions || blocked || (feature?.pendingChangesPanel !== "none" && hasEntityChanges)),
  };
}

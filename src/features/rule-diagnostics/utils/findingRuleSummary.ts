import type { Rule } from "@/types/entities";
import { rulePreview, type EntityMaps } from "@/features/rules/utils/rulePreview";

/**
 * A human-readable rule summary for a diagnostic finding.
 *
 * Reuses `rulePreview()` from the rules feature so diagnostics stays in lockstep
 * with the Rules table's display.
 *
 * **Not truncated.** It used to cut at 160 characters, which lost the thing the
 * reader needed most: two long rules both ended in an ellipsis and looked
 * identical when they were not, and an over-specific import rule — whose whole
 * problem is the list of bank strings it matches — was cut before the evidence
 * began. The card clamps the height instead and offers to show the rest, so the
 * decision is always available and the layout still holds.
 */
export function findingRuleSummary(rule: Rule, maps: EntityMaps): string {
  if (rule.conditions.length === 0 && rule.actions.length === 0) {
    // No conditions means `evalConditions` returns false, so this rule never fires — calling it
    // a catch-all said the opposite of what the engine does.
    return "(empty rule: no conditions, no actions)";
  }
  return rulePreview(rule, maps);
}

import type { Rule } from "@/types/entities";
import { rulePreview, type EntityMaps } from "@/features/rules/utils/rulePreview";

const MAX_SUMMARY_LENGTH = 160;

/**
 * Generate a short, human-readable rule summary for a diagnostic finding.
 * Reuses the existing rulePreview() from the rules feature so diagnostics
 * stays in lockstep with the Rules table's display. Truncates to keep
 * table rows tidy on pathological rules.
 */
export function findingRuleSummary(rule: Rule, maps: EntityMaps): string {
  if (rule.conditions.length === 0 && rule.actions.length === 0) {
    return "(catch-all rule with no actions)";
  }
  const preview = rulePreview(rule, maps);
  if (preview.length <= MAX_SUMMARY_LENGTH) return preview;
  return preview.slice(0, MAX_SUMMARY_LENGTH - 1) + "…";
}

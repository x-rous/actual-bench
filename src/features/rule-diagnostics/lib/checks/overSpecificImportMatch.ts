import type { CheckFn, Finding, RuleRef } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";
import { detectOverSpecificImportMatch } from "../overSpecificImportMatch";

/** How many of the listed strings the finding quotes before it stops. */
const SAMPLE_VALUES = 4;

/**
 * Rules matching whole import strings rather than the merchant (RD-088).
 *
 * The detection itself lives in `../overSpecificImportMatch`, because the rewrite
 * dialog needs exactly the same answer and the two disagreeing would mean a
 * finding with no fix, or a fix for a rule nothing reported.
 */
export const overSpecificImportMatch: CheckFn = (ws, ctx) => {
  const findings: Finding[] = [];

  for (const rule of ws.rules) {
    // Bench does not rewrite the conditions of a schedule's own rule.
    if (ctx.scheduleLinkedRuleIds.has(rule.id)) continue;

    const detected = detectOverSpecificImportMatch(rule);
    if (!detected) continue;

    const ruleRef: RuleRef = {
      id: rule.id,
      summary: findingRuleSummary(rule, ws.entityMaps),
    };

    const shown = detected.values.slice(0, SAMPLE_VALUES);
    const remaining = detected.values.length - shown.length;

    findings.push(
      buildFinding("RULE_OVERSPECIFIC_IMPORT_MATCH", [ruleRef], {
        field: detected.field,
        count: detected.values.length,
        stem: detected.stem,
        values: [
          ...shown,
          ...(remaining > 0 ? [`…and ${remaining} more`] : []),
        ],
      })
    );
  }

  findings.sort((a, b) => {
    const aId = a.affected[0]?.id ?? "";
    const bId = b.affected[0]?.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return findings;
};

registerCheck(overSpecificImportMatch);

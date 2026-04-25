/**
 * Internal types for the Rule Diagnostics feature.
 * Nothing here is exposed over HTTP — purely client-side analysis types.
 */

import type { Rule, ConditionOrAction } from "@/types/entities";
import type { EntityMaps } from "@/features/rules/utils/rulePreview";

// ─── Severity ────────────────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";

// ─── Finding codes ───────────────────────────────────────────────────────────

export type FindingCode =
  | "RULE_MISSING_PAYEE"
  | "RULE_MISSING_CATEGORY"
  | "RULE_MISSING_ACCOUNT"
  | "RULE_MISSING_CATEGORY_GROUP"
  | "RULE_EMPTY_ACTIONS"
  | "RULE_NOOP_ACTIONS"
  | "RULE_IMPOSSIBLE_CONDITIONS"
  | "RULE_SHADOWED"
  | "RULE_BROAD_MATCH"
  | "RULE_DUPLICATE_GROUP"
  | "RULE_NEAR_DUPLICATE_PAIR"
  | "RULE_UNSUPPORTED_CONDITION_OP"
  | "RULE_UNSUPPORTED_CONDITION_FIELD"
  | "RULE_UNSUPPORTED_ACTION_OP"
  | "RULE_UNSUPPORTED_ACTION_FIELD"
  | "RULE_TEMPLATE_ON_UNSUPPORTED_FIELD"
  | "RULE_ANALYZER_SKIPPED";

// ─── Rule identity for findings ──────────────────────────────────────────────

export type RuleRef = {
  id: string;
  summary: string;
};

// ─── Finding ─────────────────────────────────────────────────────────────────

export type Finding = {
  code: FindingCode;
  severity: Severity;
  title: string;
  message: string;
  details?: string[];
  /** Always ≥ 1 except for partition-cap RULE_ANALYZER_SKIPPED findings. */
  affected: RuleRef[];
  counterpart?: RuleRef;
};

// ─── Diagnostic report ───────────────────────────────────────────────────────

export type DiagnosticReport = {
  runAt: string;
  findings: Finding[];
  summary: {
    error: number;
    warning: number;
    info: number;
    total: number;
  };
  workingSetSignature: string;
  ruleCount: number;
};

// ─── Working set ─────────────────────────────────────────────────────────────

export type WorkingSet = {
  rules: Rule[];
  entityMaps: EntityMaps;
  entityExists: {
    payees: Set<string>;
    categories: Set<string>;
    accounts: Set<string>;
    categoryGroups: Set<string>;
  };
};

// ─── Check function contract ─────────────────────────────────────────────────

export type CheckContext = {
  partSignatures: Map<string, string[]>;
  ruleSignatures: Map<string, string>;
  rulesByPartition: Map<string, Rule[]>;
  scheduleLinkedRuleIds: Set<string>;
  fullDuplicateRuleIds: Set<string>;
};

export type CheckFn = (ws: WorkingSet, ctx: CheckContext) => Finding[];

// Re-exported for convenience within the feature.
export type { Rule, ConditionOrAction };

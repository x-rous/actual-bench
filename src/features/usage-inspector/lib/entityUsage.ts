/**
 * Pure function — no hooks. Accepts pre-resolved staged data + async results,
 * returns a fully-populated EntityUsageData.
 * Called from useEntityUsage once all data sources are available.
 */

import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import {
  buildAccountDeleteWarning,
  buildPayeeDeleteWarning,
  buildCategoryDeleteWarning,
  buildCategoryGroupDeleteWarning,
  buildScheduleDeleteWarning,
} from "@/lib/usageWarnings";
import type { StagedMap } from "@/types/staged";
import type { Rule, Category } from "@/types/entities";
import type { EntityUsageData } from "../types";

export function buildEntityUsage(params: {
  entityId: string;
  entityType: EntityUsageData["entityType"];
  entityLabel: string;
  stagedRules: StagedMap<Rule>;
  /** undefined = not yet loaded; empty Map = loaded with no results */
  txCounts: Map<string, number> | undefined;
  txLoading: boolean;
  balanceMap?: Map<string, number>;
  stagedCategories?: StagedMap<Category>;
  scheduleRuleId?: string;
  schedulePostsTransaction?: boolean;
}): EntityUsageData {
  const {
    entityId, entityType, entityLabel,
    stagedRules, txCounts, txLoading,
    balanceMap, stagedCategories,
    scheduleRuleId, schedulePostsTransaction,
  } = params;

  let ruleCount = 0;
  let txCount: number | undefined = undefined;
  let balance: number | undefined = undefined;
  let childCount: number | undefined = undefined;
  const linkedRuleId = scheduleRuleId;
  const postsTransaction = schedulePostsTransaction;
  const warnings: string[] = [];

  switch (entityType) {
    case "account": {
      ruleCount = buildRuleReferenceMap(stagedRules, ["account"]).get(entityId) ?? 0;
      balance = balanceMap?.get(entityId);
      if (!txLoading && txCounts !== undefined) txCount = txCounts.get(entityId) ?? 0;
      const hasContent = Math.abs(balance ?? 0) > 0 || ruleCount > 0 || txLoading || (txCount !== undefined && txCount > 0);
      if (hasContent) {
        warnings.push(buildAccountDeleteWarning(entityLabel, balance ?? 0, ruleCount, txCount, txLoading));
      }
      break;
    }
    case "payee": {
      ruleCount = buildRuleReferenceMap(stagedRules, ["payee", "imported_payee"]).get(entityId) ?? 0;
      if (!txLoading && txCounts !== undefined) txCount = txCounts.get(entityId) ?? 0;
      const hasContent = ruleCount > 0 || txLoading || (txCount !== undefined && txCount > 0);
      if (hasContent) {
        warnings.push(buildPayeeDeleteWarning(entityLabel, ruleCount, txCount, txLoading));
      }
      break;
    }
    case "category": {
      ruleCount = buildRuleReferenceMap(stagedRules, ["category"]).get(entityId) ?? 0;
      if (!txLoading && txCounts !== undefined) txCount = txCounts.get(entityId) ?? 0;
      const hasContent = ruleCount > 0 || txLoading || (txCount !== undefined && txCount > 0);
      if (hasContent) {
        warnings.push(buildCategoryDeleteWarning(entityLabel, ruleCount, txCount, txLoading));
      }
      break;
    }
    case "categoryGroup": {
      const children = stagedCategories
        ? Object.values(stagedCategories).filter((c) => c.entity.groupId === entityId && !c.isDeleted)
        : [];
      childCount = children.length;
      const catRuleMap = buildRuleReferenceMap(stagedRules, ["category"]);
      ruleCount = children.reduce((sum, c) => sum + (catRuleMap.get(c.entity.id) ?? 0), 0);
      if (!txLoading && txCounts !== undefined) {
        txCount = [...txCounts.values()].reduce((a, b) => a + b, 0);
      }
      const hasContent = childCount > 0 || ruleCount > 0 || txLoading || (txCount !== undefined && txCount > 0);
      if (hasContent) {
        warnings.push(buildCategoryGroupDeleteWarning(entityLabel, childCount, ruleCount, txCount, txLoading));
      }
      break;
    }
    case "schedule": {
      // Schedules are not referenced by rules — they have a linked rule, not the other way around
      ruleCount = 0;
      if (!txLoading && txCounts !== undefined) txCount = txCounts.get(entityId) ?? 0;
      const hasContent = linkedRuleId || txLoading || (txCount !== undefined && txCount > 0);
      if (hasContent) {
        warnings.push(buildScheduleDeleteWarning(entityLabel, linkedRuleId, postsTransaction ?? false, txCount, txLoading));
      }
      break;
    }
    case "tag": {
      // Tags have no rule references in the rule engine; no transaction count support
      ruleCount = 0;
      txCount = undefined;
      break;
    }
  }

  return {
    entityId,
    entityType,
    entityLabel,
    ruleCount,
    txCount,
    txLoading,
    balance,
    childCount,
    linkedRuleId,
    postsTransaction,
    warnings,
  };
}

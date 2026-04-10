"use client";

import { useMemo } from "react";
import { useStagedStore } from "@/store/staged";
import { useAccountBalances } from "@/features/accounts/hooks/useAccountBalances";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import type { TransactionCountGroupField } from "@/lib/api/query";
import { buildEntityUsage } from "../lib/entityUsage";
import type { EntityUsageData } from "../types";

/**
 * Resolves all usage data for a single entity.
 * Fires the $oneof tx-count query only when the drawer is open.
 * Returns null while entityId/entityType are null.
 */
export function useEntityUsage(
  entityId: string | null,
  entityType: EntityUsageData["entityType"] | null,
  open: boolean
): EntityUsageData | null {
  const stagedRules          = useStagedStore((s) => s.rules);
  const stagedAccounts       = useStagedStore((s) => s.accounts);
  const stagedPayees         = useStagedStore((s) => s.payees);
  const stagedCategories     = useStagedStore((s) => s.categories);
  const stagedCategoryGroups = useStagedStore((s) => s.categoryGroups);
  const stagedSchedules      = useStagedStore((s) => s.schedules);
  const stagedTags           = useStagedStore((s) => s.tags);
  const { data: balances }   = useAccountBalances();

  // Determine the groupField for the $oneof query
  const groupField = useMemo((): TransactionCountGroupField | null => {
    if (!entityType || entityType === "tag") return null;
    if (entityType === "categoryGroup") return "category"; // query by child category IDs
    const map: Partial<Record<EntityUsageData["entityType"], TransactionCountGroupField>> = {
      account: "account", payee: "payee", category: "category", schedule: "schedule",
    };
    return map[entityType] ?? null;
  }, [entityType]);

  // IDs to pass to the $oneof query
  const queryIds = useMemo((): string[] => {
    if (!entityId || !entityType || !open || !groupField) return [];
    if (entityType === "categoryGroup") {
      // Query by child category IDs (server-side only)
      return Object.values(stagedCategories)
        .filter((c) => c.entity.groupId === entityId && !c.isNew && !c.isDeleted)
        .map((c) => c.entity.id);
    }
    // For other entity types, exclude isNew (no server transactions)
    const isNewEntity = (() => {
      switch (entityType) {
        case "account":  return !!stagedAccounts[entityId]?.isNew;
        case "payee":    return !!stagedPayees[entityId]?.isNew;
        case "category": return !!stagedCategories[entityId]?.isNew;
        case "schedule": return !!stagedSchedules[entityId]?.isNew;
        default:         return false;
      }
    })();
    return isNewEntity ? [] : [entityId];
  }, [entityId, entityType, open, groupField, stagedCategories, stagedAccounts, stagedPayees, stagedSchedules]);

  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    groupField ?? "payee", // safe fallback — hook is disabled when groupField is null
    queryIds,
    { enabled: open && !!groupField && queryIds.length > 0 }
  );

  const entityLabel = useMemo((): string => {
    if (!entityId || !entityType) return "";
    switch (entityType) {
      case "account":       return stagedAccounts[entityId]?.entity.name ?? "";
      case "payee":         return stagedPayees[entityId]?.entity.name ?? "";
      case "category":      return stagedCategories[entityId]?.entity.name ?? "";
      case "categoryGroup": return stagedCategoryGroups[entityId]?.entity.name ?? "";
      case "schedule":      return stagedSchedules[entityId]?.entity.name ?? "";
      case "tag":           return stagedTags[entityId]?.entity.name ?? "";
    }
  }, [entityId, entityType, stagedAccounts, stagedPayees, stagedCategories, stagedCategoryGroups, stagedSchedules, stagedTags]);

  return useMemo(() => {
    if (!entityId || !entityType) return null;
    const schedule = entityType === "schedule" ? stagedSchedules[entityId]?.entity : undefined;
    return buildEntityUsage({
      entityId,
      entityType,
      entityLabel,
      stagedRules,
      txCounts: open && groupField ? txCounts : undefined,
      txLoading: open && !!groupField && queryIds.length > 0 && txLoading,
      balanceMap: balances,
      stagedCategories,
      scheduleRuleId: schedule?.ruleId,
      schedulePostsTransaction: schedule?.postsTransaction,
    });
  }, [
    entityId, entityType, entityLabel, stagedRules, txCounts, txLoading,
    open, groupField, queryIds.length, balances, stagedCategories, stagedSchedules,
  ]);
}

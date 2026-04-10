"use client";

import { useAccounts } from "@/features/accounts/hooks/useAccounts";
import { usePayees } from "@/features/payees/hooks/usePayees";
import { useCategoryGroups } from "@/features/categories/hooks/useCategoryGroups";
import { useRules } from "@/features/rules/hooks/useRules";
import { useSchedules } from "@/features/schedules/hooks/useSchedules";

/**
 * Prefetches all entity types in parallel so that data is available on any
 * page without waiting for page-specific hook calls.
 *
 * Call this once from AppShell so queries are always active regardless of
 * which page the user is on. TanStack Query deduplicates the requests — page-
 * level hooks that call the same fetch hook will share the cached result.
 */
export function usePreloadEntities() {
  useAccounts();
  usePayees();
  useCategoryGroups();
  useRules();
  useSchedules();
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";

// ─── Types ────────────────────────────────────────────────────────────────────

type IncomeBudgetRow = {
  month: number;    // YYYYMM integer e.g. 202507
  category: string; // category UUID
  amount: number;   // budgeted amount in minor units
  id: string;       // "YYYYMM-categoryId"
};

/** run-query always wraps its result in { data: ... } */
type RunQueryResponse = { data: IncomeBudgetRow[] };

/** Converts a YYYYMM integer to a YYYY-MM string. */
function toMonthString(n: number): string {
  const s = String(n);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Query options for the income budgets of `incomeCategoryIds` (sorted into a
 * stable key so every reader shares one cache entry). Shared by the hook and
 * by callers that need the values outside React, such as the import preview.
 */
export function incomeBudgetsQueryOptions(
  connection: ConnectionInstance | null | undefined,
  incomeCategoryIds: string[]
) {
  const sortedIds = [...incomeCategoryIds].sort();
  return {
    queryKey: ["income-budgets", connection?.id, sortedIds.join(",")] as const,
    queryFn: async (): Promise<Map<string, Map<string, number>>> => {
      if (!connection) throw new Error("No active connection");

      const response = await runQuery<RunQueryResponse>(connection, {
        ActualQLquery: {
          table: "reflect_budgets",
          filter: {
            category: { $oneof: sortedIds },
          },
          select: ["month", "category", "amount"],
        },
      });

      // Build a two-level Map: YYYY-MM → categoryId → amount.
      const result = new Map<string, Map<string, number>>();
      for (const row of response.data) {
        const monthStr = toMonthString(row.month);
        if (!result.has(monthStr)) {
          result.set(monthStr, new Map());
        }
        result.get(monthStr)!.set(row.category, row.amount);
      }
      return result;
    },
    // Income budgets change infrequently — cache aggressively.
    staleTime: 5 * 60 * 1000,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches budgeted amounts for income categories across all months via the
 * ActualQL run-query endpoint (POST /run-query, table: reflect_budgets).
 *
 * Returns a two-level Map: YYYY-MM → categoryId → budgeted amount.
 * The query returns all months at once, so the map covers the full history
 * without needing per-month fetches.
 *
 * Only enabled in Tracking mode — pass `enabled: false` to skip entirely.
 */
export function useIncomeBudgets(
  incomeCategoryIds: string[],
  enabled: boolean
): {
  data: Map<string, Map<string, number>> | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const query = useQuery({
    ...incomeBudgetsQueryOptions(connection, incomeCategoryIds),
    enabled: enabled && !!connection && incomeCategoryIds.length > 0,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}

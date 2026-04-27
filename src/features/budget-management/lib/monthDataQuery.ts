/**
 * Shared TanStack Query options for `GET /months/{month}`.
 *
 * Lives in `lib/` (no React deps) so both `useMonthData` and the
 * `MonthsDataProvider` context can import it without creating a cycle.
 */

import { apiRequest } from "@/lib/api/client";
import type { selectActiveInstance } from "@/store/connection";
import type {
  BudgetMonthSummary,
  LoadedCategory,
  LoadedGroup,
  LoadedMonthState,
} from "../types";

type ApiMonthResponse = {
  data: {
    month: string;
    incomeAvailable: number;
    lastMonthOverspent: number;
    forNextMonth: number;
    totalBudgeted: number;
    toBudget: number;
    fromLastMonth: number;
    totalIncome: number;
    totalSpent: number;
    totalBalance: number;
    categoryGroups: Array<
      | {
          id: string;
          name: string;
          is_income: false;
          hidden: boolean;
          budgeted: number | null;
          spent: number | null;
          balance: number | null;
          categories: Array<{
            id: string;
            name: string;
            is_income: false;
            hidden?: boolean;
            group_id: string;
            budgeted: number | null;
            spent: number | null;
            balance: number | null;
            carryover?: boolean;
          }>;
        }
      | {
          id: string;
          name: string;
          is_income: true;
          hidden: boolean;
          received: number | null;
          categories: Array<{
            id: string;
            name: string;
            is_income: true;
            hidden?: boolean;
            group_id: string;
            received: number | null;
          }>;
        }
    >;
  };
};

export function budgetMonthDataQueryOptions(
  connection: ReturnType<typeof selectActiveInstance>,
  month: string | null | undefined
) {
  return {
    queryKey: ["budget-month-data", connection?.id, month] as const,
    queryFn: async (): Promise<LoadedMonthState> => {
      if (!connection) throw new Error("No active connection");
      if (!month) throw new Error("No month specified");

      const response = await apiRequest<ApiMonthResponse>(
        connection,
        `/months/${month}`
      );
      const d = response.data;

      const summary: BudgetMonthSummary = {
        month: d.month,
        incomeAvailable: d.incomeAvailable,
        lastMonthOverspent: d.lastMonthOverspent,
        forNextMonth: d.forNextMonth,
        // Always store as non-positive: API may return positive or negative depending on version.
        totalBudgeted: d.totalBudgeted > 0 ? -d.totalBudgeted : d.totalBudgeted,
        toBudget: d.toBudget,
        fromLastMonth: d.fromLastMonth,
        totalIncome: d.totalIncome,
        totalSpent: d.totalSpent,
        totalBalance: d.totalBalance,
      };

      const groupsById: Record<string, LoadedGroup> = {};
      const categoriesById: Record<string, LoadedCategory> = {};
      const groupOrder: string[] = [];

      for (const g of d.categoryGroups) {
        const categoryIds: string[] = [];

        for (const c of g.categories) {
          const cat: LoadedCategory = g.is_income
            ? {
                id: c.id,
                name: c.name,
                groupId: g.id,
                groupName: g.name,
                isIncome: true,
                hidden: c.hidden ?? false,
                budgeted: 0,
                actuals: (c as { received?: number | null }).received ?? 0,
                balance: 0,
                carryover: false,
              }
            : {
                id: c.id,
                name: c.name,
                groupId: g.id,
                groupName: g.name,
                isIncome: false,
                hidden: c.hidden ?? false,
                budgeted: (c as { budgeted?: number | null }).budgeted ?? 0,
                actuals: (c as { spent?: number | null }).spent ?? 0,
                balance: (c as { balance?: number | null }).balance ?? 0,
                carryover: (c as { carryover?: boolean }).carryover ?? false,
              };
          categoriesById[c.id] = cat;
          categoryIds.push(c.id);
        }

        const group: LoadedGroup = g.is_income
          ? {
              id: g.id,
              name: g.name,
              isIncome: true,
              hidden: g.hidden,
              categoryIds,
              budgeted: 0,
              actuals: g.received ?? 0,
              balance: 0,
            }
          : {
              id: g.id,
              name: g.name,
              isIncome: false,
              hidden: g.hidden,
              categoryIds,
              budgeted: g.budgeted ?? 0,
              actuals: g.spent ?? 0,
              balance: g.balance ?? 0,
            };
        groupsById[g.id] = group;
        groupOrder.push(g.id);
      }

      return { summary, groupsById, categoriesById, groupOrder } satisfies LoadedMonthState;
    },
    enabled: !!connection && !!month,
  };
}

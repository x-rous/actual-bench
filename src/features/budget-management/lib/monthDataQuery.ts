/**
 * Shared TanStack Query options for budget-month reads.
 *
 * Lives in `lib/` (no React deps) so both `useMonthData` and the
 * `MonthsDataProvider` context can import it without creating a cycle.
 */

import { getTransport } from "@/lib/actual";
import type { TransportBudgetMonth } from "@/lib/actual/transport";
import type { selectActiveInstance } from "@/store/connection";
import type {
  BudgetMonthSummary,
  LoadedCategory,
  LoadedGroup,
  LoadedMonthState,
} from "../types";

export function getMonthDataErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

export function isMissingBudgetMonthError(
  error: unknown,
  month?: string
): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  const message = getMonthDataErrorMessage(error);
  return (
    status === 404 &&
    message.startsWith("No budget exists for month:") &&
    (!month || message.includes(month))
  );
}

export function normalizeBudgetMonthData(
  d: TransportBudgetMonth
): LoadedMonthState {
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
            budgeted: c.budgeted ?? 0,
            actuals: c.received ?? 0,
            balance: c.balance ?? 0,
            carryover: c.carryover ?? false,
          }
        : {
            id: c.id,
            name: c.name,
            groupId: g.id,
            groupName: g.name,
            isIncome: false,
            hidden: c.hidden ?? false,
            budgeted: c.budgeted ?? 0,
            actuals: c.spent ?? 0,
            balance: c.balance ?? 0,
            carryover: c.carryover ?? false,
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
          budgeted: g.budgeted ?? 0,
          actuals: g.received ?? 0,
          balance: g.balance ?? 0,
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
}

export function budgetMonthDataQueryOptions(
  connection: ReturnType<typeof selectActiveInstance>,
  month: string | null | undefined
) {
  return {
    queryKey: ["budget-month-data", connection?.id, month] as const,
    queryFn: async (): Promise<LoadedMonthState> => {
      if (!connection) throw new Error("No active connection");
      if (!month) throw new Error("No month specified");

      const d = await getTransport(connection).getBudgetMonth(month);
      return normalizeBudgetMonthData(d);
    },
    enabled: !!connection && !!month,
  };
}

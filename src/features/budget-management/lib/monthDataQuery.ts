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

// BM-07: the summary's `totalBudgeted` is the signed expense allocation. Actual
// delivers it positive in Tracking payloads and negative in Envelope payloads.
// The whole feature stores it in one canonical form — non-positive — so Envelope
// keeps its native sign and Tracking recovers its magnitude via `Math.abs`
// downstream (see fromLoadedState / trackingSummary). This is a documented,
// mode-neutral normalization, NOT an arbitrary flip.
//
// The correction here is to stop doing it *silently*: surface (dev-only, once)
// when a value is actually re-signed so a genuine transport/version contract
// change is observable in logs instead of being masked. The stored contract is
// intentionally left unchanged — every consumer depends on it.
let hasReportedBudgetSignNormalization = false;

function toSignedExpenseAllocation(totalBudgeted: number): number {
  if (totalBudgeted > 0) {
    if (
      !hasReportedBudgetSignNormalization &&
      process.env.NODE_ENV !== "production"
    ) {
      hasReportedBudgetSignNormalization = true;
      console.warn(
        "[budget] Normalized a positive summary.totalBudgeted to non-positive. " +
          "This is expected for Tracking payloads; if the active budget is Envelope, " +
          "the transport contract may have drifted."
      );
    }
    return -totalBudgeted;
  }
  return totalBudgeted;
}

export function normalizeBudgetMonthData(
  d: TransportBudgetMonth
): LoadedMonthState {
  const summary: BudgetMonthSummary = {
    month: d.month,
    incomeAvailable: d.incomeAvailable,
    lastMonthOverspent: d.lastMonthOverspent,
    forNextMonth: d.forNextMonth,
    totalBudgeted: toSignedExpenseAllocation(d.totalBudgeted),
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

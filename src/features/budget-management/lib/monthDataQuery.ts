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

// BM-08: both transports cast the month payload to a broad type without runtime
// validation, so a missing or malformed numeric summary field silently becomes
// NaN/undefined deep in the UI. Validate the boundary: coerce non-finite summary
// numbers to 0 (so nothing downstream produces NaN) AND surface the drift
// (dev-only, once) instead of masking it.
let hasReportedInvalidMonthField = false;

const SUMMARY_NUMERIC_FIELDS = [
  "incomeAvailable",
  "lastMonthOverspent",
  "forNextMonth",
  "totalBudgeted",
  "toBudget",
  "fromLastMonth",
  "totalIncome",
  "totalSpent",
  "totalBalance",
] as const;

function finiteOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function reportInvalidMonthFields(d: TransportBudgetMonth): void {
  if (process.env.NODE_ENV === "production" || hasReportedInvalidMonthField) {
    return;
  }
  const bad = SUMMARY_NUMERIC_FIELDS.filter(
    (field) => !Number.isFinite(d[field] as number)
  );
  if (bad.length > 0) {
    hasReportedInvalidMonthField = true;
    console.warn(
      `[budget] Month ${d.month ?? "?"} payload has non-numeric summary fields: ` +
        `${bad.join(", ")}. Treating them as 0 - the transport contract may have drifted.`
    );
  }
}

export function normalizeBudgetMonthData(
  d: TransportBudgetMonth
): LoadedMonthState {
  reportInvalidMonthFields(d);

  const summary: BudgetMonthSummary = {
    month: d.month,
    incomeAvailable: finiteOr0(d.incomeAvailable),
    lastMonthOverspent: finiteOr0(d.lastMonthOverspent),
    forNextMonth: finiteOr0(d.forNextMonth),
    totalBudgeted: toSignedExpenseAllocation(finiteOr0(d.totalBudgeted)),
    toBudget: finiteOr0(d.toBudget),
    fromLastMonth: finiteOr0(d.fromLastMonth),
    totalIncome: finiteOr0(d.totalIncome),
    totalSpent: finiteOr0(d.totalSpent),
    totalBalance: finiteOr0(d.totalBalance),
  };

  const groupsById: Record<string, LoadedGroup> = {};
  const categoriesById: Record<string, LoadedCategory> = {};
  const groupOrder: string[] = [];
  // BM-09: income categories whose monthly `budgeted` is absent — these (and
  // only these) need the reflect_budgets compatibility overlay. On 26.8+ the
  // month payload carries income budgets, so this stays empty and the canonical
  // monthly value is never overwritten by the fallback query.
  const incomeBudgetFallbackIds: string[] = [];

  for (const g of d.categoryGroups) {
    const categoryIds: string[] = [];

    for (const c of g.categories) {
      if (g.is_income && c.budgeted == null) incomeBudgetFallbackIds.push(c.id);
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

  return {
    summary,
    groupsById,
    categoriesById,
    groupOrder,
    incomeBudgetFallbackIds,
  } satisfies LoadedMonthState;
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

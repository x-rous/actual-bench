import { runQuery } from "./query";
import type { ConnectionInstance } from "@/store/connection";

type RawRow = { id?: unknown; value?: unknown };
type QueryResponse = { data: RawRow[] };

/** Lower-case budget mode as stored/derived from the preferences table. */
export type PreferencesBudgetMode = "tracking" | "envelope";

export type BudgetPreferences = {
  upcomingScheduledTransactionLength: number;
  budgetMode: PreferencesBudgetMode;
};

const DEFAULTS: BudgetPreferences = {
  upcomingScheduledTransactionLength: 14,
  // Absence of a `budgetType` preference means an envelope (zero-based) budget.
  budgetMode: "envelope",
};

export async function fetchBudgetPreferences(
  connection: ConnectionInstance
): Promise<BudgetPreferences> {
  const response = await runQuery<QueryResponse>(connection, {
    ActualQLquery: {
      table: "preferences",
      select: ["id", "value"],
    },
  });

  const map = new Map<string, string>();
  for (const row of response.data) {
    if (typeof row.id === "string" && typeof row.value === "string") {
      map.set(row.id, row.value);
    }
  }

  const upcomingRaw = map.get("upcomingScheduledTransactionLength");
  const upcoming = upcomingRaw !== undefined ? parseInt(upcomingRaw, 10) : NaN;

  // Budget mode is determined by the `budgetType` preference: the row exists
  // with value "tracking" for tracking budgets, and is absent for envelope
  // (zero-based) budgets. This is data-independent — a fresh/empty budget is
  // still classified correctly (unlike counting zero_budgets/reflect_budgets).
  const budgetMode: PreferencesBudgetMode =
    map.get("budgetType") === "tracking" ? "tracking" : "envelope";

  return {
    upcomingScheduledTransactionLength: Number.isFinite(upcoming) && upcoming > 0
      ? upcoming
      : DEFAULTS.upcomingScheduledTransactionLength,
    budgetMode,
  };
}

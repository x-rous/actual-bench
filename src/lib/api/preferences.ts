import { runQuery } from "./query";
import type { ConnectionInstance } from "@/store/connection";

type RawRow = { id?: unknown; value?: unknown };
type QueryResponse = { data: RawRow[] };

export type BudgetPreferences = {
  upcomingScheduledTransactionLength: number;
};

const DEFAULTS: BudgetPreferences = {
  upcomingScheduledTransactionLength: 14,
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

  return {
    upcomingScheduledTransactionLength: Number.isFinite(upcoming) && upcoming > 0
      ? upcoming
      : DEFAULTS.upcomingScheduledTransactionLength,
  };
}

import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";

export type ScheduleTxRow = {
  id: string;
  date: string;
  scheduleId: string;
};

type RawRow = { id?: unknown; date?: unknown; schedule?: unknown };
type QueryResponse = { data: RawRow[] };

function dateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildScheduleTransactionsQuery(from: string, to: string) {
  return {
    ActualQLquery: {
      table: "transactions",
      options: { splits: "inline" },
      filter: {
        schedule: { $gt: "0" },
        date: { $gte: from, $lte: to },
      },
      select: ["id", "date", "schedule"],
    },
  };
}

function parseRow(row: RawRow): ScheduleTxRow | null {
  const id         = typeof row.id       === "string" && row.id       ? row.id       : null;
  const date       = typeof row.date     === "string" && row.date     ? row.date     : null;
  const scheduleId = typeof row.schedule === "string" && row.schedule ? row.schedule : null;
  if (!id || !date || !scheduleId) return null;
  return { id, date, scheduleId };
}

/**
 * Fetches all transactions linked to any schedule in the past 2 years.
 * Returns a Map<scheduleId, ScheduleTxRow[]>.
 *
 * 2-year window covers yearly schedules (a 1-year window would miss a yearly
 * schedule whose last payment was 13 months ago).
 */
export async function fetchScheduleTransactions(
  connection: ConnectionInstance
): Promise<Map<string, ScheduleTxRow[]>> {
  const today        = dateOffset(0);
  const twoYearsAgo = dateOffset(-730);

  const response = await runQuery<QueryResponse>(
    connection,
    buildScheduleTransactionsQuery(twoYearsAgo, today)
  );

  const map = new Map<string, ScheduleTxRow[]>();
  for (const raw of response.data) {
    const row = parseRow(raw);
    if (!row) continue;
    const bucket = map.get(row.scheduleId);
    if (bucket) bucket.push(row);
    else map.set(row.scheduleId, [row]);
  }
  return map;
}

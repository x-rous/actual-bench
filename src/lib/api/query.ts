/**
 * Shared ActualQL query helper.
 *
 * Scope: intentionally narrow for internal app queries. The Query Console still
 * gates itself to HTTP API Server mode; Direct mode support here adapts the known query
 * shapes used by Budget Management, preferences, overview, and impact warnings.
 */

import { apiRequest } from "./client";
import {
  isHttpApiConnection,
  type ConnectionInstance,
} from "@/store/connection";

// ─── Generic runner ───────────────────────────────────────────────────────────

export async function runQuery<T>(
  connection: ConnectionInstance,
  body: object
): Promise<T> {
  if (isHttpApiConnection(connection)) {
    return apiRequest<T>(connection, "/run-query", {
      method: "POST",
      body,
    });
  }

  const { getTransport } = await import("../actual");
  return getTransport(connection).runQuery<T>(body);
}

// ─── Transaction counts ───────────────────────────────────────────────────────

export type TransactionCountGroupField =
  | "payee"
  | "category"
  | "account"
  | "schedule";

type TransactionCountRow = Record<string, string | number> & {
  transactionCount: number;
};

/**
 * Fetches transaction counts for a specific set of entity IDs via a single
 * $oneof-filtered ActualQL query. Returns Map<entityId, count>.
 *
 * Entities absent from the response have zero transactions; callers use
 * `map.get(id) ?? 0`.
 *
 * Guard: ids.length === 0 returns empty Map immediately, no network call.
 */
export async function getTransactionCountsForIds(
  connection: ConnectionInstance,
  groupField: TransactionCountGroupField,
  ids: string[]
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();

  const response = await runQuery<{ data: TransactionCountRow[] }>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { [groupField]: { $oneof: ids } },
      groupBy: [groupField, groupField + ".name"],
      select: [
        groupField,
        groupField + ".name",
        { transactionCount: { $count: "$id" } },
      ],
    },
  });

  const map = new Map<string, number>();
  for (const row of response.data) {
    const id = row[groupField];
    if (typeof id === "string") {
      map.set(id, row.transactionCount);
    }
  }
  return map;
}

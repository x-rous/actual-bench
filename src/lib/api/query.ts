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

function mapTransactionCounts(
  rows: TransactionCountRow[],
  groupField: TransactionCountGroupField
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const id = row[groupField];
    if (typeof id === "string") {
      map.set(id, row.transactionCount);
    }
  }
  return map;
}

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

  return mapTransactionCounts(response.data, groupField);
}

/**
 * Fetches counts for every transaction-linked entity in one grouped query.
 *
 * Unlike `getTransactionCountsForIds`, this does not serialize a potentially
 * very large entity-id list into `$oneof`. It is intended for whole-budget
 * analysis such as Payee Cleanup, where the caller needs to distinguish every
 * used payee from payees with no transactions. An entity absent from the
 * returned map has zero transactions.
 */
export async function getAllTransactionCounts(
  connection: ConnectionInstance,
  groupField: TransactionCountGroupField
): Promise<Map<string, number>> {
  const response = await runQuery<{ data: TransactionCountRow[] }>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { [groupField]: { $ne: null } },
      groupBy: [groupField, groupField + ".name"],
      select: [
        groupField,
        groupField + ".name",
        { transactionCount: { $count: "$id" } },
      ],
    },
  });

  return mapTransactionCounts(response.data, groupField);
}

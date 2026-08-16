/**
 * Reads the payee fields cleanup needs that no supported transport API returns.
 *
 * `getPayees()` resolves to `APIPayeeEntity` — `Pick<PayeeEntity, 'id' | 'name'
 * | 'transfer_acct'>` — in Direct mode, and actual-http-api's `Payee` schema is
 * `{id, name, category, transfer_acct}`. Neither carries `favorite`,
 * `learn_categories` or `tombstone`.
 *
 * Actual's AQL `payees` schema does expose all three, and Bench has ActualQL in
 * both transports, so one query covers Direct and HTTP identically.
 *
 * `category` is deliberately not selected: `DbPayee.category` is annotated
 * "Unused in the codebase" upstream, it is absent from the AQL payees schema,
 * and `payeeModel.toExternal` drops it. See F-095.
 */

import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";
import type { PayeeCleanupMetadata } from "../types";

type PayeeMetadataRow = {
  id?: unknown;
  favorite?: unknown;
  learn_categories?: unknown;
  tombstone?: unknown;
  transfer_acct?: unknown;
};

/**
 * AQL booleans arrive as SQLite 1/0 through the HTTP transport and as real
 * booleans through Direct, so both shapes are normalized here rather than at
 * each call site. Anything unrecognized is treated as false — the conservative
 * reading for `favorite` (don't claim a preference the user didn't set) and for
 * `tombstone` (a row we can see is presumed alive; eligibility still rejects it
 * if Actual says otherwise).
 */
function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value === "true";
  return false;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Loads cleanup metadata for every payee in the budget, keyed by payee id.
 *
 * Tombstoned payees are intentionally *included* in the result: the eligibility
 * boundary needs to see them to exclude them, and a caller that silently
 * filtered them here would report a smaller "analyzed" count than the budget
 * actually holds.
 */
export async function getPayeeCleanupMetadata(
  connection: ConnectionInstance
): Promise<Map<string, PayeeCleanupMetadata>> {
  const response = await runQuery<{ data: PayeeMetadataRow[] }>(connection, {
    ActualQLquery: {
      table: "payees",
      select: ["id", "favorite", "learn_categories", "tombstone", "transfer_acct"],
    },
  });

  const map = new Map<string, PayeeCleanupMetadata>();
  for (const row of response.data ?? []) {
    const id = toNullableString(row.id);
    if (!id) continue;

    map.set(id, {
      id,
      favorite: toBoolean(row.favorite),
      learnCategories: toBoolean(row.learn_categories),
      tombstone: toBoolean(row.tombstone),
      transferAccountId: toNullableString(row.transfer_acct),
    });
  }
  return map;
}

/**
 * Fallback metadata for a payee the ActualQL read did not return.
 *
 * A payee present in `getPayees()` but missing from the metadata query is
 * treated as an ordinary live payee with no preferences set — `getPayees()`
 * already excludes tombstoned rows, so the alternative (assuming tombstoned)
 * would silently drop a real cleanup candidate.
 */
export function fallbackMetadata(
  id: string,
  transferAccountId: string | null
): PayeeCleanupMetadata {
  return {
    id,
    favorite: false,
    learnCategories: false,
    tombstone: false,
    transferAccountId,
  };
}

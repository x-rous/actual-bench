/**
 * Typed API functions for the Accounts entity.
 * All functions use the shared apiRequest client and normalize API types to
 * internal Account types before returning.
 */

import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type {
  ApiAccount,
  ApiAccountInput,
  ApiListResponse,
  ApiSingleResponse,
} from "@/types/api";
import type { Account } from "@/types/entities";

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeAccount(raw: ApiAccount): Account {
  return {
    id: raw.id,
    name: raw.name,
    offBudget: raw.offbudget,
    closed: raw.closed,
  };
}

function denormalizeAccount(
  account: Pick<Account, "name" | "offBudget">
): Pick<ApiAccountInput, "name" | "offbudget"> {
  return {
    name: account.name,
    offbudget: account.offBudget,
  };
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function getAccounts(connection: ConnectionInstance): Promise<Account[]> {
  const response = await apiRequest<ApiListResponse<ApiAccount>>(
    connection,
    "/accounts"
  );
  return response.data.map(normalizeAccount);
}

export async function createAccount(
  connection: ConnectionInstance,
  input: Omit<Account, "id">
): Promise<Account> {
  // The API expects the payload wrapped in an "account" key
  const response = await apiRequest<ApiSingleResponse<ApiAccount>>(
    connection,
    "/accounts",
    { method: "POST", body: { account: denormalizeAccount(input) } }
  );
  return normalizeAccount(response.data);
}

export async function updateAccount(
  connection: ConnectionInstance,
  id: string,
  patch: Partial<Omit<Account, "id">>
): Promise<void> {
  const fields: Partial<ApiAccountInput> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.offBudget !== undefined) fields.offbudget = patch.offBudget;
  if (patch.closed !== undefined) fields.closed = patch.closed;

  // The API expects the payload wrapped in an "account" key
  await apiRequest<void>(connection, `/accounts/${id}`, {
    method: "PATCH",
    body: { account: fields },
  });
}

export async function deleteAccount(
  connection: ConnectionInstance,
  id: string
): Promise<void> {
  await apiRequest<void>(connection, `/accounts/${id}`, { method: "DELETE" });
}

// ─── Balance query ─────────────────────────────────────────────────────────────

type BalanceRow = {
  account: string;
  "account.name": string;
  balance: number;
};

/**
 * Fetches the current balance for all accounts via ActualQL aggregation.
 * Returns a Map<accountId, balance> where balance is in whole units (divided
 * by 100 from the raw cent value returned by the API).
 * Accounts with no transactions will be absent from the map.
 */
export async function getAccountBalances(
  connection: ConnectionInstance
): Promise<Map<string, number>> {
  const response = await apiRequest<{ data: BalanceRow[] }>(
    connection,
    "/run-query",
    {
      method: "POST",
      body: {
        ActualQLquery: {
          table: "transactions",
          groupBy: ["account", "account.name"],
          select: [
            "account",
            "account.name",
            { balance: { $sum: "$amount" } },
          ],
        },
      },
    }
  );

  const map = new Map<string, number>();
  for (const row of response.data) {
    map.set(row.account, row.balance / 100);
  }
  return map;
}

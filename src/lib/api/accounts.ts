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
  ApiAccountCreateInput,
  ApiListResponse,
  ApiSingleResponse,
} from "@/types/api";
import type { Account } from "@/types/entities";

// ─── Normalization ────────────────────────────────────────────────────────────

export function normalizeAccount(raw: ApiAccount): Account {
  return {
    id: raw.id,
    name: raw.name,
    offBudget: raw.offbudget,
    closed: raw.closed,
    ...(typeof raw.sort_order === "number" ? { sortOrder: raw.sort_order } : {}),
    // Absent on servers without account groups; null/absent both mean ungrouped.
    groupId: raw.account_group_id ?? null,
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

function denormalizeAccountCreate(
  account: Pick<Account, "name" | "offBudget" | "initialBalance">
): ApiAccountCreateInput {
  return {
    ...denormalizeAccount(account),
    ...(account.initialBalance !== undefined ? { initialBalance: Math.round(account.initialBalance * 100) } : {}),
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
  // The API expects the payload wrapped in an "account" key. actual-http-api answers with
  // the new account's id as a plain string (like payees and account groups); a full
  // account object is accepted too. Without the id, callers cannot save the account's
  // class or find the account they just created.
  const response = await apiRequest<ApiSingleResponse<ApiAccount | string>>(
    connection,
    "/accounts",
    { method: "POST", body: { account: denormalizeAccountCreate(input) } }
  );
  const data = response.data;
  if (typeof data === "string" && data) {
    return { id: data, name: input.name, offBudget: input.offBudget, closed: input.closed ?? false, groupId: null };
  }
  if (data && typeof data === "object" && data.id) return normalizeAccount(data);
  throw new Error("The account was created, but the server did not return its id. Refresh Accounts before retrying.");
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
  // `null` clears the group; `undefined` leaves it untouched.
  if (patch.groupId !== undefined) fields.account_group_id = patch.groupId;

  // The API expects the payload wrapped in an "account" key
  await apiRequest<void>(connection, `/accounts/${id}`, {
    method: "PATCH",
    body: { account: fields },
  });
}

/** Closes an account through actual-http-api's close endpoint, moving its balance to another account. */
export async function closeAccount(
  connection: ConnectionInstance,
  id: string,
  transfer: { transferAccountId: string; transferCategoryId?: string | null }
): Promise<void> {
  await apiRequest<void>(connection, `/accounts/${id}/close`, {
    method: "PUT",
    body: {
      transfer: {
        transferAccountId: transfer.transferAccountId,
        ...(transfer.transferCategoryId ? { transferCategoryId: transfer.transferCategoryId } : {}),
      },
    },
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

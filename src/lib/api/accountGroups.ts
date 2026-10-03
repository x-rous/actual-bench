/**
 * Typed API functions for account groups (actual-http-api `/accountgroups`).
 * Groups are a single level; their order is the server's list order.
 */

import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type { ApiAccountGroup, ApiListResponse, ApiSingleResponse } from "@/types/api";
import type { AccountGroup } from "@/types/entities";

export function normalizeAccountGroup(raw: ApiAccountGroup): AccountGroup | null {
  if (!raw.id) return null;
  return { id: raw.id, name: raw.name };
}

export async function getAccountGroups(connection: ConnectionInstance): Promise<AccountGroup[]> {
  const response = await apiRequest<ApiListResponse<ApiAccountGroup>>(connection, "/accountgroups");
  return response.data
    .map(normalizeAccountGroup)
    .filter((group): group is AccountGroup => group !== null);
}

export async function createAccountGroup(
  connection: ConnectionInstance,
  input: Pick<AccountGroup, "name">
): Promise<AccountGroup> {
  // The API expects the payload wrapped in an "account_group" key and answers with the new id.
  const response = await apiRequest<ApiSingleResponse<string>>(connection, "/accountgroups", {
    method: "POST",
    body: { account_group: { name: input.name } },
  });
  return { id: response.data, name: input.name };
}

export async function updateAccountGroup(
  connection: ConnectionInstance,
  id: string,
  patch: Partial<Pick<AccountGroup, "name">>
): Promise<void> {
  const fields: Partial<ApiAccountGroup> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  await apiRequest<void>(connection, `/accountgroups/${id}`, {
    method: "PATCH",
    body: { account_group: fields },
  });
}

/** Deleting a group keeps its accounts; the server leaves them ungrouped. */
export async function deleteAccountGroup(connection: ConnectionInstance, id: string): Promise<void> {
  await apiRequest<void>(connection, `/accountgroups/${id}`, { method: "DELETE" });
}

/**
 * True when an error from the group endpoints means "this server has no
 * account groups" (an http-api or Actual older than 26.9), not a real failure.
 */
export function isAccountGroupsUnsupported(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || status === 405 || status === 501;
}

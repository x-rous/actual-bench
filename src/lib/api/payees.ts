/**
 * Typed API functions for the Payees entity.
 */

import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type {
  ApiPayee,
  ApiPayeeInput,
  ApiListResponse,
  ApiSingleResponse,
} from "@/types/api";
import type { Payee } from "@/types/entities";

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizePayee(raw: ApiPayee): Payee {
  return {
    id: raw.id!,
    name: raw.name,
    categoryId: raw.category,
    transferAccountId: raw.transfer_acct,
  };
}

function denormalizePayee(
  payee: Pick<Payee, "name">
): Pick<ApiPayeeInput, "name"> {
  return { name: payee.name };
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function getPayees(connection: ConnectionInstance): Promise<Payee[]> {
  const response = await apiRequest<ApiListResponse<ApiPayee>>(
    connection,
    "/payees"
  );
  return response.data.map(normalizePayee);
}

export async function createPayee(
  connection: ConnectionInstance,
  input: Pick<Payee, "name">
): Promise<Payee> {
  const response = await apiRequest<ApiSingleResponse<ApiPayee>>(
    connection,
    "/payees",
    { method: "POST", body: { payee: denormalizePayee(input) } }
  );
  return normalizePayee(response.data);
}

export async function updatePayee(
  connection: ConnectionInstance,
  id: string,
  patch: Partial<Pick<Payee, "name">>
): Promise<void> {
  const fields: Partial<ApiPayeeInput> = {};
  if (patch.name !== undefined) fields.name = patch.name;

  await apiRequest<void>(connection, `/payees/${id}`, {
    method: "PATCH",
    body: { payee: fields },
  });
}

export async function deletePayee(
  connection: ConnectionInstance,
  id: string
): Promise<void> {
  await apiRequest<void>(connection, `/payees/${id}`, { method: "DELETE" });
}

export async function mergePayees(
  connection: ConnectionInstance,
  targetId: string,
  mergeIds: string[]
): Promise<void> {
  await apiRequest<void>(connection, "/payees/merge", {
    method: "POST",
    body: { targetId, mergeIds },
  });
}

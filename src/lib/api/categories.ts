/**
 * Typed API functions for the Categories entity.
 */

import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type { ApiCategoryInput } from "@/types/api";
import type { Category } from "@/types/entities";

// ─── Normalization ────────────────────────────────────────────────────────────

function denormalizeCategory(
  category: Pick<Category, "name" | "groupId" | "hidden">
): Partial<ApiCategoryInput> {
  return {
    name: category.name,
    group_id: category.groupId,
    hidden: category.hidden,
  };
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function createCategory(
  connection: ConnectionInstance,
  input: Pick<Category, "name" | "groupId" | "hidden">
): Promise<string> {
  const response = await apiRequest<{ data: string }>(
    connection,
    "/categories",
    { method: "POST", body: { category: denormalizeCategory(input) } }
  );
  return response.data;
}

export async function updateCategory(
  connection: ConnectionInstance,
  id: string,
  patch: Partial<Pick<Category, "name" | "hidden">>
): Promise<void> {
  const fields: Partial<ApiCategoryInput> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.hidden !== undefined) fields.hidden = patch.hidden;

  await apiRequest<void>(connection, `/categories/${id}`, {
    method: "PATCH",
    body: { category: fields },
  });
}

export async function deleteCategory(
  connection: ConnectionInstance,
  id: string
): Promise<void> {
  await apiRequest<void>(connection, `/categories/${id}`, {
    method: "DELETE",
  });
}

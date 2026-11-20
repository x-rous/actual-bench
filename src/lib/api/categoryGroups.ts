/**
 * Typed API functions for the Category Groups entity.
 * GET /categorygroups returns nested categories — we normalize both here.
 */

import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type {
  ApiCategoryGroup,
  ApiCategoryGroupInput,
  ApiCategory,
  ApiListResponse,
} from "@/types/api";
import type { CategoryGroup, Category } from "@/types/entities";

// ─── Normalization ────────────────────────────────────────────────────────────

export function normalizeCategoryGroup(raw: ApiCategoryGroup): CategoryGroup {
  return {
    id: raw.id!,
    name: raw.name,
    isIncome: raw.is_income ?? false,
    hidden: raw.hidden ?? false,
    categoryIds: (raw.categories ?? []).map((c) => c.id!).filter(Boolean),
  };
}

export function normalizeCategory(raw: ApiCategory, groupId: string): Category {
  return {
    id: raw.id!,
    name: raw.name,
    groupId: raw.group_id ?? groupId,
    isIncome: raw.is_income ?? false,
    hidden: raw.hidden ?? false,
  };
}

function denormalizeCategoryGroup(
  group: Pick<CategoryGroup, "name" | "isIncome" | "hidden">
): Partial<ApiCategoryGroupInput> {
  return {
    name: group.name,
    is_income: group.isIncome,
    hidden: group.hidden,
  };
}

// ─── API functions ────────────────────────────────────────────────────────────

export type CategoryGroupsResponse = {
  groups: CategoryGroup[];
  categories: Category[];
};

/** Fetches all groups with nested categories in a single call. */
export async function getCategoryGroups(
  connection: ConnectionInstance
): Promise<CategoryGroupsResponse> {
  const response = await apiRequest<ApiListResponse<ApiCategoryGroup>>(
    connection,
    "/categorygroups"
  );

  const groups: CategoryGroup[] = [];
  const categories: Category[] = [];

  for (const raw of response.data) {
    groups.push(normalizeCategoryGroup(raw));
    for (const rawCat of raw.categories ?? []) {
      categories.push(normalizeCategory(rawCat, raw.id!));
    }
  }

  return { groups, categories };
}

export async function createCategoryGroup(
  connection: ConnectionInstance,
  input: Pick<CategoryGroup, "name" | "isIncome" | "hidden">
): Promise<string> {
  const response = await apiRequest<{ data: string }>(
    connection,
    "/categorygroups",
    { method: "POST", body: { category_group: denormalizeCategoryGroup(input) } }
  );
  return response.data;
}

export async function updateCategoryGroup(
  connection: ConnectionInstance,
  id: string,
  patch: Partial<Pick<CategoryGroup, "name" | "hidden">>
): Promise<void> {
  const fields: Partial<ApiCategoryGroupInput> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.hidden !== undefined) fields.hidden = patch.hidden;

  await apiRequest<void>(connection, `/categorygroups/${id}`, {
    method: "PATCH",
    body: { category_group: fields },
  });
}

export async function deleteCategoryGroup(
  connection: ConnectionInstance,
  id: string,
  transferCategoryId?: string | null
): Promise<void> {
  // The transfer category takes over the group's transactions and budget amounts.
  const query = transferCategoryId ? `?transfer_category_id=${encodeURIComponent(transferCategoryId)}` : "";
  await apiRequest<void>(connection, `/categorygroups/${id}${query}`, {
    method: "DELETE",
  });
}

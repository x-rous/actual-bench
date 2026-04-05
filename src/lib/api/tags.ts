/**
 * Typed API functions for the Tags entity.
 * Available since Actual Budget v26.3.0.
 *
 * Note: the API field for the tag label is "tag" (not "name").
 * Normalization maps raw.tag → Tag.name for internal consistency.
 */

import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type { ApiTag, ApiTagInput, ApiListResponse, ApiSingleResponse } from "@/types/api";
import type { Tag } from "@/types/entities";

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeTag(raw: ApiTag): Tag {
  return {
    id: raw.id,
    name: raw.tag,
    color: raw.color ?? undefined,
    description: raw.description ?? undefined,
  };
}

function denormalizeTag(tag: Partial<Pick<Tag, "name" | "color" | "description">>): ApiTagInput {
  const input: ApiTagInput = { tag: tag.name ?? "" };
  if ("color" in tag) input.color = tag.color ?? null;
  if ("description" in tag) input.description = tag.description ?? null;
  return input;
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function getTags(connection: ConnectionInstance): Promise<Tag[]> {
  const response = await apiRequest<ApiListResponse<ApiTag>>(connection, "/tags");
  return response.data.map(normalizeTag);
}

export async function createTag(
  connection: ConnectionInstance,
  input: Pick<Tag, "name"> & Partial<Pick<Tag, "color" | "description">>
): Promise<Tag> {
  const response = await apiRequest<ApiSingleResponse<ApiTag>>(
    connection,
    "/tags",
    { method: "POST", body: { tag: denormalizeTag(input) } }
  );
  return normalizeTag(response.data);
}

export async function updateTag(
  connection: ConnectionInstance,
  id: string,
  patch: Partial<Pick<Tag, "name" | "color" | "description">>
): Promise<void> {
  await apiRequest<void>(connection, `/tags/${id}`, {
    method: "PATCH",
    body: { tag: denormalizeTag(patch) },
  });
}

export async function deleteTag(
  connection: ConnectionInstance,
  id: string
): Promise<void> {
  await apiRequest<void>(connection, `/tags/${id}`, { method: "DELETE" });
}

import type { SavedQueryRecord } from "@/lib/app-db/types";

/**
 * Thin client for the persistent saved-queries routes (RD-064 / PR-029).
 *
 * Saved queries live in the server-side app DB and are global to the instance —
 * no budget identifier is ever sent. This module is the only bridge between the
 * query workspace and those routes.
 */

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const text = await response.text();
  let data: (T & { error?: string }) | null = null;
  try {
    data = (text ? JSON.parse(text) : {}) as T & { error?: string };
  } catch {
    // Non-JSON body (e.g. an HTML 500 page): fall through to a status-based error.
  }
  if (!response.ok) {
    throw new Error(data?.error ?? `Request to ${input} failed (${response.status})`);
  }
  if (data === null) {
    throw new Error(`Request to ${input} returned a malformed response.`);
  }
  return data;
}

export type SavedQueryCreateInput = { name: string; query: string; isFavorite?: boolean };
export type SavedQueryPatch = Partial<Pick<SavedQueryRecord, "name" | "query" | "isFavorite">>;

export function listSavedQueries(): Promise<{ savedQueries: SavedQueryRecord[] }> {
  return jsonFetch("/api/saved-queries");
}

export function createSavedQuery(body: SavedQueryCreateInput): Promise<{ savedQuery: SavedQueryRecord }> {
  return jsonFetch("/api/saved-queries", { method: "POST", body: JSON.stringify(body) });
}

export function updateSavedQuery(
  id: string,
  patch: SavedQueryPatch
): Promise<{ savedQuery: SavedQueryRecord }> {
  return jsonFetch(`/api/saved-queries/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSavedQuery(id: string): Promise<void> {
  return jsonFetch(`/api/saved-queries/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
    () => undefined
  );
}

export function importSavedQueries(
  queries: SavedQueryCreateInput[]
): Promise<{ imported: number }> {
  return jsonFetch("/api/saved-queries/import", {
    method: "POST",
    body: JSON.stringify({ queries }),
  });
}

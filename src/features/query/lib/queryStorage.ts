/**
 * Persistence layer for the ActualQL query workspace.
 *
 * Saved queries:  localStorage  — `actualql-saved-queries:${budgetSyncId}`
 * History:        sessionStorage — `actualql-history:${budgetSyncId}`
 *
 * Both are keyed by `budgetSyncId` so each budget has its own independent
 * set of saved queries and history. History is session-scoped (cleared when
 * the browser tab closes), matching the lifetime of the connection credentials.
 */

import { generateId } from "@/lib/uuid";
import type { SavedQuery, QueryHistoryEntry } from "../types";

// ─── Key helpers ──────────────────────────────────────────────────────────────

function savedKey(budgetSyncId: string): string {
  return `actualql-saved-queries:${budgetSyncId}`;
}

function historyKey(budgetSyncId: string): string {
  return `actualql-history:${budgetSyncId}`;
}

// ─── Saved queries (localStorage) ────────────────────────────────────────────

function readSaved(budgetSyncId: string): SavedQuery[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(savedKey(budgetSyncId));
    return raw ? (JSON.parse(raw) as SavedQuery[]) : [];
  } catch {
    return [];
  }
}

function writeSaved(budgetSyncId: string, queries: SavedQuery[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(savedKey(budgetSyncId), JSON.stringify(queries));
  } catch {
    // Storage quota exceeded or access denied — degrade gracefully.
  }
}

export function getSavedQueries(budgetSyncId: string): SavedQuery[] {
  return readSaved(budgetSyncId);
}

export function saveQuery(
  budgetSyncId: string,
  name: string,
  query: string
): SavedQuery {
  const existing = readSaved(budgetSyncId);
  const now = new Date().toISOString();
  const entry: SavedQuery = {
    id: generateId(),
    name,
    query,
    createdAt: now,
    updatedAt: now,
  };
  writeSaved(budgetSyncId, [...existing, entry]);
  return entry;
}

export function updateSavedQuery(
  budgetSyncId: string,
  id: string,
  patch: Partial<Pick<SavedQuery, "name" | "query" | "isFavorite">>
): void {
  const queries = readSaved(budgetSyncId);
  writeSaved(
    budgetSyncId,
    queries.map((q) =>
      q.id === id ? { ...q, ...patch, updatedAt: new Date().toISOString() } : q
    )
  );
}

export function deleteSavedQuery(budgetSyncId: string, id: string): void {
  writeSaved(
    budgetSyncId,
    readSaved(budgetSyncId).filter((q) => q.id !== id)
  );
}

export function duplicateSavedQuery(
  budgetSyncId: string,
  id: string
): SavedQuery | null {
  const source = readSaved(budgetSyncId).find((q) => q.id === id);
  if (!source) return null;
  const now = new Date().toISOString();
  const copy: SavedQuery = {
    ...source,
    id: generateId(),
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    isFavorite: false,
  };
  writeSaved(budgetSyncId, [...readSaved(budgetSyncId), copy]);
  return copy;
}

// ─── History (sessionStorage) ─────────────────────────────────────────────────

function readHistory(budgetSyncId: string): QueryHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(historyKey(budgetSyncId));
    return raw ? (JSON.parse(raw) as QueryHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function getHistory(budgetSyncId: string): QueryHistoryEntry[] {
  return readHistory(budgetSyncId);
}

export function clearHistory(budgetSyncId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(historyKey(budgetSyncId));
  } catch {
    // Storage unavailable — degrade gracefully.
  }
}

/**
 * Prepends a query to the history, deduplicating by exact raw JSON string.
 * If the same query already exists, it is moved to the top (most recent).
 * No hard cap — sessionStorage lifetime and the clear button bound growth naturally.
 *
 * @param meta - Optional execution metadata to persist with the entry.
 *   `execTime` — wall-clock milliseconds for the successful run.
 *   `rowCount` — length of the result array; omit for scalar results.
 */
export function addToHistory(
  budgetSyncId: string,
  query: string,
  meta?: { execTime: number; rowCount?: number }
): void {
  if (typeof window === "undefined") return;
  const existing = readHistory(budgetSyncId);
  const deduped = existing.filter((h) => h.query !== query);
  const entry: QueryHistoryEntry = {
    id: generateId(),
    query,
    executedAt: new Date().toISOString(),
    ...(meta?.execTime !== undefined && { execTime: meta.execTime }),
    ...(meta?.rowCount !== undefined && { rowCount: meta.rowCount }),
  };
  try {
    sessionStorage.setItem(historyKey(budgetSyncId), JSON.stringify([entry, ...deduped]));
  } catch {
    // Storage quota exceeded or access denied — degrade gracefully.
  }
}

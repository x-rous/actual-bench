/**
 * Session-history persistence for the ActualQL query workspace.
 *
 * History: sessionStorage — `actualql-history:${budgetSyncId}`, keyed per budget
 * and cleared when the browser tab closes, matching the lifetime of the
 * connection credentials.
 *
 * Saved/favorite queries are NOT here — as of RD-064 they live in the app DB
 * (global, cross-budget) and are accessed through `useSavedQueries` /
 * `savedQueriesApi`, not localStorage.
 */

import { generateId } from "@/lib/uuid";
import type { QueryHistoryEntry } from "../types";

// ─── Key helper ───────────────────────────────────────────────────────────────

function historyKey(budgetSyncId: string): string {
  return `actualql-history:${budgetSyncId}`;
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

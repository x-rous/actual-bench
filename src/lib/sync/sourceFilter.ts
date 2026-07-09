import { isGeneratedSyncMarker } from "./marker";
import { normalizeName } from "./normalize";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { SyncFlow } from "@/lib/app-db/types";
import type { SyncSourceItem } from "./sourceItems";

/**
 * Source filtering for Budget File Sync (RD-053 / PR-019 Slice 3).
 *
 * Two phases so semantics stay correct for split transactions:
 *   1. transaction-level: exclude sync-generated transactions (loop prevention).
 *      Only the parent/normal transaction carries an `imported_id` marker, so
 *      this must run before splits are exploded.
 *   2. item-level: date, cleared/reconciled, amount sign/range, payee/category
 *      include-exclude, notes-contains - applied per source item so each split
 *      line is judged on its own fields.
 */

export type SyncClearedFilter = "any" | "cleared" | "uncleared";
export type SyncReconciledFilter = "any" | "reconciled" | "unreconciled";
export type SyncAmountSign = "any" | "inflow" | "outflow";

export type SyncSourceFilter = {
  startDate: string | null;
  endDate: string | null;
  cleared: SyncClearedFilter;
  reconciled: SyncReconciledFilter;
  amountSign: SyncAmountSign;
  /** Inclusive bounds on absolute amount (minor units); null disables. */
  minAbsAmount: number | null;
  maxAbsAmount: number | null;
  /** Normalized payee names to keep; empty means "no include restriction". */
  payeeInclude: string[];
  payeeExclude: string[];
  categoryInclude: string[];
  categoryExclude: string[];
  notesContains: string | null;
  /** Exclude transactions this app generated in a prior sync. Default true. */
  excludeGeneratedSyncTransactions: boolean;
};

export const DEFAULT_SOURCE_FILTER: SyncSourceFilter = {
  startDate: null,
  endDate: null,
  cleared: "any",
  reconciled: "any",
  amountSign: "any",
  minAbsAmount: null,
  maxAbsAmount: null,
  payeeInclude: [],
  payeeExclude: [],
  categoryInclude: [],
  categoryExclude: [],
  notesContains: null,
  excludeGeneratedSyncTransactions: true,
};

const NOTES_MARKER_HINT = "[synced from ";

/** True when a source transaction looks like one we generated previously. */
export function isGeneratedSourceTransaction(txn: SyncSourceTransaction): boolean {
  if (isGeneratedSyncMarker(txn.importedId)) return true;
  // Fallback: our visible notes marker, in case imported_id was stripped.
  return typeof txn.notes === "string" && txn.notes.toLowerCase().includes(NOTES_MARKER_HINT);
}

/** Phase 1 - drop sync-generated transactions before expansion. */
export function filterSourceTransactions(
  txns: SyncSourceTransaction[],
  filter: SyncSourceFilter
): SyncSourceTransaction[] {
  if (!filter.excludeGeneratedSyncTransactions) return txns;
  return txns.filter((txn) => !isGeneratedSourceTransaction(txn));
}

function inDateRange(date: string, filter: SyncSourceFilter): boolean {
  if (filter.startDate && date < filter.startDate) return false;
  if (filter.endDate && date > filter.endDate) return false;
  return true;
}

function matchesCleared(item: SyncSourceItem, filter: SyncSourceFilter): boolean {
  if (filter.cleared === "cleared") return item.cleared === true;
  if (filter.cleared === "uncleared") return item.cleared === false;
  return true;
}

function matchesReconciled(item: SyncSourceItem, filter: SyncSourceFilter): boolean {
  if (filter.reconciled === "reconciled") return item.reconciled === true;
  if (filter.reconciled === "unreconciled") return item.reconciled === false;
  return true;
}

function matchesSign(item: SyncSourceItem, filter: SyncSourceFilter): boolean {
  if (filter.amountSign === "inflow") return item.amount > 0;
  if (filter.amountSign === "outflow") return item.amount < 0;
  return true;
}

function matchesAmountRange(item: SyncSourceItem, filter: SyncSourceFilter): boolean {
  const abs = Math.abs(item.amount);
  if (filter.minAbsAmount != null && abs < filter.minAbsAmount) return false;
  if (filter.maxAbsAmount != null && abs > filter.maxAbsAmount) return false;
  return true;
}

function matchesNameFilter(
  name: string | null,
  include: string[],
  exclude: string[]
): boolean {
  const normalized = normalizeName(name);
  if (include.length > 0 && !include.includes(normalized)) return false;
  if (exclude.length > 0 && exclude.includes(normalized)) return false;
  return true;
}

function matchesNotes(item: SyncSourceItem, filter: SyncSourceFilter): boolean {
  if (!filter.notesContains) return true;
  const needle = filter.notesContains.toLowerCase();
  return typeof item.notes === "string" && item.notes.toLowerCase().includes(needle);
}

/** Phase 2 - item-level filtering after split expansion. */
export function filterSourceItems(
  items: SyncSourceItem[],
  filter: SyncSourceFilter
): SyncSourceItem[] {
  return items.filter(
    (item) =>
      inDateRange(item.date, filter) &&
      matchesCleared(item, filter) &&
      matchesReconciled(item, filter) &&
      matchesSign(item, filter) &&
      matchesAmountRange(item, filter) &&
      matchesNameFilter(item.payeeName, filter.payeeInclude, filter.payeeExclude) &&
      matchesNameFilter(item.categoryName, filter.categoryInclude, filter.categoryExclude) &&
      matchesNotes(item, filter)
  );
}

// --- Decode a saved flow's filter envelope into a typed filter --------------

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeName(typeof entry === "string" ? entry : ""))
    .filter((name) => name !== "");
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Best-effort decode of the first leg's filter envelope; defaults are safe. */
export function decodeSourceFilter(flow: SyncFlow): SyncSourceFilter {
  const data = (flow.legs[0]?.filter.data ?? {}) as Record<string, unknown>;
  return {
    startDate: str(data.startDate),
    endDate: str(data.endDate),
    cleared: oneOf(data.cleared, ["any", "cleared", "uncleared"] as const, "any"),
    reconciled: oneOf(data.reconciled, ["any", "reconciled", "unreconciled"] as const, "any"),
    amountSign: oneOf(data.amountSign, ["any", "inflow", "outflow"] as const, "any"),
    minAbsAmount: num(data.minAbsAmount),
    maxAbsAmount: num(data.maxAbsAmount),
    payeeInclude: nameList(data.payeeInclude),
    payeeExclude: nameList(data.payeeExclude),
    categoryInclude: nameList(data.categoryInclude),
    categoryExclude: nameList(data.categoryExclude),
    notesContains: str(data.notesContains),
    excludeGeneratedSyncTransactions: bool(data.excludeGeneratedSyncTransactions, true),
  };
}

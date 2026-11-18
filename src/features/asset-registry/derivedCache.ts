import type { ExternalSnapshot } from "@/lib/asset-registry/cashflows";
import { attributeBook, type BookSnapshot } from "@/lib/asset-registry/ledger";
import type { Asset, Registry } from "@/lib/asset-registry/models";
import { performance, type AssetPerformance } from "@/lib/asset-registry/performance";

/**
 * Figures the Assets pages derive from one account read and one registry. Query data keeps its object identity until it is
 * read again, so keying on those objects works out each figure once per read instead of once per cell, sort comparison or
 * keystroke. Nothing here outlives the data it was derived from (weak keys).
 */
type Attributed = ReturnType<typeof attributeBook>;
const attributions = new WeakMap<BookSnapshot, WeakMap<Registry, Attributed>>();

/** `attributeBook` for a whole account read, computed once per (read, registry) pair. Treat the result as read-only. */
export function attributedBook(snapshot: BookSnapshot, registry: Registry): Attributed {
  let byRegistry = attributions.get(snapshot);
  if (!byRegistry) { byRegistry = new WeakMap(); attributions.set(snapshot, byRegistry); }
  let result = byRegistry.get(registry);
  if (!result) { result = attributeBook(snapshot, registry.assets, registry.metadata); byRegistry.set(registry, result); }
  return result;
}

/**
 * An asset's recorded value on a date from the attributed rows (signed integer minor units), or null while the read is
 * incomplete. A row's attribution never depends on other rows, so this equals attributing only the rows up to that date.
 */
export function attributedValueAt(snapshot: BookSnapshot, registry: Registry, assetId: string, on?: string): number | null {
  const book = attributedBook(snapshot, registry);
  if (!book.available) return null;
  if (on === undefined) return book.totals.get(assetId) ?? null;
  let total = 0;
  for (const row of book.rows) if (row.assetId === assetId && row.date <= on) total += row.amountMinor;
  return book.totals.has(assetId) ? total : null;
}

const reports = new WeakMap<BookSnapshot, WeakMap<Registry, WeakMap<ExternalSnapshot, Map<string, AssetPerformance>>>>();
/** The performance report for an asset and period, computed once per (book read, registry, external read). */
export function cachedPerformance(asset: Asset, registry: Registry, snapshot: BookSnapshot, external: ExternalSnapshot, from: string, to: string): AssetPerformance {
  let byRegistry = reports.get(snapshot);
  if (!byRegistry) { byRegistry = new WeakMap(); reports.set(snapshot, byRegistry); }
  let byExternal = byRegistry.get(registry);
  if (!byExternal) { byExternal = new WeakMap(); byRegistry.set(registry, byExternal); }
  let byKey = byExternal.get(external);
  if (!byKey) { byKey = new Map(); byExternal.set(external, byKey); }
  const key = `${asset.id}|${from}|${to}`;
  let result = byKey.get(key);
  if (!result) { result = performance(asset, registry, snapshot, external, from, to); byKey.set(key, result); }
  return result;
}

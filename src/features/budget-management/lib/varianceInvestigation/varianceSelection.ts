import type { Driver, VarianceModel } from "./varianceViewModel";

/**
 * Driver selection: the default, Ctrl/Cmd toggling, the list filter, and the
 * category ids a selection stands for.
 *
 * Every other panel reads the selection through here, so clicking a waterfall
 * bar, a list row or a chip cannot end up selecting different things.
 */

export type DriverFilter = "all" | "unfavourable" | "favourable" | "deficit";

/**
 * What opens selected: the Envelope driver with the biggest deficit (the real
 * overspend), else the largest unfavourable driver, else the largest
 * favourable one. Drivers arrive sorted, so the first of each kind is largest.
 */
export function defaultSelection(model: VarianceModel): string[] {
  const { drivers } = model;
  if (drivers.length === 0) return [];
  if (model.mode === "envelope") {
    const deficits = drivers
      .filter((d) => (d.aggregate.envelope?.deficit ?? 0) > 0)
      .sort((a, b) => b.aggregate.envelope!.deficit - a.aggregate.envelope!.deficit);
    if (deficits.length > 0) return [deficits[0].id];
  }
  return [drivers[0].id];
}

/** Keep the requested ids that still exist, or fall back to the default. */
export function resolveSelection(
  model: VarianceModel,
  requested: readonly string[] | null | undefined
): string[] {
  const known = new Set(model.drivers.map((d) => d.id));
  const kept = (requested ?? []).filter((id) => known.has(id));
  return kept.length > 0 ? kept : defaultSelection(model);
}

/**
 * Apply a click. A plain click replaces the selection; Ctrl/Cmd adds the
 * ids, or removes them when every one is already selected. An empty result
 * returns `null`, meaning "back to the default".
 */
export function toggleSelection(
  current: readonly string[],
  ids: readonly string[],
  additive: boolean
): string[] | null {
  if (!additive) return ids.length > 0 ? [...ids] : null;
  const next = new Set(current);
  const allSelected = ids.every((id) => next.has(id));
  for (const id of ids) {
    if (allSelected) next.delete(id);
    else next.add(id);
  }
  return next.size > 0 ? [...next] : null;
}

export function selectedDrivers(model: VarianceModel, ids: readonly string[]): Driver[] {
  const wanted = new Set(ids);
  return model.drivers.filter((d) => wanted.has(d.id));
}

/** The categories behind a selection, de-duplicated. A group stands for its members. */
export function selectedCategoryIds(
  model: VarianceModel,
  ids: readonly string[]
): string[] {
  const out = new Set<string>();
  for (const driver of selectedDrivers(model, ids)) {
    for (const id of driver.categoryIds) out.add(id);
  }
  return [...out];
}

export function filterDrivers(drivers: readonly Driver[], filter: DriverFilter): Driver[] {
  switch (filter) {
    case "unfavourable":
      return drivers.filter((d) => d.variance > 0);
    case "favourable":
      return drivers.filter((d) => d.variance < 0);
    case "deficit":
      return drivers.filter((d) => (d.aggregate.envelope?.deficit ?? 0) > 0);
    default:
      return [...drivers];
  }
}

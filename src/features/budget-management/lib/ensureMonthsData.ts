/**
 * On-demand loader for budget months outside the visible window.
 *
 * Bulk actions used to read their source months straight out of the TanStack
 * cache with `getQueryData` — a peek that never fetches. Whatever happened to
 * be warm became the answer, so an average over "12 months" could quietly be
 * an average over four, and anything outside the twelve rendered months was
 * simply unreachable.
 *
 * `ensureMonthsData` makes the requirement explicit: ask for the months an
 * action needs, get back the ones that exist, and get told about the ones that
 * do not. A month the API never had is not an error — it is a fact the caller
 * has to report rather than silently absorb.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { selectActiveInstance } from "@/store/connection";
import { budgetMonthDataQueryOptions } from "./monthDataQuery";
import type { LoadedCategory, LoadedMonthState } from "../types";

export type EnsureMonthsResult = {
  /** Month → that month's categories, for every month that resolved. */
  monthDataMap: Record<string, LoadedCategory[]>;
  /** Requested months absent from the budget file (never fetched). */
  unavailable: string[];
  /** Requested months that exist but whose fetch failed. */
  failed: string[];
};

/**
 * Loads every requested month, using the shared query cache.
 *
 * `availableMonths` is the budget file's own month list. A month outside it is
 * never requested: the API has no budget month to return, and asking would
 * trade a known answer for a 404. When it is `undefined` the list is unknown,
 * so every month is attempted and a genuine miss surfaces via `failed`.
 */
export async function ensureMonthsData(
  queryClient: QueryClient,
  connection: ReturnType<typeof selectActiveInstance>,
  months: readonly string[],
  availableMonths: readonly string[] | undefined
): Promise<EnsureMonthsResult> {
  const result: EnsureMonthsResult = {
    monthDataMap: {},
    unavailable: [],
    failed: [],
  };

  if (!connection) {
    result.failed = [...new Set(months)];
    return result;
  }

  const availableSet = availableMonths ? new Set(availableMonths) : null;
  const wanted: string[] = [];

  for (const month of new Set(months)) {
    if (!month) continue;
    if (availableSet && !availableSet.has(month)) {
      result.unavailable.push(month);
      continue;
    }
    wanted.push(month);
  }

  const settled = await Promise.allSettled(
    wanted.map((month) =>
      queryClient.ensureQueryData<LoadedMonthState>(
        budgetMonthDataQueryOptions(connection, month)
      )
    )
  );

  settled.forEach((outcome, i) => {
    const month = wanted[i]!;
    if (outcome.status === "fulfilled" && outcome.value) {
      result.monthDataMap[month] = Object.values(outcome.value.categoriesById);
    } else {
      result.failed.push(month);
    }
  });

  result.unavailable.sort();
  result.failed.sort();
  return result;
}

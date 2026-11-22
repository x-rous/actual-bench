"use client";

import { useCallback, useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { budgetMonthDataQueryOptions, isMissingBudgetMonthError } from "../lib/monthDataQuery";
import {
  computeEnvelopeCarry,
  envelopeReplayMonths,
  type EnvelopeCarry,
} from "../lib/effectiveMonth";
import type { BudgetCellKey, LoadedMonthState, StagedBudgetEdit } from "../types";

export type EnvelopeCarryResult = {
  /**
   * Carry per window month. Undefined in Tracking mode, and also while it is
   * not `ready`: callers must then hold back Envelope projections rather than
   * fall back to the linear path, which would show different numbers.
   */
  carry: Map<string, EnvelopeCarry> | undefined;
  /** False while a replay month is loading or failed (always true in Tracking). */
  ready: boolean;
  /** A replay month whose load failed, with its error. */
  failed: { month: string; error: unknown } | null;
};

/**
 * Envelope carry for `months` (chronological, consecutive), replayed with
 * Actual's rules from the earliest staged edit before them. The months before
 * the window that hold edits are loaded (usually cache hits: they were in view
 * when the edits were staged), so a month leaving the view does not change
 * the carry into later months. Shared by the grid's MonthsDataProvider and the
 * Details panel so the two always agree.
 *
 * A replay month that is still loading or failed would be replayed as if it
 * had no balances, which carries the wrong amount, so the carry is withheld
 * (`ready: false`) until every replay month has loaded.
 *
 * `states` is aligned with `months`, with unavailable months already left out.
 */
export function useEnvelopeCarry(
  months: string[],
  states: (LoadedMonthState | undefined)[],
  allEdits: Record<BudgetCellKey, StagedBudgetEdit>,
  enabled: boolean,
  availableMonths: ReadonlySet<string>
): EnvelopeCarryResult {
  const connection = useConnectionStore(selectActiveInstance);
  const firstMonth = months[0];
  const replayMonths = useMemo(
    () => (enabled && firstMonth ? envelopeReplayMonths(firstMonth, allEdits) : []),
    [enabled, firstMonth, allEdits]
  );

  // An unavailable month is not loaded and is passed through by the replay;
  // disabled queries can still expose cached data, so it is dropped here too.
  // A month the server reports as missing has no balances, which is what the
  // replay assumes for it, so it does not block the carry.
  const combine = useCallback(
    (results: UseQueryResult<LoadedMonthState>[]) => {
      const data: (LoadedMonthState | undefined)[] = [];
      let pending = false;
      let failed: { month: string; error: unknown } | null = null;
      results.forEach((query, i) => {
        const month = replayMonths[i]!;
        if (!availableMonths.has(month)) {
          data.push(undefined);
          return;
        }
        data.push(query.data);
        if (query.data !== undefined) return;
        if (query.isError) {
          if (!isMissingBudgetMonthError(query.error, month) && !failed) {
            failed = { month, error: query.error };
          }
        } else {
          pending = true;
        }
      });
      return { data, pending, failed: failed as { month: string; error: unknown } | null };
    },
    [availableMonths, replayMonths]
  );
  const replay = useQueries({
    queries: replayMonths.map((m) => ({
      ...budgetMonthDataQueryOptions(connection, m),
      enabled: !!connection && availableMonths.has(m),
    })),
    combine,
  });
  const { data: replayStates, pending, failed } = replay;
  const ready = !enabled || (!pending && !failed);

  const carry = useMemo(
    () =>
      enabled && ready
        ? computeEnvelopeCarry([...replayMonths, ...months], [...replayStates, ...states], allEdits)
        : undefined,
    [enabled, ready, replayMonths, replayStates, months, states, allEdits]
  );
  return useMemo(() => ({ carry, ready, failed }), [carry, ready, failed]);
}

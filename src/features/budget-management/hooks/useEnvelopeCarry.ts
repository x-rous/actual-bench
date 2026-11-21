"use client";

import { useCallback, useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { budgetMonthDataQueryOptions } from "../lib/monthDataQuery";
import {
  computeEnvelopeCarry,
  envelopeReplayMonths,
  type EnvelopeCarry,
} from "../lib/effectiveMonth";
import type { BudgetCellKey, LoadedMonthState, StagedBudgetEdit } from "../types";

/**
 * Envelope carry for `months` (chronological, consecutive), replayed with
 * Actual's rules from the earliest staged edit before them. The months before
 * the window that hold edits are loaded (usually cache hits: they were in view
 * when the edits were staged), so a month leaving the view does not change
 * the carry into later months. Shared by the grid's MonthsDataProvider and the
 * Details panel so the two always agree.
 *
 * `states` is aligned with `months`, with unavailable months already left out.
 * Returns undefined when `enabled` is false (Tracking mode).
 */
export function useEnvelopeCarry(
  months: string[],
  states: (LoadedMonthState | undefined)[],
  allEdits: Record<BudgetCellKey, StagedBudgetEdit>,
  enabled: boolean,
  availableMonths: ReadonlySet<string>
): Map<string, EnvelopeCarry> | undefined {
  const connection = useConnectionStore(selectActiveInstance);
  const firstMonth = months[0];
  const replayMonths = useMemo(
    () => (enabled && firstMonth ? envelopeReplayMonths(firstMonth, allEdits) : []),
    [enabled, firstMonth, allEdits]
  );

  // An unavailable month is not loaded and is passed through by the replay;
  // disabled queries can still expose cached data, so it is dropped here too.
  const combine = useCallback(
    (results: UseQueryResult<LoadedMonthState>[]) =>
      results.map((query, i) => (availableMonths.has(replayMonths[i]!) ? query.data : undefined)),
    [availableMonths, replayMonths]
  );
  const replayStates = useQueries({
    queries: replayMonths.map((m) => ({
      ...budgetMonthDataQueryOptions(connection, m),
      enabled: !!connection && availableMonths.has(m),
    })),
    combine,
  });

  return useMemo(
    () =>
      enabled
        ? computeEnvelopeCarry([...replayMonths, ...months], [...replayStates, ...states], allEdits)
        : undefined,
    [enabled, replayMonths, replayStates, months, states, allEdits]
  );
}

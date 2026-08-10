"use client";

import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { createReconciliationTransport } from "@/lib/reconciliation/transportAdapter";
import { shiftDate } from "@/lib/reconciliation/match/matcher";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

export type CandidateWindowInput = {
  accountId: string | null;
  /** Statement period, ISO `YYYY-MM-DD`. */
  statementStart: string | null;
  statementEnd: string | null;
  toleranceDays: number;
};

/**
 * Loads the Actual transactions the statement could match against.
 *
 * The window is the statement period widened by the tolerance either side
 * (feature spec §9), because a bank's posting date routinely differs from the
 * date a transaction was entered or authorised. Actual's own fuzzy matcher uses
 * ±7 days, so anything narrower would under-report candidates.
 */
export function useCandidateWindow(input: CandidateWindowInput) {
  const connection = useConnectionStore(selectActiveInstance);
  const { accountId, statementStart, statementEnd, toleranceDays } = input;

  const startDate = statementStart ? shiftDate(statementStart, -toleranceDays) : null;
  const endDate = statementEnd ? shiftDate(statementEnd, toleranceDays) : null;

  return useQuery({
    queryKey: [
      "reconciliation",
      "candidates",
      connection?.id,
      accountId,
      startDate,
      endDate,
    ],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return createReconciliationTransport(getTransport(connection)).loadTransactions({
        accountId: accountId!,
        startDate: startDate!,
        endDate: endDate!,
      });
    },
    enabled: Boolean(connection && accountId && startDate && endDate),
  });
}

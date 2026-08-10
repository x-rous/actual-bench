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
  /** How far apart a pair may be and still match. */
  matchToleranceDays: number;
  /** How far outside the statement period to load. */
  paddingDays: number;
};

/**
 * Loads the Actual transactions the statement could match against.
 *
 * The window is the statement period widened by the padding either side, because
 * a bank's posting date routinely differs from the date a transaction was
 * entered or authorised (feature spec §9).
 *
 * The padding is clamped to at least the match tolerance: loading a narrower
 * range than matching reaches would hide a legitimate pair entirely. Everything
 * beyond the statement period that does not match is reported separately rather
 * than as an unexplained transaction — the statement makes no claim about dates
 * it does not cover.
 */
export function useCandidateWindow(input: CandidateWindowInput) {
  const connection = useConnectionStore(selectActiveInstance);
  const { accountId, statementStart, statementEnd, matchToleranceDays, paddingDays } = input;

  const padding = Math.max(paddingDays, matchToleranceDays);
  const startDate = statementStart ? shiftDate(statementStart, -padding) : null;
  const endDate = statementEnd ? shiftDate(statementEnd, padding) : null;

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

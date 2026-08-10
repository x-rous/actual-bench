import { getTransport } from "@/lib/actual";
import { shiftDate } from "@/lib/reconciliation/match/matcher";
import type { LoadedCandidateWindow } from "@/lib/reconciliation/ports";
import { createReconciliationTransport } from "@/lib/reconciliation/transportAdapter";
import type { ConnectionInstance } from "@/store/connection";

export type CandidateWindowInput = {
  accountId: string;
  /** Statement period, ISO `YYYY-MM-DD`. */
  statementStart: string;
  statementEnd: string;
  /** How far apart a pair may be and still match. */
  matchToleranceDays: number;
  /** How far outside the statement period the user wants to look. */
  paddingDays: number;
};

export type CandidateWindow = LoadedCandidateWindow & {
  /** The range actually loaded, ISO `YYYY-MM-DD`. */
  loaded: { start: string; end: string };
  /**
   * The range the user asked to see. Transactions outside it are used for
   * matching but are not listed as missing from the statement.
   */
  visible: { start: string; end: string };
};

/**
 * Load the transactions a statement could match against.
 *
 * Deliberately a plain function rather than a query hook. This runs immediately
 * after parsing, in the same handler that computed the statement period — a
 * hook keyed on that period would still be holding the previous render's key
 * and would return stale or empty data, which silently produces zero matches.
 *
 * Two ranges come back. **Loaded** is always at least the match tolerance wide,
 * because a pair the matcher is allowed to make must be visible to it: a
 * statement row on the first day of the period can legitimately match a
 * transaction recorded a few days earlier. **Visible** is what the user asked
 * for. Transactions between the two are eligible to match but are never listed
 * as missing from the statement — with zero padding, the user sees only their
 * own period, which is the point.
 */
export async function loadCandidateWindow(
  connection: ConnectionInstance,
  input: CandidateWindowInput
): Promise<CandidateWindow> {
  const loadPadding = Math.max(input.paddingDays, input.matchToleranceDays);

  const loaded = {
    start: shiftDate(input.statementStart, -loadPadding),
    end: shiftDate(input.statementEnd, loadPadding),
  };
  const visible = {
    start: shiftDate(input.statementStart, -input.paddingDays),
    end: shiftDate(input.statementEnd, input.paddingDays),
  };

  const window = await createReconciliationTransport(getTransport(connection)).loadTransactions({
    accountId: input.accountId,
    startDate: loaded.start,
    endDate: loaded.end,
  });

  return { ...window, loaded, visible };
}

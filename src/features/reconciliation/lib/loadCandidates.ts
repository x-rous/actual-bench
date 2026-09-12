import { getTransport } from "@/lib/actual";
import { DEFAULT_MATCH_CONFIG } from "@/lib/reconciliation/match/config";
import { shiftDate } from "@/lib/reconciliation/match/matcher";
import type { LoadedCandidateWindow } from "@/lib/reconciliation/ports";
import { createReconciliationTransport } from "@/lib/reconciliation/transportAdapter";
import type { MatchConfig } from "@/lib/reconciliation/types";
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

/**
 * The window a *resumed* session should re-read, from what it persisted.
 *
 * Hydration puts the stored snapshots on screen, but those are drift baselines —
 * one per item, for the transaction it was decided on — so a review item's other
 * candidates are simply not there, and the guards for the ids it cannot resolve
 * fall back to permissive (F-151c / F-151d). The workbench therefore reads the
 * window again rather than remembering it.
 *
 * Nothing extra is stored to make that possible: the account, the statement
 * period and the match config are already on the session, and the window is a
 * function of exactly those. Keeping that derivation here — rather than inline in
 * the effect that uses it — is what makes it assertable that a resumed session
 * reads *the same* window it matched against, which is the property that would
 * otherwise rot silently the next time a default moves.
 *
 * Returns null when the session has no period, which is every session that has
 * not imported a statement yet: there is nothing to re-read.
 */
export function resumeWindowInput(session: {
  accountId: string;
  statementStart: string | null;
  statementEnd: string | null;
  matchConfig: unknown;
}): CandidateWindowInput | null {
  if (!session.statementStart || !session.statementEnd) return null;

  // A session saved before a config field existed, or with none at all, reads
  // the current defaults — the same fallback the workbench applies everywhere
  // else it loads a stored match config.
  const stored = (session.matchConfig ?? {}) as Partial<MatchConfig>;
  const matchToleranceDays =
    typeof stored.dateToleranceDays === "number"
      ? stored.dateToleranceDays
      : DEFAULT_MATCH_CONFIG.dateToleranceDays;
  const paddingDays =
    typeof stored.candidatePaddingDays === "number"
      ? stored.candidatePaddingDays
      : DEFAULT_MATCH_CONFIG.candidatePaddingDays;

  return {
    accountId: session.accountId,
    statementStart: session.statementStart,
    statementEnd: session.statementEnd,
    matchToleranceDays,
    paddingDays,
  };
}
